import { describe, expect, it, vi } from 'vitest'
import type { AudioClockSnapshot, CustomAudioStats, DecodedVideoFrame, MediaEngine } from '@mx-player-max/types'

const close = vi.fn()
const decoded: DecodedVideoFrame = {
  frame: { close } as unknown as VideoFrame,
  timestamp: 10,
  duration: 20,
  epoch: 1,
}

const audioStats: CustomAudioStats = {
  decodedBlocks: 1, decodedFrames: 480, renderedFrames: 240, droppedStaleBlocks: 0,
  droppedPreSeekFrames: 0, underruns: 0, overflows: 0, decodeQueueSize: 0,
  bufferedFrames: 240, bufferedDuration: 5_000, inputSampleRate: 48_000, outputSampleRate: 48_000,
  channels: 2, pendingMessageBlocks: 1, transport: 'message-port', outputState: 'running', endOfStream: false,
}

const audioClock: AudioClockSnapshot = {
  source: 'audio-context', mediaTime: 5_000, contextTime: 1_000_000, renderedFrames: 240,
  sampleRate: 48_000, playbackRate: 1, running: true, underrun: false, epoch: 0,
}

const fakeEngine: MediaEngine = {
  state: 'ready', media: null, selection: null, nativeFeatures: null, nativeStats: null,
  rendererKind: 'canvas2d', rendererState: 'ready', rendererStats: {
    kind: 'canvas2d', state: 'ready', presentedFrames: 1, droppedFrames: 0, waitFrames: 0, invalidFrames: 0,
    fallbackCount: 0, width: 320, height: 180, devicePixelRatio: 1, colorMode: 'sdr-bt709', colorRange: 'full',
    hdrPreserved: false, hdrReason: null, filter: 'none',
  },
  customVideoStats: { decodedFrames: 1, deliveredFrames: 0, droppedFrames: 0, droppedStaleFrames: 0, droppedPreSeekFrames: 0, queuedFrames: 1, decodeQueueSize: 0, bufferedDuration: 20, endOfStream: false },
  customAudioStats: audioStats, audioClock,
  on: vi.fn(() => () => {}), off: vi.fn(), once: vi.fn(() => () => {}),
  load: vi.fn(async () => {}), play: vi.fn(async () => {}), pause: vi.fn(), seek: vi.fn(async () => {}),
  setPlaybackRate: vi.fn(), setVolume: vi.fn(), setMuted: vi.fn(), setVideoFilter: vi.fn(async () => {}), setVideoTransform: vi.fn(), readVideoFrame: vi.fn(async () => decoded),
  requestFullscreen: vi.fn(async () => {}), exitFullscreen: vi.fn(async () => {}),
  requestPictureInPicture: vi.fn(async () => {}), exitPictureInPicture: vi.fn(async () => {}), close: vi.fn(),
}

vi.mock('@mx-player-max/core', () => ({ createMediaEngine: () => fakeEngine }))

import { MXPlayer } from '../src/index'

describe('MXPlayer custom video API', () => {
  it('proxies pull-based frame access and custom statistics', async () => {
    const player = new MXPlayer({ target: '#target', source: { kind: 'url', url: 'https://example.test/media' }, intent: 'frame-access' })
    await player.ready
    expect(player.customVideoStats).toBe(fakeEngine.customVideoStats)
    expect(player.customAudioStats).toBe(audioStats)
    expect(player.audioClock).toBe(audioClock)
    expect(player.rendererKind).toBe('canvas2d')
    expect(player.rendererState).toBe('ready')
    expect(player.rendererStats).toBe(fakeEngine.rendererStats)
    await player.setVideoFilter({ kind: 'grayscale', amount: 1 })
    player.setVideoTransform({ rotation: 90 })
    await expect(player.readVideoFrame()).resolves.toBe(decoded)
    expect(fakeEngine.readVideoFrame).toHaveBeenCalledOnce()
    expect(fakeEngine.setVideoFilter).toHaveBeenCalledWith({ kind: 'grayscale', amount: 1 })
    expect(fakeEngine.setVideoTransform).toHaveBeenCalledWith({ rotation: 90 })
    decoded.frame.close()
    expect(close).toHaveBeenCalledOnce()
    player.destroy()
  })
})
