import type { RendererCapabilities } from '@mx-player-max/types'
import { ErrorCodes } from '@mx-player-max/types'
import { BaseRenderer, FILTERS, type RendererBackendOptions } from './base'
import { rendererError } from './errors'
import type { ValidatedFrame } from './validation'

const SHADER = `struct VertexOutput { @builtin(position) position: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) i: u32) -> VertexOutput {
  var positions = array<vec2f, 4>(vec2f(-1.0,-1.0), vec2f(1.0,-1.0), vec2f(-1.0,1.0), vec2f(1.0,1.0));
  var out: VertexOutput; out.position = vec4f(positions[i] * params.scale, 0.0, 1.0); out.uv = positions[i] * 0.5 + vec2f(0.5); return out;
}
@group(0) @binding(0) var frameTexture: texture_2d<f32>;
@group(0) @binding(1) var frameSampler: sampler;
struct Params { crop: vec4f, filter: u32, amount: f32, rotation: u32, pad: u32, scale: vec2f, pad2: vec2f };
@group(0) @binding(2) var<uniform> params: Params;
@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {
  var sourceUv = input.uv;
  if (params.rotation == 1u) { sourceUv = vec2f(sourceUv.y, 1.0 - sourceUv.x); }
  else if (params.rotation == 2u) { sourceUv = vec2f(1.0 - sourceUv.x, 1.0 - sourceUv.y); }
  else if (params.rotation == 3u) { sourceUv = vec2f(1.0 - sourceUv.y, sourceUv.x); }
  let uv = params.crop.xy + sourceUv * params.crop.zw;
  var color = textureSample(frameTexture, frameSampler, uv);
  if (params.filter == 1u) { let luma = dot(color.rgb, vec3f(0.2126, 0.7152, 0.0722)); color.rgb = mix(color.rgb, vec3f(luma), params.amount); }
  else if (params.filter == 2u) { color.rgb = color.rgb * params.amount; }
  else if (params.filter == 3u) { color.rgb = (color.rgb - vec3f(0.5)) * params.amount + vec3f(0.5); }
  else if (params.filter == 4u) { let luma = dot(color.rgb, vec3f(0.2126, 0.7152, 0.0722)); color.rgb = mix(vec3f(luma), color.rgb, params.amount); }
  return clamp(color, vec4f(0.0), vec4f(1.0));
}`

interface GpuResources {
  pipeline: GPURenderPipeline
  sampler: GPUSampler
  texture: GPUTexture
  bindGroup: GPUBindGroup
  params: GPUBuffer
}

export class WebGPURenderer extends BaseRenderer {
  readonly kind = 'webgpu' as const
  private context: GPUCanvasContext | null = null
  private adapter: GPUAdapter | null = null
  private device: GPUDevice | null = null
  private resources: GpuResources | null = null
  private configuredFormat: GPUTextureFormat = 'bgra8unorm'
  private inputTextureFormat: GPUTextureFormat = 'rgba8unorm'
  private lostPromise: Promise<void> | null = null
  private rebuildTask: Promise<void> | null = null
  private textureWidth = 1
  private textureHeight = 1

  get capabilities(): RendererCapabilities {
    return { kind: this.kind, available: this.device !== null, filters: FILTERS, maxTextureDimension2d: this.maxDimension, externalTexture: false, hdr: false, lossRecovery: true }
  }

  constructor(options: RendererBackendOptions = {}) { super(options) }

  protected async initialize(): Promise<void> {
    const gpu = this.runtime.gpu ?? (typeof navigator !== 'undefined' ? navigator.gpu : undefined)
    if (!gpu) throw rendererError(ErrorCodes.RENDERER_BACKEND_UNAVAILABLE, 'WebGPU is unavailable', true)
    const canvas = this.requireCanvas()
    const context = canvas.getContext('webgpu') as GPUCanvasContext | null
    if (!context) throw rendererError(ErrorCodes.RENDERER_CONTEXT_UNAVAILABLE, 'The WebGPU canvas context is unavailable', true)
    let adapter: GPUAdapter | null
    try { adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' }) } catch (cause) { throw rendererError(ErrorCodes.RENDERER_DEVICE_REQUEST_FAILED, 'The WebGPU adapter request failed', true, cause) }
    if (!adapter) throw rendererError(ErrorCodes.RENDERER_DEVICE_REQUEST_FAILED, 'No WebGPU adapter is available', true)
    if (this.closed) throw rendererError(ErrorCodes.RENDERER_CLOSED, 'The renderer was closed during adapter initialization', false)
    let device: GPUDevice
    try { device = await adapter.requestDevice() } catch (cause) { throw rendererError(ErrorCodes.RENDERER_DEVICE_REQUEST_FAILED, 'The WebGPU device request failed', true, cause) }
    if (this.closed) {
      device.destroy?.()
      throw rendererError(ErrorCodes.RENDERER_CLOSED, 'The renderer was closed during device initialization', false)
    }
    this.adapter = adapter
    this.device = device
    this.context = context
    this.configuredFormat = gpu.getPreferredCanvasFormat()
    this.inputTextureFormat = this.configuredFormat === 'rgba16float' ? 'rgba16float' : 'rgba8unorm'
    const limit = device.limits.maxTextureDimension2D
    if (Number.isSafeInteger(limit) && limit > 0) this.maxDimension = Math.min(this.maxDimension, limit)
    try {
      context.configure({ device, format: this.configuredFormat, alphaMode: 'opaque', colorSpace: 'srgb' })
      this.resources = createResources(device, this.configuredFormat, this.inputTextureFormat, 1, 1)
    } catch (cause) {
      this.releaseGpu()
      throw rendererError(ErrorCodes.RENDERER_SHADER_FAILED, 'The WebGPU render pipeline could not be created', true, cause)
    }
    this.lostPromise = device.lost.then(() => {
      if (this.closed) return
      this.transition('lost', 'device-lost')
      this.onEvent?.({ type: 'error', kind: this.kind, error: rendererError(ErrorCodes.RENDERER_DEVICE_LOST, 'The WebGPU device was lost', true) })
      this.rebuildTask = this.rebuildTask ?? this.rebuild(gpu, context)
      void this.rebuildTask.finally(() => { this.rebuildTask = null })
    })
  }

  protected draw(frame: VideoFrame, validated: ValidatedFrame): void {
    const device = this.device
    const context = this.context
    if (!device || !context || !this.resources) throw rendererError(ErrorCodes.RENDERER_DEVICE_LOST, 'The WebGPU device is unavailable', true)
    const width = validated.width
    const height = validated.height
    try {
      this.ensureTexture(width, height)
      const resources = this.resources
      if (!resources) throw rendererError(ErrorCodes.RENDERER_DEVICE_LOST, 'The WebGPU texture is unavailable', true)
      device.queue.copyExternalImageToTexture({ source: frame }, { texture: resources.texture }, { width, height })
      const params = new ArrayBuffer(48)
      const viewParams = new DataView(params)
      const crop = this.transform.crop ?? { x: 0, y: 0, width: validated.width, height: validated.height }
      viewParams.setFloat32(0, crop.x / validated.width, true)
      viewParams.setFloat32(4, crop.y / validated.height, true)
      viewParams.setFloat32(8, crop.width / validated.width, true)
      viewParams.setFloat32(12, crop.height / validated.height, true)
      viewParams.setUint32(16, filterIndex(this.filter.kind), true)
      viewParams.setFloat32(20, this.filter.amount, true)
      viewParams.setUint32(24, rotationIndex(this.transform.rotation), true)
      const scale = fitScale(crop.width, crop.height, this.width * this.dpr, this.height * this.dpr, this.transform.fit, this.transform.rotation)
      viewParams.setFloat32(32, scale.x, true)
      viewParams.setFloat32(36, scale.y, true)
      device.queue.writeBuffer(resources.params, 0, params)
      const command = device.createCommandEncoder()
      const view = context.getCurrentTexture().createView()
      const pass = command.beginRenderPass({ colorAttachments: [{ view, clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }] })
      pass.setPipeline(resources.pipeline)
      pass.setBindGroup(0, resources.bindGroup)
      pass.draw(4)
      pass.end()
      device.queue.submit([command.finish()])
    } catch (cause) {
      throw rendererError(ErrorCodes.RENDERER_OPERATION_FAILED, 'WebGPU presentation failed', true, cause)
    }
  }

  protected resizeBackend(_width: number, _height: number): void {
    if (!this.context || !this.device) return
    this.context.configure({ device: this.device, format: this.configuredFormat, alphaMode: 'opaque', colorSpace: 'srgb' })
  }

  protected override supportsHdr(_frame: ValidatedFrame): boolean { return false }

  protected release(): void { this.releaseGpu() }

  private releaseGpu(): void {
    this.resources?.texture.destroy()
    this.resources?.params.destroy?.()
    this.resources = null
    try { this.context?.unconfigure() } catch { /* best effort */ }
    try { this.device?.destroy() } catch { /* best effort */ }
    this.device = null
    this.adapter = null
    this.context = null
    this.lostPromise = null
    this.textureWidth = 1
    this.textureHeight = 1
    this.inputTextureFormat = 'rgba8unorm'
  }

  private ensureTexture(width: number, height: number): void {
    const device = this.device
    const resources = this.resources
    if (!device || !resources || (this.textureWidth === width && this.textureHeight === height)) return
    const replacement = device.createTexture({ size: { width, height }, format: this.inputTextureFormat, usage: textureUsage() })
    let bindGroup: GPUBindGroup
    try {
      bindGroup = device.createBindGroup({ layout: resources.pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: replacement.createView() }, { binding: 1, resource: resources.sampler }, { binding: 2, resource: { buffer: resources.params } }] })
    } catch (cause) {
      replacement.destroy()
      throw cause
    }
    resources.texture.destroy()
    resources.texture = replacement
    this.textureWidth = width
    this.textureHeight = height
    resources.bindGroup = bindGroup
  }

  private async rebuild(gpu: GPU, context: GPUCanvasContext): Promise<void> {
    if (this.closed) return
    this.transition('rebuilding', 'device-lost')
    try {
      this.resources?.texture.destroy()
      this.resources?.params.destroy?.()
      this.resources = null
      try { this.device?.destroy() } catch { /* lost devices may already be destroyed */ }
      const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' })
      if (!adapter) throw rendererError(ErrorCodes.RENDERER_DEVICE_REBUILD_FAILED, 'A replacement WebGPU adapter is unavailable', true)
      if (this.closed) return
      const device = await adapter.requestDevice()
      if (this.closed) { device.destroy?.(); return }
      this.adapter = adapter
      this.device = device
      context.configure({ device, format: this.configuredFormat, alphaMode: 'opaque', colorSpace: 'srgb' })
      this.resources = createResources(device, this.configuredFormat, this.inputTextureFormat, 1, 1)
      this.textureWidth = 1
      this.textureHeight = 1
      this.watchDeviceLost(gpu, context, device)
      this.transition('ready', 'device-rebuilt')
    } catch (cause) {
      this.reportFatal(rendererError(ErrorCodes.RENDERER_DEVICE_REBUILD_FAILED, 'The WebGPU device could not be rebuilt', true, cause))
    }
  }

  private watchDeviceLost(gpu: GPU, context: GPUCanvasContext, device: GPUDevice): void {
    this.lostPromise = device.lost.then(() => {
      if (this.closed) return
      this.transition('lost', 'device-lost')
      this.onEvent?.({ type: 'error', kind: this.kind, error: rendererError(ErrorCodes.RENDERER_DEVICE_LOST, 'The WebGPU device was lost', true) })
      this.rebuildTask = this.rebuildTask ?? this.rebuild(gpu, context)
      void this.rebuildTask.finally(() => { this.rebuildTask = null })
    })
  }
}

function createResources(device: GPUDevice, format: GPUTextureFormat, inputTextureFormat: GPUTextureFormat, width: number, height: number): GpuResources {
  let texture: GPUTexture | null = null
  let params: GPUBuffer | null = null
  try {
    const module = device.createShaderModule({ code: SHADER })
    const pipeline = device.createRenderPipeline({ layout: 'auto', vertex: { module, entryPoint: 'vs' }, fragment: { module, entryPoint: 'fs', targets: [{ format }] }, primitive: { topology: 'triangle-strip' } })
    const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' })
    texture = device.createTexture({ size: { width: Math.max(1, width), height: Math.max(1, height) }, format: inputTextureFormat, usage: textureUsage() })
    params = device.createBuffer({ size: 48, usage: bufferUsage() })
    const bindGroup = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: texture.createView() }, { binding: 1, resource: sampler }, { binding: 2, resource: { buffer: params } }] })
    return { pipeline, sampler, texture, bindGroup, params }
  } catch (cause) {
    texture?.destroy()
    params?.destroy?.()
    throw cause
  }
}

function textureUsage(): GPUTextureUsageFlags {
  const usage = (globalThis as { GPUTextureUsage?: { TEXTURE_BINDING: number; COPY_DST: number; RENDER_ATTACHMENT: number } }).GPUTextureUsage
  return (usage?.TEXTURE_BINDING ?? 4) | (usage?.COPY_DST ?? 2) | (usage?.RENDER_ATTACHMENT ?? 16)
}

function bufferUsage(): GPUBufferUsageFlags {
  const usage = (globalThis as { GPUBufferUsage?: { UNIFORM: number; COPY_DST: number } }).GPUBufferUsage
  return (usage?.UNIFORM ?? 64) | (usage?.COPY_DST ?? 8)
}

function rotationIndex(value: number): number { return value === 90 ? 1 : value === 180 ? 2 : value === 270 ? 3 : 0 }
function filterIndex(value: string): number { return value === 'grayscale' ? 1 : value === 'brightness' ? 2 : value === 'contrast' ? 3 : value === 'saturate' ? 4 : 0 }
function fitScale(sourceWidth: number, sourceHeight: number, targetWidth: number, targetHeight: number, fit: string, rotation: number): { x: number; y: number } {
  if (fit === 'fill') return { x: 1, y: 1 }
  const rotated = rotation === 90 || rotation === 270
  const width = rotated ? sourceHeight : sourceWidth
  const height = rotated ? sourceWidth : sourceHeight
  const sourceAspect = width / height
  const targetAspect = targetWidth / targetHeight
  if ((fit === 'contain' && sourceAspect > targetAspect) || (fit === 'cover' && sourceAspect < targetAspect)) return { x: 1, y: targetAspect / sourceAspect }
  return { x: sourceAspect / targetAspect, y: 1 }
}
