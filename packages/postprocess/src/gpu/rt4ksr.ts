import type { MxaiModel } from '../assets/mxai'
import type { PipelineFrame } from '../types'
import { createRt4kSrGraph, type GpuGraphLayer, type GpuGraphSlot, type GpuModelGraph, type GpuTensorStore } from './graph'
import { PackedTexturePool, type PackedTexture } from './packed'
import { TexturePool, type PooledTexture } from './texture-pool'
import { PACKED_CONVOLUTION_WGSL, PACKED_INPUT_WGSL, PACKED_LAYER_NORM_WGSL, PACKED_PIXEL_SHUFFLE_X4_WGSL, PACKED_PIXEL_UNSHUFFLE_WGSL } from './wgsl'

const ACTIVATION_CODE: Record<GpuGraphLayer['activation'], number> = { none: 0, relu: 1, 'leaky-relu': 2, gelu: 3 }
const PAD_CODE = { zero: 0, clamp: 1, constant: 2 } as const

/** Writes one pass's uniform block into the shared buffer and returns its binding. */
type ParamsWriter = (values: ArrayBufferView) => GPUBufferBinding

function arrayView(texture: PackedTexture): GPUTextureView {
  return texture.texture.createView({ dimension: '2d-array', arrayLayerCount: texture.groups })
}

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
  /** One uniform buffer, one aligned slot per pass, so a single submission carries every layer's params. */
  readonly #uniforms: GPUBuffer
  readonly #uniformStride: number
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
    // Input pack, unshuffle, one slot per layer, then the output shuffle.
    const slots = this.graph.layers.length + 3
    this.#uniformStride = Math.max(256, this.#device.limits?.minUniformBufferOffsetAlignment ?? 256)
    this.#uniforms = this.#device.createBuffer({ size: slots * this.#uniformStride, usage: uniformUsage() })
    this.#zero = this.#device.createBuffer({ size: 4, usage: storageUsage() })
    this.#queue.writeBuffer(this.#zero, 0, new Float32Array([0]))
  }

  async process(source: GPUTexture, width: number, height: number, _epoch: number, timestamp: number): Promise<PipelineFrame> {
    if (this.#closed) throw new Error('RT4KSR graph is closed')
    if (width % 2 !== 0 || height % 2 !== 0) throw new Error('RT4KSR requires even input dimensions')
    const slots = new Map<GpuGraphSlot, PackedTexture>()
    const isHeld = (texture: PackedTexture): boolean => {
      for (const held of slots.values()) if (held === texture) return true
      return false
    }
    let current: PackedTexture | null = null
    let pending: PackedTexture | null = null
    let result: PooledTexture | null = null
    // Every pass goes into one encoder and one submission: dispatches are ordered
    // and separated by implicit barriers, so the only fence is the final one, which
    // the governor needs in order to measure the frame.
    const encoder = this.#device.createCommandEncoder()
    let slot = 0
    const params = (values: ArrayBufferView): GPUBufferBinding => {
      const offset = slot * this.#uniformStride
      slot += 1
      this.#queue.writeBuffer(this.#uniforms, offset, values.buffer as ArrayBuffer, values.byteOffset, values.byteLength)
      return { buffer: this.#uniforms, offset, size: this.#uniformStride }
    }
    try {
      current = this.#packedPool.acquire(width, height, 3)
      this.#runInput(encoder, params, source, current, width, height)
      pending = this.#packedPool.acquire(Math.floor(width / 2), Math.floor(height / 2), 12)
      this.#runUnshuffle(encoder, params, current, pending, width, height)
      current.release()
      current = pending
      pending = null

      for (const layer of this.graph.layers) {
        if (layer.saveInput) slots.set(layer.saveInput, current)
        const channels = layer.kind === 'layernorm' ? current.channels : layer.outputChannels
        pending = this.#packedPool.acquire(current.width / layer.stride, current.height / layer.stride, channels)
        const residual = layer.residualFrom === undefined ? null : slots.get(layer.residualFrom) ?? null
        if (layer.residualFrom !== undefined && !residual) throw new Error(`RT4KSR layer ${layer.id} needs an unset ${layer.residualFrom} slot`)
        if (layer.kind === 'layernorm') this.#runNorm(encoder, params, current, pending, layer)
        else this.#runConv(encoder, params, current, pending, layer, residual)
        const previous = current
        current = pending
        pending = null
        if (layer.residualFrom !== undefined) {
          slots.delete(layer.residualFrom)
          if (residual && residual !== previous && !isHeld(residual)) residual.release()
        }
        if (!isHeld(previous)) previous.release()
        if (layer.saveOutput) slots.set(layer.saveOutput, current)
      }

      result = this.#outputPool.acquire(width * 2, height * 2)
      this.#runShuffle(encoder, params, current, result, width / 2, height / 2)
      this.#queue.submit([encoder.finish()])
      await this.#queue.onSubmittedWorkDone()
      current.release()
      current = null
      const frame: PipelineFrame = { location: 'gpu', texture: result.texture, width: result.width, height: result.height, timestamp, release: result.release }
      result = null
      return frame
    } catch (error) {
      current?.release()
      pending?.release()
      for (const held of slots.values()) if (held !== current) held.release()
      result?.release()
      throw error
    } finally {
      slots.clear()
    }
  }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    for (const buffer of [this.#uniforms, this.#zero]) {
      try { buffer.destroy() } catch { /* best effort */ }
    }
    this.#packedPool.close()
    this.#outputPool.close()
  }

  #runInput(encoder: GPUCommandEncoder, params: ParamsWriter, source: GPUTexture, output: PackedTexture, width: number, height: number): void {
    this.#record(encoder, this.#inputPipeline, [
      { binding: 0, resource: source.createView() },
      { binding: 1, resource: arrayView(output) },
      { binding: 2, resource: params(new Uint32Array([width, height, width, height])) },
    ], Math.ceil(width / 8), Math.ceil(height / 8), 1)
  }

  #runUnshuffle(encoder: GPUCommandEncoder, params: ParamsWriter, input: PackedTexture, output: PackedTexture, width: number, height: number): void {
    this.#record(encoder, this.#unshufflePipeline, [
      { binding: 0, resource: arrayView(input) },
      { binding: 1, resource: arrayView(output) },
      { binding: 2, resource: params(new Uint32Array([width, height, 3, 2, output.groups])) },
    ], Math.ceil(output.width / 8), Math.ceil(output.height / 8), output.groups)
  }

  #runConv(encoder: GPUCommandEncoder, params: ParamsWriter, input: PackedTexture, output: PackedTexture, layer: GpuGraphLayer, residual: PackedTexture | null): void {
    const weights = this.#store.tensors.get(layer.weight)
    if (!weights) throw new Error(`RT4KSR graph tensor is missing: ${layer.weight}`)
    const bias = layer.bias === undefined ? null : this.#store.tensors.get(layer.bias)
    if (!bias && layer.bias !== undefined) throw new Error(`RT4KSR graph bias is missing: ${layer.bias}`)
    const padValues = layer.padValues === undefined ? null : this.#store.tensors.get(layer.padValues)
    if (!padValues && layer.padValues !== undefined) throw new Error(`RT4KSR pad tensor is missing: ${layer.padValues}`)
    const values = new ArrayBuffer(64)
    const view = new DataView(values)
    const words = [
      input.width, input.height, output.width, output.height,
      layer.inputChannels, layer.outputChannels, layer.kernel, layer.stride,
      input.groups, output.groups, ACTIVATION_CODE[layer.activation], residual ? 1 : 0,
      PAD_CODE[layer.padMode], layer.activationAfterResidual === true ? 1 : 0,
    ]
    words.forEach((word, index) => view.setUint32(index * 4, word, true))
    view.setFloat32(56, layer.leakySlope ?? 0.05, true)
    this.#record(encoder, this.#convPipeline, [
      { binding: 0, resource: arrayView(input) },
      { binding: 1, resource: arrayView(output) },
      { binding: 2, resource: { buffer: weights.buffer } },
      { binding: 3, resource: { buffer: bias?.buffer ?? this.#zero } },
      { binding: 4, resource: params(new Uint8Array(values)) },
      { binding: 5, resource: arrayView(residual ?? input) },
      { binding: 6, resource: { buffer: padValues?.buffer ?? this.#zero } },
    ], Math.ceil(output.width / 8), Math.ceil(output.height / 8), output.groups)
  }

  #runNorm(encoder: GPUCommandEncoder, params: ParamsWriter, input: PackedTexture, output: PackedTexture, layer: GpuGraphLayer): void {
    const scale = this.#store.tensors.get(layer.weight)
    const shift = layer.bias === undefined ? null : this.#store.tensors.get(layer.bias)
    if (!scale || !shift) throw new Error(`RT4KSR layer norm tensors are missing for ${layer.weight}`)
    const values = new ArrayBuffer(32)
    const view = new DataView(values)
    view.setUint32(0, input.width, true)
    view.setUint32(4, input.height, true)
    view.setUint32(8, input.channels, true)
    view.setUint32(12, input.groups, true)
    view.setFloat32(16, 1e-6, true)
    this.#record(encoder, this.#normPipeline, [
      { binding: 0, resource: arrayView(input) },
      { binding: 1, resource: arrayView(output) },
      { binding: 2, resource: { buffer: scale.buffer } },
      { binding: 3, resource: { buffer: shift.buffer } },
      { binding: 4, resource: params(new Uint8Array(values)) },
    ], Math.ceil(output.width / 8), Math.ceil(output.height / 8), output.groups)
  }

  #runShuffle(encoder: GPUCommandEncoder, params: ParamsWriter, input: PackedTexture, output: PooledTexture, width: number, height: number): void {
    this.#record(encoder, this.#shufflePipeline, [
      { binding: 0, resource: arrayView(input) },
      { binding: 1, resource: output.texture.createView() },
      { binding: 2, resource: params(new Uint32Array([width, height, output.width, output.height, 3, 4, input.groups, 0])) },
    ], Math.ceil(output.width / 8), Math.ceil(output.height / 8), 1)
  }

  #record(encoder: GPUCommandEncoder, pipeline: GPUComputePipeline, entries: GPUBindGroupEntry[], x: number, y: number, z: number): void {
    const bindGroup = this.#device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries })
    const pass = encoder.beginComputePass()
    pass.setPipeline(pipeline)
    pass.setBindGroup(0, bindGroup)
    pass.dispatchWorkgroups(x, y, z)
    pass.end()
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
