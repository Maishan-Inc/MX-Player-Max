import type { Micros } from '@mx-player-max/types'
import type { MxaiModel } from '../assets/mxai'
import type { PipelineFrame } from '../types'
import { createRifeGraph, nodeGraphInputs, type GpuActivation, type GpuBlendNode, type GpuGraphNode, type GpuNodeGraph, type GpuTensorStore } from './graph'
import { PackedTexturePool, type PackedTexture } from './packed'
import { TexturePool, type PooledTexture } from './texture-pool'
import {
  PACKED_ADD_WGSL,
  PACKED_CONVOLUTION_WGSL,
  PACKED_FILL_WGSL,
  PACKED_GATHER_WGSL,
  PACKED_INPUT_WGSL,
  PACKED_MASK_BLEND_WGSL,
  PACKED_PIXEL_SHUFFLE_2_WGSL,
  PACKED_RESIZE_WGSL,
  PACKED_TRANSPOSED_CONVOLUTION_WGSL,
  PACKED_WARP_WGSL,
  withPackedActivationFormat,
  type PackedActivationFormat,
} from './wgsl'

const ACTIVATION_CODE: Record<GpuActivation, number> = { none: 0, relu: 1, 'leaky-relu': 2, gelu: 3 }
/** The gather kernel declares eight source bindings; inactive ones are ignored. */
const GATHER_SLOTS = 8

/** Writes one pass's uniform block into the shared buffer and returns its binding. */
type ParamsWriter = (values: ArrayBufferView) => GPUBufferBinding

export interface RifeExecutorOptions {
  readonly device: GPUDevice
  readonly queue?: GPUQueue
  readonly model: MxaiModel
  readonly tensorStore: GpuTensorStore
  /**
   * A pre-built graph. Defaults to `createRifeGraph(model)`. The tensor store must
   * bind the same names, including the beta-folded ones.
   */
  readonly graph?: GpuNodeGraph
  readonly texturePoolCapacity?: number
  /**
   * Storage format for intermediate activations. Defaults to `rgba32float`: IFNet's
   * flow is a pixel displacement that five blocks feed back into each other's warps,
   * and a half-float ulp at |5| is 4e-3 of a pixel, which the network amplifies into
   * a visible blend error. `rgba16float` halves the memory and is measurably worse —
   * `pnpm quality:webgpu:rife` reports both.
   */
  readonly activationFormat?: PackedActivationFormat
}

export interface RifeSynthesisRequest {
  readonly source0: GPUTexture
  readonly source1: GPUTexture
  readonly width: number
  readonly height: number
  /** IFNet's `timestep` plane: 0 is frame A, 1 is frame B. */
  readonly timestep: number
  readonly timestamp: Micros
  /**
   * Node ids whose packed output is handed back instead of released, so a caller
   * can compare an intermediate IFNet stage against the upstream reference. The
   * caller owns each returned texture and must release it exactly once.
   */
  readonly retain?: readonly string[]
}

export interface RifeSynthesisResult {
  readonly frame: PipelineFrame
  readonly retained: ReadonlyMap<string, PackedTexture>
}

function arrayView(texture: PackedTexture): GPUTextureView {
  return texture.texture.createView({ dimension: '2d-array', arrayLayerCount: texture.groups })
}

/**
 * Practical-RIFE 4.25 IFNet, executed as a packed-tensor DAG.
 *
 * The graph is interpreted rather than hardcoded: {@link createRifeGraph} emits the
 * five coarse-to-fine IFBlocks, the shared encoder, the concat/slice nodes and the
 * flow feedback, and this class maps each node kind onto one audited WGSL kernel.
 * Activations stay in `rgba16float` array textures with four NCHW channels per
 * layer; nothing is read back to the CPU and every intermediate comes from a
 * bounded pool.
 *
 * Like the RT4KSR executor, the whole frame is one command encoder, one submission
 * and one fence, and each pass reads its uniform block from its own 256-byte
 * aligned slot of a single buffer — every `writeBuffer` lands before the single
 * submit, so a shared slot would be overwritten before the GPU ran the pass.
 */
export class RifeGraphExecutor {
  readonly graph: GpuNodeGraph
  readonly #device: GPUDevice
  readonly #queue: GPUQueue
  readonly #store: GpuTensorStore
  readonly #packedPool: PackedTexturePool
  readonly #outputPool: TexturePool
  readonly #pipelines: Record<GpuGraphNode['kind'], GPUComputePipeline>
  readonly #uniforms: GPUBuffer
  readonly #uniformStride: number
  readonly #zero: GPUBuffer
  /** Index of the last node that reads each node's output, for texture reuse. */
  readonly #lastUse: ReadonlyMap<string, number>
  #closed = false

  static create(options: RifeExecutorOptions): RifeGraphExecutor {
    return new RifeGraphExecutor(options)
  }

  private constructor(options: RifeExecutorOptions) {
    this.#device = options.device
    this.#queue = options.queue ?? options.device.queue
    this.#store = options.tensorStore
    this.graph = options.graph ?? createRifeGraph(options.model)
    for (const name of this.graph.tensorNames) {
      if (!this.#store.tensors.has(name)) throw new Error(`RIFE tensor store is missing ${name}`)
    }
    this.#packedPool = new PackedTexturePool(this.#device, options.texturePoolCapacity ?? 128, options.activationFormat ?? 'rgba32float')
    this.#outputPool = new TexturePool({ device: this.#device, capacity: 4 })
    const kernel = (code: string): GPUComputePipeline => makePipeline(this.#device, withPackedActivationFormat(code, this.#packedPool.format))
    this.#pipelines = {
      input: kernel(PACKED_INPUT_WGSL),
      fill: kernel(PACKED_FILL_WGSL),
      conv: kernel(PACKED_CONVOLUTION_WGSL),
      'transposed-conv': kernel(PACKED_TRANSPOSED_CONVOLUTION_WGSL),
      'pixel-shuffle': kernel(PACKED_PIXEL_SHUFFLE_2_WGSL),
      resize: kernel(PACKED_RESIZE_WGSL),
      warp: kernel(PACKED_WARP_WGSL),
      gather: kernel(PACKED_GATHER_WGSL),
      add: kernel(PACKED_ADD_WGSL),
      blend: kernel(PACKED_MASK_BLEND_WGSL),
    }
    this.#uniformStride = Math.max(256, this.#device.limits?.minUniformBufferOffsetAlignment ?? 256)
    this.#uniforms = this.#device.createBuffer({ size: Math.max(1, this.graph.nodes.length) * this.#uniformStride, usage: uniformUsage() })
    this.#zero = this.#device.createBuffer({ size: 4, usage: storageUsage() })
    this.#queue.writeBuffer(this.#zero, 0, new Float32Array([0]))
    const lastUse = new Map<string, number>()
    this.graph.nodes.forEach((node, index) => {
      for (const id of nodeGraphInputs(node)) lastUse.set(id, index)
    })
    this.#lastUse = lastUse
  }

  /** Storage format the intermediate activations use. */
  get activationFormat(): PackedActivationFormat { return this.#packedPool.format }
  /** Activation textures the pool holds, which is the peak of the frames run so far. */
  get activationTextures(): number { return this.#packedPool.allocated }
  /** Bytes those textures occupy. IFNet keeps most of its graph at full resolution. */
  get activationBytes(): number { return this.#packedPool.allocatedBytes }

  /**
   * The dimensions IFNet actually runs at: a multiple of `graph.sizeMultiple` in
   * both axes. Block 0 resizes its input to 1/16 and `conv0` halves it twice, so an
   * unpadded 1080p frame would misalign every scale. Upstream `inference` pads the
   * same way, at the right and bottom edges, and crops the result.
   */
  paddedSize(width: number, height: number): { width: number; height: number } {
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 || width > 8192 || height > 8192) {
      throw new Error('RIFE requires positive integer frame dimensions up to 8192')
    }
    const multiple = this.graph.sizeMultiple
    return { width: Math.ceil(width / multiple) * multiple, height: Math.ceil(height / multiple) * multiple }
  }

  async process(request: RifeSynthesisRequest): Promise<RifeSynthesisResult> {
    if (this.#closed) throw new Error('RIFE graph is closed')
    if (!Number.isFinite(request.timestep) || request.timestep < 0 || request.timestep > 1) throw new Error('RIFE timestep must be in [0, 1]')
    const padded = this.paddedSize(request.width, request.height)
    const retain = new Set(request.retain ?? [])
    for (const id of retain) {
      if (!this.graph.nodes.some((node) => node.id === id)) throw new Error(`RIFE graph has no node ${id}`)
    }
    const live = new Map<string, PackedTexture>()
    let output: PooledTexture | null = null
    // One encoder, one submission, one fence: passes are ordered and separated by
    // implicit barriers, so a released texture can be reused by a later pass.
    const encoder = this.#device.createCommandEncoder()
    let slot = 0
    const params: ParamsWriter = (values) => {
      const offset = slot * this.#uniformStride
      slot += 1
      this.#queue.writeBuffer(this.#uniforms, offset, values.buffer as ArrayBuffer, values.byteOffset, values.byteLength)
      return { buffer: this.#uniforms, offset, size: this.#uniformStride }
    }
    const read = (id: string): PackedTexture => {
      const texture = live.get(id)
      if (!texture) throw new Error(`RIFE node ${id} was released before it was read`)
      return texture
    }
    try {
      for (let index = 0; index < this.graph.nodes.length; index += 1) {
        const node = this.graph.nodes[index]
        if (!node) throw new Error('RIFE graph node list is sparse')
        if (node.kind === 'blend') {
          // The blend runs over the unpadded frame, which is also the crop.
          output = this.#outputPool.acquire(request.width, request.height)
          this.#recordBlend(encoder, params, node, read, output)
        } else {
          // Acquire the destination before releasing any input, so a reused pool
          // slot can never alias an input of the pass being recorded.
          const target = this.#packedPool.acquire(padded.width / node.divisor, padded.height / node.divisor, node.channels)
          live.set(node.id, target)
          this.#record(encoder, params, node, read, target, request)
        }
        for (const id of nodeGraphInputs(node)) {
          if (retain.has(id) || this.#lastUse.get(id) !== index) continue
          live.get(id)?.release()
          live.delete(id)
        }
      }
      if (!output) throw new Error('RIFE graph recorded no output frame')
      this.#queue.submit([encoder.finish()])
      await this.#queue.onSubmittedWorkDone()
      const retained = new Map<string, PackedTexture>()
      for (const [id, texture] of live) {
        if (retain.has(id)) retained.set(id, texture)
        else texture.release()
      }
      live.clear()
      const frame: PipelineFrame = { location: 'gpu', texture: output.texture, width: output.width, height: output.height, timestamp: request.timestamp, release: output.release }
      output = null
      return { frame, retained }
    } catch (error) {
      for (const texture of live.values()) texture.release()
      live.clear()
      output?.release()
      throw error
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

  #record(
    encoder: GPUCommandEncoder,
    params: ParamsWriter,
    node: GpuGraphNode,
    read: (id: string) => PackedTexture,
    target: PackedTexture,
    request: RifeSynthesisRequest,
  ): void {
    switch (node.kind) {
      case 'input': {
        const source = node.source === 0 ? request.source0 : request.source1
        this.#dispatch(encoder, this.#pipelines.input, [
          { binding: 0, resource: source.createView() },
          { binding: 1, resource: arrayView(target) },
          { binding: 2, resource: params(new Uint32Array([target.width, target.height, request.width, request.height])) },
        ], target.width, target.height, 1)
        return
      }
      case 'fill': {
        const value = node.value === 'timestep' ? request.timestep : node.value
        const values = new DataView(new ArrayBuffer(32))
        values.setUint32(0, target.width, true)
        values.setUint32(4, target.height, true)
        values.setUint32(8, target.groups, true)
        for (let lane = 0; lane < 4; lane += 1) values.setFloat32(16 + lane * 4, value, true)
        this.#dispatch(encoder, this.#pipelines.fill, [
          { binding: 0, resource: arrayView(target) },
          { binding: 1, resource: params(new Uint8Array(values.buffer)) },
        ], target.width, target.height, target.groups)
        return
      }
      case 'conv': {
        const input = read(node.input)
        const residual = node.residual === undefined ? null : read(node.residual)
        const values = new DataView(new ArrayBuffer(64))
        // padMode 0 is zero padding: every RIFE convolution is `padding=1` on a 3x3
        // kernel, which is what the kernel's `kernel / 2` radius already applies.
        const words = [
          input.width, input.height, target.width, target.height,
          node.inputChannels, node.channels, node.kernel, node.stride,
          input.groups, target.groups, ACTIVATION_CODE[node.activation], residual ? 1 : 0,
          0, residual ? 1 : 0,
        ]
        words.forEach((word, index) => values.setUint32(index * 4, word, true))
        values.setFloat32(56, node.leakySlope ?? 0, true)
        this.#dispatch(encoder, this.#pipelines.conv, [
          { binding: 0, resource: arrayView(input) },
          { binding: 1, resource: arrayView(target) },
          { binding: 2, resource: { buffer: this.#tensor(node.weight) } },
          { binding: 3, resource: { buffer: this.#tensor(node.bias) } },
          { binding: 4, resource: params(new Uint8Array(values.buffer)) },
          { binding: 5, resource: arrayView(residual ?? input) },
          { binding: 6, resource: { buffer: this.#zero } },
        ], target.width, target.height, target.groups)
        return
      }
      case 'transposed-conv': {
        const input = read(node.input)
        const values = new DataView(new ArrayBuffer(64))
        const words = [
          input.width, input.height, target.width, target.height,
          node.inputChannels, node.channels, node.kernel, node.stride,
          input.groups, target.groups, ACTIVATION_CODE[node.activation], node.pad,
        ]
        words.forEach((word, index) => values.setUint32(index * 4, word, true))
        values.setFloat32(48, node.leakySlope ?? 0, true)
        this.#dispatch(encoder, this.#pipelines['transposed-conv'], [
          { binding: 0, resource: arrayView(input) },
          { binding: 1, resource: arrayView(target) },
          { binding: 2, resource: { buffer: this.#tensor(node.weight) } },
          { binding: 3, resource: { buffer: this.#tensor(node.bias) } },
          { binding: 4, resource: params(new Uint8Array(values.buffer)) },
        ], target.width, target.height, target.groups)
        return
      }
      case 'pixel-shuffle': {
        const input = read(node.input)
        this.#dispatch(encoder, this.#pipelines['pixel-shuffle'], [
          { binding: 0, resource: arrayView(input) },
          { binding: 1, resource: arrayView(target) },
          { binding: 2, resource: params(new Uint32Array([input.width, input.height, target.width, target.height, node.channels, node.factor, target.groups, 0])) },
        ], target.width, target.height, target.groups)
        return
      }
      case 'resize': {
        const input = read(node.input)
        const values = new DataView(new ArrayBuffer(32))
        ;[input.width, input.height, target.width, target.height, node.channels, target.groups]
          .forEach((word, index) => values.setUint32(index * 4, word, true))
        values.setFloat32(24, node.valueScale, true)
        this.#dispatch(encoder, this.#pipelines.resize, [
          { binding: 0, resource: arrayView(input) },
          { binding: 1, resource: arrayView(target) },
          { binding: 2, resource: params(new Uint8Array(values.buffer)) },
        ], target.width, target.height, target.groups)
        return
      }
      case 'warp': {
        const input = read(node.input)
        const flow = read(node.flow)
        this.#dispatch(encoder, this.#pipelines.warp, [
          { binding: 0, resource: arrayView(input) },
          { binding: 1, resource: arrayView(flow) },
          { binding: 2, resource: arrayView(target) },
          { binding: 3, resource: params(new Uint32Array([target.width, target.height, node.channels, target.groups, node.flowChannel, 0, 0, 0])) },
        ], target.width, target.height, target.groups)
        return
      }
      case 'gather': {
        const values = new DataView(new ArrayBuffer(16 + GATHER_SLOTS * 16))
        values.setUint32(0, target.width, true)
        values.setUint32(4, target.height, true)
        values.setUint32(8, node.channels, true)
        values.setUint32(12, target.groups, true)
        const fallback = node.slots[0]
        if (!fallback) throw new Error(`RIFE gather node ${node.id} has no slots`)
        const entries: GPUBindGroupEntry[] = []
        for (let index = 0; index < GATHER_SLOTS; index += 1) {
          const entry = node.slots[index]
          const base = 16 + index * 16
          if (entry) {
            values.setUint32(base, entry.sourceOffset, true)
            values.setUint32(base + 4, entry.channels, true)
            values.setFloat32(base + 8, entry.valueScale, true)
          }
          // An inactive slot keeps a valid binding; its channel count is zero, so
          // the kernel never reads it.
          entries.push({ binding: index, resource: arrayView(read((entry ?? fallback).source)) })
        }
        entries.push({ binding: GATHER_SLOTS, resource: arrayView(target) })
        entries.push({ binding: GATHER_SLOTS + 1, resource: params(new Uint8Array(values.buffer)) })
        this.#dispatch(encoder, this.#pipelines.gather, entries, target.width, target.height, target.groups)
        return
      }
      case 'add': {
        this.#dispatch(encoder, this.#pipelines.add, [
          { binding: 0, resource: arrayView(read(node.left)) },
          { binding: 1, resource: arrayView(read(node.right)) },
          { binding: 2, resource: arrayView(target) },
          { binding: 3, resource: params(new Uint32Array([target.width, target.height, target.groups, 0])) },
        ], target.width, target.height, target.groups)
        return
      }
      default:
        throw new Error(`RIFE executor cannot record a ${node.kind} node into a packed texture`)
    }
  }

  #recordBlend(encoder: GPUCommandEncoder, params: ParamsWriter, node: GpuBlendNode, read: (id: string) => PackedTexture, output: PooledTexture): void {
    this.#dispatch(encoder, this.#pipelines.blend, [
      { binding: 0, resource: arrayView(read(node.first)) },
      { binding: 1, resource: arrayView(read(node.second)) },
      { binding: 2, resource: arrayView(read(node.mask)) },
      { binding: 3, resource: output.texture.createView() },
      { binding: 4, resource: params(new Uint32Array([output.width, output.height, node.maskChannel, 0])) },
    ], output.width, output.height, 1)
  }

  #tensor(name: string): GPUBuffer {
    const tensor = this.#store.tensors.get(name)
    if (!tensor) throw new Error(`RIFE graph tensor is missing: ${name}`)
    return tensor.buffer
  }

  #dispatch(encoder: GPUCommandEncoder, pipeline: GPUComputePipeline, entries: GPUBindGroupEntry[], width: number, height: number, depth: number): void {
    const bindGroup = this.#device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries })
    const pass = encoder.beginComputePass()
    pass.setPipeline(pipeline)
    pass.setBindGroup(0, bindGroup)
    pass.dispatchWorkgroups(Math.ceil(width / 8), Math.ceil(height / 8), depth)
    pass.end()
  }
}

function makePipeline(device: GPUDevice, code: string): GPUComputePipeline {
  const module = device.createShaderModule({ code })
  return device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint: 'main' } })
}

function uniformUsage(): GPUBufferUsageFlags {
  const usage = (globalThis as typeof globalThis & { GPUBufferUsage?: Record<string, number> }).GPUBufferUsage
  return (usage?.UNIFORM ?? 0x40) | (usage?.COPY_DST ?? 0x08)
}

function storageUsage(): GPUBufferUsageFlags {
  const usage = (globalThis as typeof globalThis & { GPUBufferUsage?: Record<string, number> }).GPUBufferUsage
  return (usage?.STORAGE ?? 0x80) | (usage?.COPY_DST ?? 0x08)
}
