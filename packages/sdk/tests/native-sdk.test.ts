import { describe, expect, it, vi } from 'vitest'
import type { MediaEngine } from '@mx-player-max/types'

const fakeEngine: MediaEngine = {
  state: 'ready',
  media: null,
  selection: null,
  nativeFeatures: { fullscreen: true, pictureInPicture: true, requestVideoFrameCallback: true, fastSeek: true },
  nativeStats: null,
  on: vi.fn(() => () => {}),
  off: vi.fn(),
  once: vi.fn(() => () => {}),
  load: vi.fn(async () => {}),
  play: vi.fn(async () => {}),
  pause: vi.fn(),
  seek: vi.fn(async () => {}),
  setPlaybackRate: vi.fn(),
  setVolume: vi.fn(),
  setMuted: vi.fn(),
  requestFullscreen: vi.fn(async () => {}),
  exitFullscreen: vi.fn(async () => {}),
  requestPictureInPicture: vi.fn(async () => {}),
  exitPictureInPicture: vi.fn(async () => {}),
  close: vi.fn(),
}

vi.mock('@mx-player-max/core', () => ({ createMediaEngine: () => fakeEngine }))

import { MXPlayer } from '../src/index'

describe('MXPlayer native API proxy', () => {
  it('proxies controls, events and state getters to core', async () => {
    const player = new MXPlayer({ target: '#video', source: { kind: 'url', url: 'https://example.test/video.mp4' } })
    await player.ready
    expect(player.state).toBe('ready')
    expect(player.nativeFeatures?.pictureInPicture).toBe(true)
    const listener = vi.fn()
    player.on('timeupdate', listener)
    player.off('timeupdate', listener)
    player.once('timeupdate', listener)
    player.setPlaybackRate(1.5)
    player.setVolume(0.5)
    player.setMuted(true)
    await player.seek(2_000_000)
    await player.requestFullscreen()
    await player.requestPictureInPicture()
    player.pause()
    player.destroy()
    expect(fakeEngine.setPlaybackRate).toHaveBeenCalledWith(1.5)
    expect(fakeEngine.setVolume).toHaveBeenCalledWith(0.5)
    expect(fakeEngine.seek).toHaveBeenCalledWith(2_000_000)
    expect(fakeEngine.on).toHaveBeenCalledWith('timeupdate', listener)
    expect(fakeEngine.off).toHaveBeenCalledWith('timeupdate', listener)
    expect(fakeEngine.once).toHaveBeenCalledWith('timeupdate', listener)
    expect(fakeEngine.close).toHaveBeenCalledOnce()
  })
})
