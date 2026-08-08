import type { MxaiModel } from '../assets/mxai'
import type { PipelineFrame } from '../types'
import { createRt4kSrGraph, type GpuModelGraph, type GpuTensorStore } from './graph'
import { PackedTexturePool, type PackedTexture } from './packed'
import { TexturePool, type PooledTexture } from './texture-pool'
import { PACKED_CONVOLUTION_WGSL, PACKED_INPUT_WGSL, PACKED_LAYER_NORM_WGSL, PACKED_PIXEL_SHUFFLE_X4_WGSL, PACKED_PIXEL_UNSHUFFLE_WGSL } from './wgsl'

/**
 * Fixed RT4KSR deploy graph. Activations stay in rgba16float array textures;
 * four lanes per layer carry one NCHW channel group. No tensor is read back to
 * the CPU and all intermediate allocations come from bounded pools.
 */
export class Rt4kSrGraphExecutor {
  readonly graph: GpuModelGraph
  readonly #device: GPUDevice
  readonly #queue: GPUQueue
  readonly #store: GpuTensorStore
  readonly #packedPool: PackedTexturePool
  readonly #outputPool: TexturePool
  readonly #inputPipeline: GPUComputePipeline
  readonly #unshufflePipeline: GPUComputePipeline
  readonly #convPipeline: GPUComputePipeline
  readonly #normPipeline: GPUComputePipeline
  readonly #shufflePipeline: GPUComputePipeline
  readonly #params: GPUBuffer
  readonly #normParams: GPUBuffer
  readonly #shuffleParams: GPUBuffer
  readonly #zero: GPUBuffer
  #closed = false

  static create(options: { device: GPUDevice; queue?: GPUQueue; model: MxaiModel; tensorStore: GpuTensorStore; texturePoolCapacity?: number }): Rt4kSrGraphExecutor {
    return new Rt4kSrGraphExecutor(options)
  }

  private constructor(options: { device: GPUDevice; queue?: GPUQueue; model: MxaiModel; tensorStore: GpuTensorStore; texturePoolCapacity?: number }) {
    this.#device = options.device
    this.#queue = options.queue ?? options.device.queue
    this.#store = options.tensorStore
    this.graph = createRt4kSrGraph(options.model)
    this.#packedPool = new PackedTexturePool(this.#device, options.texturePoolCapacity ?? 32)
    this.#outputPool = new TexturePool({ device: this.#device, capacity: Math.max(2, Math.min(16, options.texturePoolCapacity ?? 4)) })
    this.#inputPipeline = makePipeline(this.#device, PACKED_INPUT_WGSL, 'main')
    this.#unshufflePipeline = makePipeline(this.#device, PACKED_PIXEL_UNSHUFFLE_WGSL, 'main')
    this.#convPipeline = makePipeline(this.#device, PACKED_CONVOLUTION_WGSL, 'main')
    this.#normPipeline = makePipeline(this.#device, PACKED_LAYER_NORM_WGSL, 'main')
    this.#shufflePipeline = makePipeline(this.#device, PACKED_PIXEL_SHUFFLE_X4_WGSL, 'main')
    this.#params = this.#device.createBuffer({ size: 48, usage: uniformUsage() })
    this.#normParams = this.#device.createBuffer({ size: 32, usage: uniformUsage() })
    this.#shuffleParams = this.#device.createBuffer({ size: 32, usage: uniformUsage() })
    this.#zero = this.#device.createBuffer({ size: 4, usage: storageUsage() })
    this.#queue.writeBuffer(this.#zero, 0, new Float32Array([0]))
  }

  async process(source: GPUTexture, width: number, height: number, epoch: number, timestamp: number): Promise<PipelineFrame> {
    if (this.#closed) throw new Error('RT4KSR graph is closed')
    if (width % 2 !== 0 || height % 2 !== 0) throw new Error('RT4KSR requires even input dimensions')
    let current: PackedTexture | null = null
    let pending: PackedTexture | null = null
    let residualSource: PackedTexture | null = null
    let result: PooledTexture | null = null
    try {
      current = this.#packedPool.acquire(width, height, 3)
      await this.#runInput(source, current, width, height)
      pending = this.#packedPool.acquire(Math.floor(width / 2), Math.floor(height / 2), 12)
      await this.#runUnshuffle(current, pending, width, height)
      current.release()
      current = pending
      pending = null

      for (const layer of this.graph.layers) {
        if (layer.id.endsWith('-layernorm')) {
          pending = this.#packedPool.acquire(current.width, current.height, current.channels)
          await this.#runNorm(current, pending, layer)
          current.release()
          current = pending
          pending = null
          continue
        }
        const previous = current
        pending = this.#packedPool.acquire(current.width / layer.stride, current.height / layer.stride, layer.outputChannels)
        if (layer.id.endsWith('-expand')) residualSource = current
        await this.#runConv(current, pending, layer, layer.residual ? residualSource : null)
        if (previous !== residualSource) previous.release()
        current = pending
        pending = null
        if (layer.residual) {
          residualSource?.release()
          residualSource = null
        }
      }

      result = this.#outputPool.acquire(width * 2, height * 2)
      await this.#runShuffle(current, result, width / 2, height / 2, epoch)
      current.release()
      current = null
      const frame: PipelineFrame = { location: 'gpu', texture: result.texture, width: result.width, height: result.height, timestamp, release: result.release }
      result = null
      return frame
    } catch (error) {
      current?.release()
      pending?.release()
      residualSource?.release()
      result?.release()
      throw error
    }
  }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    for (const buffer of [this.#params, this.#normParams, this.#shuffleParams, this.#zero]) {
      try { buffer.destroy() } catch { /* best effort */ }
    }
    this.#packedPool.close()
    this.#outputPool.close()
  }

  async #runInput(source: GPUTexture, output: PackedTexture, width: number, height: number): Promise<void> {
    this.#queue.writeBuffer(this.#params, 0, new Uint32Array([width, height, 0, 0]))
    await this.#dispatch(this.#inputPipeline, [
      { binding: 0, resource: source.createView() },
      { binding: 1, resource: output.texture.createView({ dimension: '2d-array', arrayLayerCount: output.groups }) },
      { binding: 2, resource: { buffer: this.#params } },
    ], Math.ceil(width / 8), Math.ceil(height / 8), 1)
  }

  async #runUnshuffle(input: PackedTexture, output: PackedTexture, width: number, height: number): Promise<void> {
    this.#queue.writeBuffer(this.#params, 0, new Uint32Array([width, height, 3, 2, output.groups]))
    await this.#dispatch(this.#unshufflePipeline, [
      { binding: 0, resource: input.texture.createView({ dimension: '2d-array', arrayLayerCount: input.groups }) },
      { binding: 1, resource: output.texture.createView({ dimension: '2d-array', arrayLayerCount: output.groups }) },
      { binding: 2, resource: { buffer: this.#params } },
    ], Math.ceil(output.width / 8), Math.ceil(output.height / 8), output.groups)
  }

  async #runConv(input: PackedTexture, output: PackedTexture, layer: { weight: string; bias?: string; inputChannels: number; outputChannels: number; kernel: number; stride: number; activation: string; residual?: boolean }, residualInput: PackedTexture | null): Promise<void> {
    const weights = this.#store.tensors.get(layer.weight)
    if (!weights) throw new Error(`RT4KSR graph tensor is missing: ${layer.weight}`)
    const bias = layer.bias === undefined ? null : this.#store.tensors.get(layer.bias)
    if (!bias && layer.bias !== undefined) throw new Error(`RT4KSR graph bias is missing: ${layer.bias}`)
    const values = new Uint32Array(12)
    values.set([input.width, input.height, output.width, output.height, layer.inputChannels, layer.outputChannels, layer.kernel, layer.stride, input.groups, output.groups, layer.activation === 'relu' ? 1 : layer.activation === 'leaky-relu' ? 2 : 0, residualInput ? 1 : 0])
    this.#queue.writeBuffer(this.#params, 0, values)
    await this.#dispatch(this.#convPipeline, [
      { binding: 0, resource: input.texture.createView({ dimension: '2d-array', arrayLayerCount: input.groups }) },
      { binding: 1, resource: output.texture.createView({ dimension: '2d-array', arrayLayerCount: output.groups }) },
      { binding: 2, resource: { buffer: weights.buffer } },
      { binding: 3, resource: { buffer: bias?.buffer ?? this.#zero } },
      { binding: 4, resource: { buffer: this.#params } },
      { binding: 5, resource: (residualInput ?? input).texture.createView({ dimension: '2d-array', arrayLayerCount: (residualInput ?? input).groups }) },
    ], Math.ceil(output.width / 8), Math.ceil(output.height / 8), output.groups)
  }

  async #runNorm(input: PackedTexture, output: PackedTexture, layer: { weight: string; bias?: string }): Promise<void> {
    const scale = this.#store.tensors.get(layer.weight)
    const shift = layer.bias === undefined ? null : this.#store.tensors.get(layer.bias)
    if (!scale || !shift) throw new Error(`RT4KSR layer norm tensors are missing for ${layer.weight}`)
    const params = new ArrayBuffer(32)
    const paramsView = new DataView(params)
    paramsView.setUint32(0, input.width, true)
    paramsView.setUint32(4, input.height, true)
    paramsView.setUint32(8, input.channels, true)
    paramsView.setUint32(12, input.groups, true)
    paramsView.setFloat32(16, 1e-6, true)
    this.#queue.writeBuffer(this.#normParams, 0, params)
    await this.#dispatch(this.#normPipeline, [
      { binding: 0, resource: input.texture.createView({ dimension: '2d-array', arrayLayerCount: input.groups }) },
      { binding: 1, resource: output.texture.createView({ dimension: '2d-array', arrayLayerCount: output.groups }) },
      { binding: 2, resource: { buffer: scale.buffer } },
      { binding: 3, resource: { buffer: shift.buffer } },
      { binding: 4, resource: { buffer: this.#normParams } },
    ], Math.ceil(output.width / 8), Math.ceil(output.height / 8), output.groups)
  }

  async #runShuffle(input: PackedTexture, output: PooledTexture, width: number, height: number, _epoch: number): Promise<void> {
    this.#queue.writeBuffer(this.#shuffleParams, 0, new Uint32Array([width, height, output.width, output.height, 3, 4, input.groups, 0]))
    await this.#dispatch(this.#shufflePipeline, [
      { binding: 0, resource: input.texture.createView({ dimension: '2d-array', arrayLayerCount: input.groups }) },
      { binding: 1, resource: output.texture.createView() },
      { binding: 2, resource: { buffer: this.#shuffleParams } },
    ], Math.ceil(output.width / 8), Math.ceil(output.height / 8), 1)
  }

  async #dispatch(pipeline: GPUComputePipeline, entries: GPUBindGroupEntry[], x: number, y: number, z: number): Promise<void> {
    const bindGroup = this.#device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries })
    const encoder = this.#device.createCommandEncoder()
    const pass = encoder.beginComputePass()
    pass.setPipeline(pipeline)
    pass.setBindGroup(0, bindGroup)
    pass.dispatchWorkgroups(x, y, z)
    pass.end()
    this.#queue.submit([encoder.finish()])
    await this.#queue.onSubmittedWorkDone()
  }
}

function makePipeline(device: GPUDevice, code: string, entryPoint: string): GPUComputePipeline {
  const module = device.createShaderModule({ code })
  return device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint } })
}

function uniformUsage(): GPUBufferUsageFlags {
  const usage = (globalThis as typeof globalThis & { GPUBufferUsage?: Record<string, number> }).GPUBufferUsage
  return (usage?.UNIFORM ?? 0x40) | (usage?.COPY_DST ?? 0x08)
}

function storageUsage(): GPUBufferUsageFlags {
  const usage = (globalThis as typeof globalThis & { GPUBufferUsage?: Record<string, number> }).GPUBufferUsage
  return (usage?.STORAGE ?? 0x80) | (usage?.COPY_DST ?? 0x08)
}
