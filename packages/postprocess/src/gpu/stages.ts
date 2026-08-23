import type { Micros } from '@mx-player-max/types'
import type { MxaiModel } from '../assets/mxai'
import type { PipelineFrame, SpatialStage, TemporalStage } from '../types'
import { TexturePool, type PooledTexture } from './texture-pool'
import { createRifeGraph, createRt4kSrGraph, graphTensorNames, uploadTensorStore, type GpuModelGraph, type GpuNodeGraph, type GpuTensorStore } from './graph'
import { RifeGraphExecutor } from './rife'
import { Rt4kSrGraphExecutor } from './rt4ksr'
import { UPSCALE_X2_WGSL } from './wgsl'

export interface WebGpuStageOptions {
  readonly device: GPUDevice
  readonly queue?: GPUQueue
  readonly inputWidth?: number
  readonly inputHeight?: number
  readonly texturePoolCapacity?: number
  readonly model?: MxaiModel
  readonly onEpochStale?: () => void
}

/**
 * Practical-RIFE 4.25 frame interpolation.
 *
 * The stage owns the tensor store and the graph executor and does nothing else:
 * IFNet's semantics live in {@link createRifeGraph} and {@link RifeGraphExecutor}.
 * A model is mandatory — there is no model-free approximation, because a bilinear
 * cross-fade is not interpolation and shipping one as "AI" would be a lie.
 */
export class WebGpuInterpolationStage implements TemporalStage {
  readonly id = 'rife-v4.25'
  /** IFNet synthesises between two decoded frames, so the queue needs one extra. */
  readonly lookaheadFrames = 1
  readonly graph: GpuNodeGraph
  readonly #device: GPUDevice
  readonly #queue: GPUQueue
  readonly #tensorStore: GpuTensorStore
  readonly #executor: RifeGraphExecutor
  #closed = false
  #epoch = 0

  constructor(options: WebGpuStageOptions) {
    const model = options.model
    if (!model) throw new Error('The RIFE interpolation stage requires a verified MXAI model')
    this.#device = options.device
    this.#queue = options.queue ?? options.device.queue
    this.graph = createRifeGraph(model)
    this.#tensorStore = uploadTensorStore(options.device, model, new Set(this.graph.tensorNames), this.graph.derivedTensors)
    try {
      this.#executor = RifeGraphExecutor.create({
        device: options.device,
        queue: this.#queue,
        model,
        tensorStore: this.#tensorStore,
        graph: this.graph,
        ...(options.texturePoolCapacity === undefined ? {} : { texturePoolCapacity: options.texturePoolCapacity }),
      })
    } catch (cause) {
      this.#tensorStore.close()
      throw cause
    }
  }

  async synthesize(a: PipelineFrame, b: PipelineFrame, phase: number, epoch: number): Promise<PipelineFrame> {
    if (this.#closed) throw new Error('RIFE stage is closed')
    if (!Number.isFinite(phase) || phase < 0 || phase > 1) throw new Error('Interpolation phase must be in [0, 1]')
    this.#epoch = epoch
    const inputA = await ensureGpuTexture(this.#device, this.#queue, a)
    const inputB = await ensureGpuTexture(this.#device, this.#queue, b)
    try {
      if (inputA.width !== inputB.width || inputA.height !== inputB.height) throw new Error('RIFE requires both frames at the same resolution')
      const result = await this.#executor.process({
        source0: inputA.texture,
        source1: inputB.texture,
        width: inputA.width,
        height: inputA.height,
        timestep: phase,
        timestamp: a.timestamp + Math.round((b.timestamp - a.timestamp) * phase),
      })
      if (epoch !== this.#epoch) {
        if (result.frame.location === 'gpu') result.frame.release()
        throw new Error('Stale interpolation epoch')
      }
      return result.frame
    } finally {
      releaseTemporary(inputA, a)
      releaseTemporary(inputB, b)
    }
  }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    this.#executor.close()
    this.#tensorStore.close()
  }
}

export class WebGpuSuperResolutionStage implements SpatialStage {
  readonly id: string
  readonly #device: GPUDevice
  readonly #queue: GPUQueue
  readonly #pool: TexturePool
  readonly #pipeline: GPUComputePipeline
  readonly #layout: GPUBindGroupLayout
  readonly #params: GPUBuffer
  readonly #modelWeights: GPUBuffer
  readonly #tensorStore: GpuTensorStore | null
  readonly #graphExecutor: Rt4kSrGraphExecutor | null
  readonly graph: GpuModelGraph | null
  #closed = false
  #epoch = 0

  constructor(options: WebGpuStageOptions & { readonly id?: string }) {
    this.id = options.id ?? 'rt4ksr-x2'
    this.#device = options.device
    this.#queue = options.queue ?? options.device.queue
    this.#pool = new TexturePool({ device: options.device, capacity: options.texturePoolCapacity ?? 4 })
    this.graph = options.model ? createRt4kSrGraph(options.model) : null
    this.#tensorStore = options.model ? uploadTensorStore(options.device, options.model, this.graph ? graphTensorNames(this.graph) : undefined) : null
    this.#graphExecutor = options.model && this.#tensorStore ? Rt4kSrGraphExecutor.create({ device: options.device, queue: this.#queue, model: options.model, tensorStore: this.#tensorStore }) : null
    this.#modelWeights = createModelBindingBuffer(options.device, this.#tensorStore, 'module.upsample.0.weight')
    const module = options.device.createShaderModule({ code: UPSCALE_X2_WGSL })
    this.#layout = options.device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: shaderComputeStage(), texture: { sampleType: 'float' } },
      { binding: 1, visibility: shaderComputeStage(), storageTexture: { access: 'write-only', format: 'rgba8unorm' } },
      { binding: 2, visibility: shaderComputeStage(), buffer: { type: 'uniform' } },
      { binding: 3, visibility: shaderComputeStage(), buffer: { type: 'read-only-storage' } },
    ] })
    this.#pipeline = options.device.createComputePipeline({ layout: options.device.createPipelineLayout({ bindGroupLayouts: [this.#layout] }), compute: { module, entryPoint: 'main' } })
    this.#params = options.device.createBuffer({ size: 16, usage: uniformBufferUsage() })
  }

  outputSize(width: number, height: number): { width: number; height: number } {
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 || width > 8192 || height > 8192) throw new Error('Invalid super-resolution input size')
    return { width: width * 2, height: height * 2 }
  }

  async process(input: PipelineFrame, epoch: number): Promise<PipelineFrame> {
    if (this.#closed) throw new Error('Super-resolution stage is closed')
    this.#epoch = epoch
    const source = await ensureGpuTexture(this.#device, this.#queue, input)
    if (this.#graphExecutor) {
      try {
        if (epoch !== this.#epoch) throw new Error('Stale super-resolution epoch')
        const result = await this.#graphExecutor.process(source.texture, source.width, source.height, epoch, input.timestamp)
        if (epoch !== this.#epoch) {
          if (result.location === 'gpu') result.release()
          throw new Error('Stale super-resolution epoch')
        }
        return result
      } finally {
        releaseTemporary(source, input)
      }
    }
    const size = this.outputSize(source.width, source.height)
    const output = this.#pool.acquire(size.width, size.height)
    try {
      this.#queue.writeBuffer(this.#params, 0, new Uint32Array([source.width, source.height, size.width, size.height]))
      const bindGroup = this.#device.createBindGroup({ layout: this.#layout, entries: [
        { binding: 0, resource: source.texture.createView() },
        { binding: 1, resource: output.texture.createView() },
        { binding: 2, resource: { buffer: this.#params } },
        { binding: 3, resource: { buffer: this.#modelWeights } },
      ] })
      const encoder = this.#device.createCommandEncoder()
      const pass = encoder.beginComputePass()
      pass.setPipeline(this.#pipeline)
      pass.setBindGroup(0, bindGroup)
      pass.dispatchWorkgroups(Math.ceil(size.width / 8), Math.ceil(size.height / 8))
      pass.end()
      this.#queue.submit([encoder.finish()])
      await this.#queue.onSubmittedWorkDone()
      if (epoch !== this.#epoch) throw new Error('Stale super-resolution epoch')
      return gpuFrame(output, input.timestamp)
    } catch (error) {
      output.release()
      throw error
    } finally {
      releaseTemporary(source, input)
    }
  }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    try { this.#params.destroy() } catch { /* best effort */ }
    try { this.#modelWeights.destroy() } catch { /* best effort */ }
    this.#graphExecutor?.close()
    this.#tensorStore?.close()
    this.#pool.close()
  }
}

interface GpuSource { texture: GPUTexture; width: number; height: number; owned: boolean; release?: () => void }

async function ensureGpuTexture(device: GPUDevice, queue: GPUQueue, frame: PipelineFrame): Promise<GpuSource> {
  if (frame.location === 'gpu') return { texture: frame.texture, width: frame.width, height: frame.height, owned: false }
  const width = frame.frame.displayWidth || frame.frame.codedWidth
  const height = frame.frame.displayHeight || frame.frame.codedHeight
  const texture = device.createTexture({ size: { width, height }, format: 'rgba8unorm', usage: runtimeTextureUsage() })
  // Queue operations run in issue order, so the copy is complete before the
  // compute submission that samples this texture. No fence is needed here.
  queue.copyExternalImageToTexture({ source: frame.frame }, { texture }, { width, height })
  return { texture, width, height, owned: true }
}

function releaseTemporary(source: GpuSource, input: PipelineFrame): void {
  if (source.owned) {
    try { source.texture.destroy() } catch { /* best effort */ }
  }
}

function gpuFrame(output: PooledTexture, timestamp: Micros): PipelineFrame {
  return { location: 'gpu', texture: output.texture, width: output.width, height: output.height, timestamp, release: output.release }
}

function shaderComputeStage(): GPUShaderStageFlags {
  return (globalThis as typeof globalThis & { GPUShaderStage?: { COMPUTE?: number } }).GPUShaderStage?.COMPUTE ?? 4
}

function uniformBufferUsage(): GPUBufferUsageFlags {
  const usage = (globalThis as typeof globalThis & { GPUBufferUsage?: Record<string, number> }).GPUBufferUsage
  return (usage?.UNIFORM ?? 0x40) | (usage?.COPY_DST ?? 0x08)
}

function runtimeTextureUsage(): GPUTextureUsageFlags {
  const usage = (globalThis as typeof globalThis & { GPUTextureUsage?: Record<string, number> }).GPUTextureUsage
  // `copyExternalImageToTexture` validates that the destination carries both
  // COPY_DST and RENDER_ATTACHMENT, so an upload target needs all four flags.
  if (usage) return (usage.TEXTURE_BINDING ?? 0) | (usage.STORAGE_BINDING ?? 0) | (usage.COPY_DST ?? 0) | (usage.RENDER_ATTACHMENT ?? 0)
  return 0x04 | 0x08 | 0x02 | 0x10
}

function createModelBindingBuffer(device: GPUDevice, store: GpuTensorStore | null, preferredName: string): GPUBuffer {
  const tensor = store?.tensors.get(preferredName) ?? store?.tensors.values().next().value
  if (tensor) return tensor.buffer
  const usage = uniformBufferUsage()
  const buffer = device.createBuffer({ size: 4, usage: usage | storageBufferUsage() })
  const zero = new Float32Array([0])
  device.queue.writeBuffer(buffer, 0, zero)
  return buffer
}

function storageBufferUsage(): GPUBufferUsageFlags {
  const usage = (globalThis as typeof globalThis & { GPUBufferUsage?: Record<string, number> }).GPUBufferUsage
  return usage?.STORAGE ?? 0x80
}
