import { describe, expect, it, vi } from 'vitest'
import {
  PackedTexturePool,
  TexturePool,
  WebGpuSuperResolutionStage,
  createAiPipeline,
  type AiPipelineEvent,
  type DecodedFrameSource,
  type PipelineFrame,
  type SpatialStage,
  type TemporalStage,
} from '../src/index'

describe('postprocess quality hardening', () => {
  it('falls back cleanly when an injected stage fails', async () => {
    const frame = gpuFrame(0)
    const upstream = queue([frame])
    const events: AiPipelineEvent[] = []
    const stage: SpatialStage = {
      id: 'failed-stage',
      outputSize: (width, height) => ({ width, height }),
      process: vi.fn(async () => { throw new Error('stage-failed') }),
      close: vi.fn(),
    }
    const pipeline = createAiPipeline({ upstream, superResolution: stage, initialTier: 'high', onEvent: (event) => events.push(event) })
    expect(await pipeline.frameAt(0, 0)).toBe(frame)
    expect(events.map((event) => event.type)).toEqual(['error', 'fallback'])
    expect(pipeline.tier).toBe('off')
    expect(await pipeline.frameAt(0, 0)).toBe(frame)
    expect(stage.process).toHaveBeenCalledOnce()
  })

  it('returns passthrough and releases its output when the WebGPU queue reports device loss', async () => {
    const frame = gpuFrame(0)
    const upstream = queue([frame])
    const events: AiPipelineEvent[] = []
    const device = failingStageDevice()
    const stage = new WebGpuSuperResolutionStage({ device })
    const pipeline = createAiPipeline({ upstream, superResolution: stage, initialTier: 'high', onEvent: (event) => events.push(event) })

    expect(await pipeline.frameAt(0, 0)).toBe(frame)
    expect(events.map((event) => event.type)).toEqual(['error', 'fallback'])
    expect(pipeline.tier).toBe('off')
    expect(device.createdTextures[0]?.destroy).not.toHaveBeenCalled()
    expect(await pipeline.frameAt(0, 0)).toBe(frame)
    pipeline.close()
    expect(device.createdTextures[0]?.destroy).toHaveBeenCalledOnce()
  })

  it('switches stages at runtime and refuses to enable one that is not attached', async () => {
    const frame = gpuFrame(0)
    const upstream = queue([frame])
    const stage: SpatialStage = {
      id: 'sr',
      outputSize: (width, height) => ({ width: width * 2, height: height * 2 }),
      process: vi.fn(async (input) => input),
      close: vi.fn(),
    }
    const pipeline = createAiPipeline({ upstream, superResolution: stage, initialTier: 'high', superResolutionEnabled: false })
    expect(pipeline.hasSuperResolution).toBe(true)
    expect(pipeline.hasInterpolation).toBe(false)
    expect(pipeline.superResolutionEnabled).toBe(false)

    await pipeline.frameAt(0, 0)
    expect(stage.process).not.toHaveBeenCalled()

    pipeline.setStages({ superResolution: true })
    expect(pipeline.superResolutionEnabled).toBe(true)
    await pipeline.frameAt(0, 0)
    expect(stage.process).toHaveBeenCalledOnce()

    pipeline.setStages({ superResolution: false })
    await pipeline.frameAt(0, 0)
    expect(stage.process).toHaveBeenCalledOnce()

    expect(() => pipeline.setStages({ interpolation: true })).toThrow('No interpolation stage is attached')
    pipeline.close()
  })

  it('reports governor tier changes through pipeline events', () => {
    const events: AiPipelineEvent[] = []
    const pipeline = createAiPipeline({ upstream: queue([]), initialTier: 'high', governorOptions: { windowSize: 3 }, onEvent: (event) => events.push(event) })
    for (let index = 0; index < 3; index += 1) pipeline.governor.record(9, 10)
    expect(events).toContainEqual({ type: 'qualitychange', previous: 'high', current: 'medium', reason: 'governor-tier-change' })
  })

  it('drops and releases a temporal result from an obsolete seek epoch', async () => {
    const frames = [gpuFrame(0), gpuFrame(1_000_000)]
    let resolveResult: ((value: PipelineFrame) => void) | null = null
    const result = gpuFrame(500_000)
    const stage: TemporalStage = {
      id: 'deferred-rife', lookaheadFrames: 1,
      synthesize: vi.fn(() => new Promise<PipelineFrame>((resolve) => { resolveResult = resolve })),
      close: vi.fn(),
    }
    const events: AiPipelineEvent[] = []
    const pipeline = createAiPipeline({ upstream: queue(frames), interpolation: stage, onEvent: (event) => events.push(event) })
    const pending = pipeline.frameAt(500_000, 0)
    pipeline.reset(1)
    pipeline.reset(2)
    if (resolveResult === null) throw new Error('Temporal stage did not start')
    resolveResult(result)
    expect(await pending).toBeNull()
    expect(result.release).toHaveBeenCalledOnce()
    expect(events).toEqual([])
  })

  it('keeps texture pools bounded over repeated use', () => {
    const device = fakeDevice()
    const textures = new TexturePool({ device, capacity: 4 })
    const packed = new PackedTexturePool(device, 4)
    for (let index = 0; index < 10_000; index += 1) {
      textures.acquire(320, 180).release()
      packed.acquire(160, 90, 24).release()
    }
    expect(textures.allocated).toBe(1)
    expect(textures.inUse).toBe(0)
    expect(packed.allocated).toBe(1)
    expect(packed.inUse).toBe(0)
    expect(device.createTexture).toHaveBeenCalledTimes(2)
    textures.close()
    packed.close()
  })

  it('rejects texture and packed tensor allocations beyond configured capacity', () => {
    const device = fakeDevice()
    const textures = new TexturePool({ device, capacity: 2 })
    const textureLeases = [textures.acquire(16, 16), textures.acquire(32, 32)]
    expect(() => textures.acquire(64, 64)).toThrow('Texture pool capacity exceeded')
    expect(textures.allocated).toBe(2)

    const packed = new PackedTexturePool(device, 4)
    const packedLeases = [
      packed.acquire(16, 16, 4),
      packed.acquire(16, 16, 8),
      packed.acquire(16, 16, 12),
      packed.acquire(16, 16, 16),
    ]
    expect(() => packed.acquire(16, 16, 20)).toThrow('Packed texture pool capacity exceeded')
    expect(packed.allocated).toBe(4)

    for (const lease of [...textureLeases, ...packedLeases]) lease.release()
    textures.close()
    packed.close()
  })

  it('uploads CPU frames with the usage flags copyExternalImageToTexture requires', async () => {
    // Dawn rejects the upload with "Destination texture needs to have CopyDst and
    // RenderAttachment usage." if either flag is missing.
    vi.stubGlobal('GPUTextureUsage', { COPY_SRC: 1, COPY_DST: 2, TEXTURE_BINDING: 4, STORAGE_BINDING: 8, RENDER_ATTACHMENT: 16 })
    vi.stubGlobal('GPUBufferUsage', { COPY_SRC: 4, COPY_DST: 8, UNIFORM: 64, STORAGE: 128 })
    vi.stubGlobal('GPUShaderStage', { COMPUTE: 4 })
    try {
      const usages: number[] = []
      const stage = new WebGpuSuperResolutionStage({ device: uploadRecordingDevice(usages) })
      const frame = await stage.process({ location: 'cpu', frame: fakeVideoFrame(8, 4), timestamp: 0 }, 0)
      expect(frame.location).toBe('gpu')
      if (frame.location === 'gpu') frame.release()
      expect(usages[0]).toBeDefined()
      expect((usages[0] ?? 0) & 2).toBe(2)
      expect((usages[0] ?? 0) & 16).toBe(16)
      stage.close()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

function fakeVideoFrame(width: number, height: number): VideoFrame {
  return { displayWidth: width, displayHeight: height, codedWidth: width, codedHeight: height } as unknown as VideoFrame
}

/** Records the `usage` of every created texture, in creation order. */
function uploadRecordingDevice(usages: number[]): GPUDevice {
  const texture = () => ({ createView: vi.fn(() => ({})), destroy: vi.fn() })
  const device = {
    queue: {
      writeBuffer: vi.fn(),
      submit: vi.fn(),
      copyExternalImageToTexture: vi.fn(),
      onSubmittedWorkDone: vi.fn(async () => undefined),
    },
    createShaderModule: vi.fn(() => ({})),
    createBindGroupLayout: vi.fn(() => ({})),
    createPipelineLayout: vi.fn(() => ({})),
    createComputePipeline: vi.fn(() => ({})),
    createBuffer: vi.fn(() => ({ destroy: vi.fn() })),
    createBindGroup: vi.fn(() => ({})),
    createTexture: vi.fn((descriptor: { usage: number }) => { usages.push(descriptor.usage); return texture() }),
    createCommandEncoder: vi.fn(() => ({
      beginComputePass: vi.fn(() => ({ setPipeline: vi.fn(), setBindGroup: vi.fn(), dispatchWorkgroups: vi.fn(), end: vi.fn() })),
      finish: vi.fn(() => ({})),
    })),
  }
  return device as unknown as GPUDevice
}

function gpuFrame(timestamp: number): PipelineFrame & { release: ReturnType<typeof vi.fn> } {
  return { location: 'gpu', texture: {} as GPUTexture, width: 320, height: 180, timestamp, release: vi.fn() }
}

function queue(frames: readonly PipelineFrame[]): DecodedFrameSource {
  return {
    peekAt(time) { return [...frames].reverse().find((frame) => frame.timestamp <= time) ?? null },
    peekNext(timestamp) { return frames.find((frame) => frame.timestamp > timestamp) ?? null },
    endOfStream: false,
    epoch: 0,
  }
}

function fakeDevice(): GPUDevice & { createTexture: ReturnType<typeof vi.fn> } {
  const createTexture = vi.fn(() => ({ destroy: vi.fn() }))
  return { createTexture } as unknown as GPUDevice & { createTexture: ReturnType<typeof vi.fn> }
}

function failingStageDevice(): GPUDevice & { createdTextures: Array<{ destroy: ReturnType<typeof vi.fn> }> } {
  const createdTextures: Array<{ destroy: ReturnType<typeof vi.fn> }> = []
  const queue = {
    writeBuffer: vi.fn(),
    submit: vi.fn(),
    onSubmittedWorkDone: vi.fn(async () => { throw new Error('device-lost') }),
  }
  const device = {
    queue,
    createdTextures,
    createShaderModule: vi.fn(() => ({})),
    createBindGroupLayout: vi.fn(() => ({})),
    createPipelineLayout: vi.fn(() => ({})),
    createComputePipeline: vi.fn(() => ({})),
    createBuffer: vi.fn(() => ({ destroy: vi.fn() })),
    createTexture: vi.fn(() => {
      const texture = { createView: vi.fn(() => ({})), destroy: vi.fn() }
      createdTextures.push(texture)
      return texture
    }),
    createBindGroup: vi.fn(() => ({})),
    createCommandEncoder: vi.fn(() => ({
      beginComputePass: vi.fn(() => ({ setPipeline: vi.fn(), setBindGroup: vi.fn(), dispatchWorkgroups: vi.fn(), end: vi.fn() })),
      finish: vi.fn(() => ({})),
    })),
  }
  return device as unknown as GPUDevice & { createdTextures: Array<{ destroy: ReturnType<typeof vi.fn> }> }
}
