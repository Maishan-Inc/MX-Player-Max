import { describe, expect, it, vi } from 'vitest'
import type { DecodedVideoFrame, MediaEngine } from '@mx-player-max/types'

const close = vi.fn()
const decoded: DecodedVideoFrame = {
  frame: { close } as unknown as VideoFrame,
  timestamp: 10,
  duration: 20,
  epoch: 1,
}

const fakeEngine: MediaEngine = {
  state: 'ready', media: null, selection: null, nativeFeatures: null, nativeStats: null,
  customVideoStats: { decodedFrames: 1, deliveredFrames: 0, droppedFrames: 0, droppedStaleFrames: 0, droppedPreSeekFrames: 0, queuedFrames: 1, decodeQueueSize: 0, bufferedDuration: 20, endOfStream: false },
  on: vi.fn(() => () => {}), off: vi.fn(), once: vi.fn(() => () => {}),
  load: vi.fn(async () => {}), play: vi.fn(async () => {}), pause: vi.fn(), seek: vi.fn(async () => {}),
  setPlaybackRate: vi.fn(), setVolume: vi.fn(), setMuted: vi.fn(), readVideoFrame: vi.fn(async () => decoded),
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
    await expect(player.readVideoFrame()).resolves.toBe(decoded)
    expect(fakeEngine.readVideoFrame).toHaveBeenCalledOnce()
    decoded.frame.close()
    expect(close).toHaveBeenCalledOnce()
    player.destroy()
  })
})
