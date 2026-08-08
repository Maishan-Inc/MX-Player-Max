import { describe, expect, expectTypeOf, it } from 'vitest'
import type {
  CustomVideoOptions, EngineEventMap, MediaEngine, RendererCapabilities, RendererStats,
  VideoFilterOptions, VideoRendererPreference, VideoTransformOptions,
} from '../src/index'
import { ErrorCodes } from '../src/index'

describe('renderer public API', () => {
  it('publishes additive renderer, filter, and transform options', () => {
    expectTypeOf<VideoRendererPreference>().toEqualTypeOf<'auto' | 'webgpu' | 'webgl2' | 'canvas2d'>()
    expectTypeOf<CustomVideoOptions>().toHaveProperty('renderer')
    expectTypeOf<CustomVideoOptions>().toHaveProperty('filter')
    expectTypeOf<CustomVideoOptions>().toHaveProperty('render')
    expectTypeOf<VideoFilterOptions>().toHaveProperty('kind')
    expectTypeOf<VideoTransformOptions>().toHaveProperty('rotation')
  })

  it('exposes safe renderer state without frame or GPU resources', () => {
    expectTypeOf<MediaEngine>().toHaveProperty('rendererStats')
    expectTypeOf<MediaEngine>().toHaveProperty('setVideoFilter')
    expectTypeOf<RendererStats>().toHaveProperty('hdrPreserved')
    expectTypeOf<RendererCapabilities>().toHaveProperty('maxTextureDimension2d')
    expectTypeOf<EngineEventMap['rendererstats']>().not.toHaveProperty('frame')
    expectTypeOf<EngineEventMap['rendererstatechange']>().not.toHaveProperty('device')
  })

  it('publishes stable renderer errors', () => {
    expect(ErrorCodes.RENDERER_BACKEND_UNAVAILABLE).toBe('RENDERER_BACKEND_UNAVAILABLE')
    expect(ErrorCodes.RENDERER_DEVICE_LOST).toBe('RENDERER_DEVICE_LOST')
    expect(ErrorCodes.RENDERER_FRAME_INVALID).toBe('RENDERER_FRAME_INVALID')
    expect(ErrorCodes.RENDERER_CLOSED).toBe('RENDERER_CLOSED')
  })
})
