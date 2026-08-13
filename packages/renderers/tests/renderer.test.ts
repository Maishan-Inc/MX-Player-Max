import { describe, expect, it, vi } from 'vitest'
import type { CapabilitySnapshot, VideoFilterOptions } from '@mx-player-max/types'
import { ErrorCodes } from '@mx-player-max/types'
import { Canvas2DRenderer, ManagedRenderer, WebGL2Renderer, WebGPURenderer, BrowserRendererFactory } from '../src/index'

class FakeCanvas {
  width = 320
  height = 180
  clientWidth = 320
  clientHeight = 180
  style: Record<string, string> = {}
  readonly listeners = new Map<string, (event: Event) => void>()
  readonly context2d = {
    filter: 'none', save: vi.fn(), restore: vi.fn(), clearRect: vi.fn(), translate: vi.fn(), rotate: vi.fn(),
    drawImage: vi.fn(),
  }
  getContext(kind: string): unknown { return kind === '2d' ? this.context2d : null }
  addEventListener(name: string, listener: EventListenerOrEventListenerObject): void { this.listeners.set(name, listener as (event: Event) => void) }
  removeEventListener(name: string): void { this.listeners.delete(name) }
}

function frame(width = 640, height = 360, colorSpace: Record<string, unknown> = { primaries: 'bt709', transfer: 'bt709', fullRange: true }): VideoFrame {
  return { displayWidth: width, displayHeight: height, codedWidth: width, codedHeight: height, close: vi.fn(), colorSpace } as unknown as VideoFrame
}

function snapshot(overrides: Partial<CapabilitySnapshot> = {}): CapabilitySnapshot {
  return {
    schemaVersion: 1, sdkVersion: 'test', browser: 'unknown', browserVersion: null, platform: 'unknown',
    crossOriginIsolated: false, sharedArrayBuffer: false, wasmSimd: false, wasmThreads: false, htmlVideo: true,
    mediaCapabilities: true, webCodecsVideo: true, webCodecsAudio: true, webGpu: false, webGl2: false, canvas2d: true,
    workerMediaSource: false,
    webGpuFeatures: { available: false, float32Filterable: false, shaderF16: false, maxComputeWorkgroupStorageSize: 0, maxTextureDimension2d: 0, maxBufferSize: 0, importExternalTexture: false, adapterVendor: null, adapterArchitecture: null, isFallbackAdapter: false },
    quirks: [], ...overrides,
  }
}

describe('Canvas2D renderer', () => {
  it('draws, transforms, filters, resizes for DPR, and closes a frame once', async () => {
    const target = new FakeCanvas()
    const renderer = new Canvas2DRenderer({ runtime: { createCanvas2DContext: () => target.context2d }, transform: { rotation: 90, devicePixelRatio: 2 }, filter: { kind: 'brightness', amount: 9 } })
    await renderer.attach(target as unknown as HTMLCanvasElement)
    renderer.resize(200, 100)
    const value = frame()
    renderer.render(value)
    expect(value.close).toHaveBeenCalledOnce()
    expect(target.width).toBe(400)
    expect(target.height).toBe(200)
    expect(target.context2d.rotate).toHaveBeenCalled()
    expect(target.context2d.filter).toBe('brightness(4)')
    expect(target.context2d.drawImage).toHaveBeenCalledOnce()
    expect(renderer.stats.presentedFrames).toBe(1)
  })

  it('rejects out-of-bounds crop and does not close a duplicate frame twice', async () => {
    const target = new FakeCanvas()
    const renderer = new Canvas2DRenderer({ runtime: { createCanvas2DContext: () => target.context2d }, transform: { crop: { x: 0, y: 0, width: 641, height: 360 } } })
    await renderer.attach(target as unknown as HTMLCanvasElement)
    const invalid = frame()
    expect(() => renderer.render(invalid)).toThrowError(expect.objectContaining({ code: ErrorCodes.RENDERER_RESIZE_INVALID }))
    expect(invalid.close).toHaveBeenCalledOnce()
    renderer.setTransform({})
    const duplicate = frame()
    renderer.render(duplicate)
    expect(() => renderer.render(duplicate)).toThrowError(expect.objectContaining({ code: ErrorCodes.RENDERER_FRAME_INVALID }))
    expect(duplicate.close).toHaveBeenCalledOnce()
    renderer.close()
  })

  it('records SDR range and conservatively rejects HDR preservation', async () => {
    const target = new FakeCanvas()
    const renderer = new Canvas2DRenderer({ runtime: { createCanvas2DContext: () => target.context2d }, preserveHdr: true })
    await renderer.attach(target as unknown as HTMLCanvasElement)
    const full = frame()
    renderer.render(full)
    expect(renderer.stats.colorMode).toBe('sdr-bt709')
    expect(renderer.stats.colorRange).toBe('full')
    const limited = frame(640, 360, { primaries: 'bt709', transfer: 'bt709', fullRange: false })
    renderer.render(limited)
    expect(renderer.stats.colorRange).toBe('limited')
    const unknown = frame(640, 360, {})
    renderer.render(unknown)
    expect(renderer.stats.colorMode).toBe('unknown')
    const hdr = frame(640, 360, { primaries: 'bt2020', transfer: 'pq', fullRange: false })
    renderer.render(hdr)
    expect(renderer.stats.hdrPreserved).toBe(false)
    expect(renderer.stats.hdrReason).toBe('canvas2d-hdr-not-confirmed')
    renderer.close()
  })

  it.each([0, 90, 180, 270] as const)('supports rotation %i without reading pixels', async (rotation) => {
    const target = new FakeCanvas()
    const renderer = new Canvas2DRenderer({ runtime: { createCanvas2DContext: () => target.context2d }, transform: { rotation } })
    await renderer.attach(target as unknown as HTMLCanvasElement)
    const value = frame()
    renderer.render(value)
    expect(target.context2d.rotate).toHaveBeenLastCalledWith(rotation * Math.PI / 180)
    expect(value.close).toHaveBeenCalledOnce()
    renderer.close()
  })

  it('applies every bounded filter and rejects invalid runtime input', async () => {
    const target = new FakeCanvas()
    const renderer = new Canvas2DRenderer({ runtime: { createCanvas2DContext: () => target.context2d } })
    await renderer.attach(target as unknown as HTMLCanvasElement)
    for (const filter of [
      { kind: 'none' }, { kind: 'grayscale', amount: 0.5 }, { kind: 'brightness', amount: 2 },
      { kind: 'contrast', amount: 2 }, { kind: 'saturate', amount: 2 },
    ] satisfies VideoFilterOptions[]) {
      renderer.setFilter(filter)
      renderer.render(frame())
    }
    expect(target.context2d.drawImage).toHaveBeenCalledTimes(5)
    expect(() => renderer.setFilter({ kind: 'brightness', amount: Number.NaN })).toThrowError(expect.objectContaining({ code: ErrorCodes.RENDERER_FILTER_UNSUPPORTED }))
    expect(() => renderer.setFilter({ kind: 'posterize' } as unknown as VideoFilterOptions)).toThrowError(expect.objectContaining({ code: ErrorCodes.RENDERER_FILTER_UNSUPPORTED }))
    renderer.close()
  })

  it('closes late frames after close without drawing or emitting new events', async () => {
    const target = new FakeCanvas()
    const onEvent = vi.fn()
    const renderer = new Canvas2DRenderer({ runtime: { createCanvas2DContext: () => target.context2d }, onEvent })
    await renderer.attach(target as unknown as HTMLCanvasElement)
    renderer.close()
    const eventCount = onEvent.mock.calls.length
    const late = frame()
    renderer.render(late)
    expect(late.close).toHaveBeenCalledOnce()
    expect(target.context2d.drawImage).not.toHaveBeenCalled()
    expect(onEvent).toHaveBeenCalledTimes(eventCount)
  })
})

describe('renderer factory', () => {
  it('selects Canvas2D automatically and rejects an unavailable explicit backend', async () => {
    const target = new FakeCanvas()
    const options = { capabilities: snapshot(), runtime: { createCanvas2DContext: () => target.context2d } }
    const renderer = new ManagedRenderer('auto', options)
    await renderer.attach(target as unknown as HTMLCanvasElement)
    expect(renderer.kind).toBe('canvas2d')
    renderer.close()
    expect(() => new BrowserRendererFactory(options).create('webgpu')).toThrowError(expect.objectContaining({ code: ErrorCodes.RENDERER_BACKEND_UNAVAILABLE }))
  })

  it('falls back from a failed WebGPU initialization to WebGL2 in auto mode', async () => {
    const target = new FakeCanvas()
    const gl = fakeGl()
    const options = { capabilities: snapshot({ webGpu: true, webGl2: true }), runtime: { gpu: {} as GPU, createWebGL2Context: () => gl } }
    const renderer = new ManagedRenderer('auto', options)
    await renderer.attach(target as unknown as HTMLCanvasElement)
    expect(renderer.kind).toBe('webgl2')
    expect(renderer.stats.fallbackCount).toBe(1)
    renderer.close()
  })

  it('falls back to Canvas2D when WebGL2 context creation fails', async () => {
    const target = new FakeCanvas()
    const renderer = new ManagedRenderer('auto', {
      capabilities: snapshot({ webGl2: true, canvas2d: true }),
      runtime: { createWebGL2Context: () => null, createCanvas2DContext: () => target.context2d },
    })
    await renderer.attach(target as unknown as HTMLCanvasElement)
    expect(renderer.kind).toBe('canvas2d')
    expect(renderer.stats.fallbackCount).toBe(1)
    renderer.close()
  })

  it('rebuilds a lost WebGPU device or falls back when replacement fails', async () => {
    const target = new FakeCanvas()
    const context = fakeGpuContext()
    target.getContext = (kind: string): unknown => kind === 'webgpu' ? context : kind === '2d' ? target.context2d : null
    let loseDevice!: () => void
    const lost = new Promise<GPUDeviceLostInfo>((resolve) => { loseDevice = () => resolve({ reason: 'unknown', message: 'private' } as GPUDeviceLostInfo) })
    const device = fakeGpuDevice(lost)
    const adapter = { limits: { maxTextureDimension2D: 4096 }, requestDevice: vi.fn(async () => device) }
    const requestAdapter = vi.fn().mockResolvedValueOnce(adapter).mockResolvedValueOnce(null)
    const gpu = { requestAdapter, getPreferredCanvasFormat: () => 'bgra8unorm' } as unknown as GPU
    const events = vi.fn()
    const renderer = new ManagedRenderer('auto', {
      capabilities: snapshot({ webGpu: true, canvas2d: true, webGpuFeatures: { ...snapshot().webGpuFeatures, available: true, maxTextureDimension2d: 4096 } }),
      runtime: { gpu, createCanvas2DContext: () => target.context2d }, onEvent: events,
    })
    await renderer.attach(target as unknown as HTMLCanvasElement)
    expect(renderer.kind).toBe('webgpu')
    loseDevice()
    await vi.waitFor(() => expect(renderer.kind).toBe('canvas2d'))
    expect(renderer.stats.fallbackCount).toBe(1)
    expect(events).toHaveBeenCalledWith(expect.objectContaining({
      type: 'fallback', previous: 'webgpu', current: 'canvas2d', reason: ErrorCodes.RENDERER_DEVICE_REBUILD_FAILED,
    }))
    renderer.close()
  })
})

describe('WebGPU and WebGL2 initialization', () => {
  it('initializes WebGPU resources, draws a frame, and resizes without readback', async () => {
    const target = new FakeCanvas()
    const device = fakeGpuDevice()
    const gpu = { requestAdapter: vi.fn(async () => ({ limits: { maxTextureDimension2D: 4096 }, requestDevice: vi.fn(async () => device) })), getPreferredCanvasFormat: () => 'bgra8unorm' } as unknown as GPU
    const context = fakeGpuContext()
    target.getContext = (kind: string): unknown => kind === 'webgpu' ? context : null
    const renderer = new WebGPURenderer({ runtime: { gpu } })
    await renderer.attach(target as unknown as HTMLCanvasElement)
    const value = frame()
    renderer.render(value)
    renderer.resize(128, 72)
    expect(value.close).toHaveBeenCalledOnce()
    expect(device.queue.submit).toHaveBeenCalled()
    expect(device.queue.copyExternalImageToTexture).toHaveBeenCalled()
    renderer.close()
  })

  it('creates a WebGL2 backend through the standard context probe', async () => {
    const target = new FakeCanvas()
    const gl = fakeGl()
    const renderer = new WebGL2Renderer({ runtime: { createWebGL2Context: () => gl } })
    await renderer.attach(target as unknown as HTMLCanvasElement)
    const value = frame()
    renderer.render(value)
    expect(value.close).toHaveBeenCalledOnce()
    expect(gl.texImage2D).toHaveBeenCalled()
    renderer.close()
  })

  it('stops on WebGL2 context loss, rebuilds on restore, and removes listeners on close', async () => {
    const target = new FakeCanvas()
    const gl = fakeGl()
    const renderer = new WebGL2Renderer({ runtime: { createWebGL2Context: () => gl } })
    await renderer.attach(target as unknown as HTMLCanvasElement)
    const lost = target.listeners.get('webglcontextlost')
    const restored = target.listeners.get('webglcontextrestored')
    lost?.({ preventDefault: vi.fn() } as unknown as Event)
    expect(renderer.state).toBe('lost')
    restored?.(new Event('webglcontextrestored'))
    await Promise.resolve()
    await Promise.resolve()
    expect(renderer.state).toBe('ready')
    renderer.close()
    expect(target.listeners.size).toBe(0)
    expect(gl.deleteTexture).toHaveBeenCalled()
  })
})

function fakeGpuContext(): GPUCanvasContext {
  const texture = { createView: vi.fn(() => ({})) }
  return { configure: vi.fn(), unconfigure: vi.fn(), getCurrentTexture: vi.fn(() => texture) } as unknown as GPUCanvasContext
}

function fakeGpuDevice(lost: Promise<GPUDeviceLostInfo> = new Promise<GPUDeviceLostInfo>(() => {})): GPUDevice {
  const texture = { createView: vi.fn(() => ({})), destroy: vi.fn() }
  const queue = { copyExternalImageToTexture: vi.fn(), submit: vi.fn(), writeBuffer: vi.fn() }
  const device = {
    limits: { maxTextureDimension2D: 4096 }, lost, queue,
    createShaderModule: vi.fn(() => ({})), createRenderPipeline: vi.fn(() => ({ getBindGroupLayout: vi.fn(() => ({})) })),
    createSampler: vi.fn(() => ({})), createTexture: vi.fn(() => texture), createBuffer: vi.fn(() => ({ destroy: vi.fn() })), createBindGroup: vi.fn(() => ({})),
    createCommandEncoder: vi.fn(() => ({ beginRenderPass: vi.fn(() => ({ setPipeline: vi.fn(), setBindGroup: vi.fn(), draw: vi.fn(), end: vi.fn() })), finish: vi.fn(() => ({})) })),
  }
  return device as unknown as GPUDevice
}

function fakeGl(): WebGL2RenderingContext {
  const gl = {
    VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4, MAX_TEXTURE_SIZE: 5, ARRAY_BUFFER: 6, STATIC_DRAW: 7,
    FLOAT: 8, TEXTURE_2D: 9, TEXTURE0: 10, RGBA: 11, UNSIGNED_BYTE: 12, TEXTURE_MIN_FILTER: 13, TEXTURE_MAG_FILTER: 14,
    LINEAR: 15, TEXTURE_WRAP_S: 16, TEXTURE_WRAP_T: 17, CLAMP_TO_EDGE: 18, TRIANGLE_STRIP: 19, UNPACK_FLIP_Y_WEBGL: 20, UNPACK_PREMULTIPLY_ALPHA_WEBGL: 21, COLOR_BUFFER_BIT: 22,
    createShader: vi.fn(() => ({})), shaderSource: vi.fn(), compileShader: vi.fn(), getShaderParameter: vi.fn(() => true), deleteShader: vi.fn(),
    createProgram: vi.fn(() => ({})), attachShader: vi.fn(), linkProgram: vi.fn(), getProgramParameter: vi.fn(() => true), deleteProgram: vi.fn(),
    createTexture: vi.fn(() => ({})), createBuffer: vi.fn(() => ({})), createVertexArray: vi.fn(() => ({})), deleteTexture: vi.fn(), deleteBuffer: vi.fn(), deleteVertexArray: vi.fn(),
    bindVertexArray: vi.fn(), bindBuffer: vi.fn(), bufferData: vi.fn(), getAttribLocation: vi.fn(() => 0), enableVertexAttribArray: vi.fn(), vertexAttribPointer: vi.fn(),
    bindTexture: vi.fn(), texParameteri: vi.fn(), getUniformLocation: vi.fn(() => ({})), useProgram: vi.fn(), activeTexture: vi.fn(), pixelStorei: vi.fn(), texImage2D: vi.fn(),
    uniform2f: vi.fn(), uniform1i: vi.fn(), uniform4f: vi.fn(), uniform1f: vi.fn(), clearColor: vi.fn(), clear: vi.fn(), drawArrays: vi.fn(), viewport: vi.fn(), isContextLost: vi.fn(() => false), getParameter: vi.fn(() => 4096),
  }
  return gl as unknown as WebGL2RenderingContext
}
