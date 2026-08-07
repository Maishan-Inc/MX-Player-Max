import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ErrorCodes } from '@mx-player-max/types'
import { NativeMediaPipeline } from '../src/native/pipeline'
import { FakeVideo } from './fake-video'

describe('NativeMediaPipeline', () => {
  beforeEach(() => {
    const NativeUrl = URL
    class TestUrl extends NativeUrl {
      static createObjectURL = vi.fn(() => 'blob:mx-test')
      static revokeObjectURL = vi.fn()
    }
    vi.stubGlobal('URL', TestUrl)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('configures local File sources and revokes the owned Object URL', async () => {
    const video = new FakeVideo()
    const events: string[] = []
    const pipeline = new NativeMediaPipeline(video as unknown as HTMLVideoElement, {
      isActive: () => true,
      onEvent: (event) => { events.push(event.type) },
    })
    await pipeline.load({ kind: 'file', file: new Blob(['media']) as File }, 'video/mp4; codecs="avc1.640028, mp4a.40.2"')
    expect(video.src).toBe('blob:mx-test')
    expect(video.contentType).toContain('avc1.640028')
    expect(video.preload).toBe('metadata')
    expect(video.playsInline).toBe(true)
    expect(events).toContain('ready')
    pipeline.close()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mx-test')
  })

  it('revokes the previous File Object URL when replacing a source', async () => {
    const createObjectURL = vi.fn().mockReturnValueOnce('blob:first').mockReturnValueOnce('blob:second')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })
    const video = new FakeVideo()
    const pipeline = new NativeMediaPipeline(video as unknown as HTMLVideoElement, { isActive: () => true, onEvent: () => {} })
    await pipeline.load({ kind: 'file', file: new Blob(['one']) as File }, 'video/mp4')
    await pipeline.load({ kind: 'file', file: new Blob(['two']) as File }, 'video/mp4')
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:first')
    pipeline.close()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:second')
  })

  it('sets remote crossOrigin before the direct URL and applies native defaults', async () => {
    const video = new FakeVideo()
    const pipeline = new NativeMediaPipeline(video as unknown as HTMLVideoElement, { isActive: () => true, onEvent: () => {} })
    await pipeline.load({ kind: 'url', url: 'https://media.example.test/watch?id=private' }, 'video/webm; codecs="vp8, opus"')
    expect(video.src).toBe('https://media.example.test/watch?id=private')
    expect(video.crossOrigin).toBe('anonymous')
    expect(video.order.indexOf('crossOrigin')).toBeLessThan(video.order.indexOf('src'))
    expect(video.preload).toBe('metadata')
    expect(video.playsInline).toBe(true)
    pipeline.close()
  })

  it('rejects custom remote headers and unsafe protocols at the native boundary', async () => {
    const video = new FakeVideo()
    const pipeline = new NativeMediaPipeline(video as unknown as HTMLVideoElement, { isActive: () => true, onEvent: () => {} })
    await expect(pipeline.load({ kind: 'url', url: 'https://media.example.test/video', headers: { Authorization: 'private' } }, 'video/mp4')).rejects.toMatchObject({ code: ErrorCodes.NATIVE_CUSTOM_HEADERS_UNSUPPORTED })
    await expect(pipeline.load({ kind: 'url', url: 'javascript:alert(1)' }, 'video/mp4')).rejects.toMatchObject({ code: ErrorCodes.NATIVE_SOURCE_INVALID })
    pipeline.close()
  })

  it('maps autoplay rejection to a stable error', async () => {
    const video = new FakeVideo()
    video.playReject = Object.assign(new Error('blocked'), { name: 'NotAllowedError' })
    const pipeline = new NativeMediaPipeline(video as unknown as HTMLVideoElement, { isActive: () => true, onEvent: () => {} })
    await pipeline.load({ kind: 'file', file: new Blob(['media']) as File }, 'video/mp4')
    await expect(pipeline.play()).rejects.toMatchObject({ code: ErrorCodes.NATIVE_AUTOPLAY_BLOCKED })
  })

  it('times out metadata waits without leaving a timer behind', async () => {
    vi.useFakeTimers()
    const video = new FakeVideo()
    video.load = () => { video.loaded = true }
    const pipeline = new NativeMediaPipeline(video as unknown as HTMLVideoElement, { isActive: () => true, onEvent: () => {} })
    const pending = pipeline.load({ kind: 'file', file: new Blob(['media']) as File }, 'video/mp4', { metadataTimeoutMs: 10 })
    const rejected = expect(pending).rejects.toMatchObject({ code: ErrorCodes.NATIVE_METADATA_TIMEOUT })
    await vi.advanceTimersByTimeAsync(10)
    await rejected
    pipeline.close()
    expect(vi.getTimerCount()).toBe(0)
    vi.useRealTimers()
  })

  it('reports duration as null for non-finite media duration and computes buffered ahead', async () => {
    const video = new FakeVideo()
    video.duration = Number.NaN
    video.bufferedRanges = [{ start: 0, end: 4 }]
    const received: unknown[] = []
    const pipeline = new NativeMediaPipeline(video as unknown as HTMLVideoElement, { isActive: () => true, onEvent: (event) => received.push(event) })
    await pipeline.load({ kind: 'file', file: new Blob(['media']) as File }, 'video/webm; codecs="vp09.00.10.08, opus"')
    video.duration = Number.POSITIVE_INFINITY
    video.currentTime = 1
    video.dispatch('timeupdate')
    video.dispatch('progress')
    expect(received).toContainEqual({ type: 'timeupdate', currentTime: 1_000_000, duration: null })
    expect(received).toContainEqual({ type: 'buffering', bufferedAhead: 3_000_000 })
    pipeline.close()
  })

  it('validates and applies playback controls', async () => {
    const video = new FakeVideo()
    const pipeline = new NativeMediaPipeline(video as unknown as HTMLVideoElement, { isActive: () => true, onEvent: () => {} })
    await pipeline.load({ kind: 'file', file: new Blob(['media']) as File }, 'video/mp4')
    await pipeline.play()
    pipeline.pause()
    await pipeline.seek(2.5)
    pipeline.setPlaybackRate(1.25)
    pipeline.setVolume(0.4)
    pipeline.setMuted(true)
    expect(video.currentTime).toBe(2.5)
    expect(video.playbackRate).toBe(1.25)
    expect(video.volume).toBe(0.4)
    expect(video.muted).toBe(true)
    await expect(pipeline.seek(Number.NaN)).rejects.toMatchObject({ code: ErrorCodes.NATIVE_INVALID_TIME })
    expect(() => pipeline.setPlaybackRate(0)).toThrowError(expect.objectContaining({ code: ErrorCodes.NATIVE_INVALID_RATE }))
    expect(() => pipeline.setVolume(2)).toThrowError(expect.objectContaining({ code: ErrorCodes.NATIVE_INVALID_VOLUME }))
    pipeline.close()
  })

  it('detects and maps fullscreen and Picture-in-Picture support', async () => {
    const video = new FakeVideo()
    video.ownerDocument = {
      fullscreenEnabled: true,
      pictureInPictureEnabled: true,
      exitFullscreen: vi.fn(async () => {}),
      exitPictureInPicture: vi.fn(async () => {}),
    } as unknown as typeof video.ownerDocument
    const pipeline = new NativeMediaPipeline(video as unknown as HTMLVideoElement, { isActive: () => true, onEvent: () => {} })
    await pipeline.load({ kind: 'file', file: new Blob(['media']) as File }, 'video/mp4')
    expect(pipeline.features).toMatchObject({ fullscreen: true, pictureInPicture: true, requestVideoFrameCallback: true, fastSeek: true })
    await pipeline.requestFullscreen()
    await pipeline.requestPictureInPicture()
    video.fullscreenReject = Object.assign(new Error('blocked'), { name: 'NotAllowedError' })
    video.pipReject = Object.assign(new Error('blocked'), { name: 'NotAllowedError' })
    await expect(pipeline.requestFullscreen()).rejects.toMatchObject({ code: ErrorCodes.NATIVE_FULLSCREEN_BLOCKED })
    await expect(pipeline.requestPictureInPicture()).rejects.toMatchObject({ code: ErrorCodes.NATIVE_PIP_BLOCKED })
    pipeline.close()

    const unsupported = new FakeVideo()
    unsupported.ownerDocument = { fullscreenEnabled: false, pictureInPictureEnabled: false } as unknown as typeof unsupported.ownerDocument
    const unsupportedPipeline = new NativeMediaPipeline(unsupported as unknown as HTMLVideoElement, { isActive: () => true, onEvent: () => {} })
    await unsupportedPipeline.load({ kind: 'file', file: new Blob(['media']) as File }, 'video/mp4')
    await expect(unsupportedPipeline.requestFullscreen()).rejects.toMatchObject({ code: ErrorCodes.NATIVE_FULLSCREEN_UNSUPPORTED })
    await expect(unsupportedPipeline.requestPictureInPicture()).rejects.toMatchObject({ code: ErrorCodes.NATIVE_PIP_UNSUPPORTED })
    unsupportedPipeline.close()
  })
})
