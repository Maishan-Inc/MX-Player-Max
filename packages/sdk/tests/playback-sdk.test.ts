import { describe, expect, it, vi } from 'vitest'
import type { MediaEngine, MediaPreviewImage, MXPlayerOptions, PlaybackSnapshot } from '@mx-player-max/types'

const snapshot: PlaybackSnapshot = {
  sessionEpoch: 2, state: 'ready', paused: true, currentTime: 0, duration: null, played: [], buffered: [], bufferedAhead: 0,
  volume: 1, muted: false, playbackRate: 1, seeking: false, buffering: false, presentationMode: 'inline',
  capabilities: { seek: true, volume: true, playbackRate: true, fullscreen: false, pictureInPicture: false, preview: true }, lastError: null,
}
const preview: MediaPreviewImage = { blob: new Blob(['x'], { type: 'image/png' }), time: 0, width: 160, height: 90, sessionEpoch: 2 }
const pendingLoads: Array<{ promise: Promise<void>; resolve(): void }> = []

function pendingLoad(): Promise<void> {
  let resolve = (): void => {}
  const promise = new Promise<void>((done) => { resolve = done })
  pendingLoads.push({ promise, resolve })
  return promise
}

const fakeEngine = {
  playback: snapshot,
  state: 'ready', media: null, selection: null, nativeFeatures: null, nativeStats: null, customVideoStats: null, customAudioStats: null, audioClock: null,
  rendererKind: null, rendererState: null, rendererStats: null, subtitleTracks: [], selectedSubtitleTrack: null, subtitleState: 'disabled', subtitleStyle: {},
  on: vi.fn(() => () => {}), off: vi.fn(), once: vi.fn(() => () => {}), load: vi.fn(pendingLoad),
  requestPreview: vi.fn(async () => preview), close: vi.fn(),
} as unknown as MediaEngine

vi.mock('@mx-player-max/core', () => ({ createMediaEngine: () => fakeEngine }))

import { MXPlayer } from '../src/index'

const options: MXPlayerOptions = { target: '#host', source: { kind: 'url', url: 'https://example.test/media.mp4' } }

describe('MXPlayer Phase 9 playback facade', () => {
  it('tracks the current load promise and proxies playback/preview', async () => {
    pendingLoads.length = 0
    const player = new MXPlayer(options)
    const initial = pendingLoads[0]
    expect(player.ready).toBe(initial?.promise)
    const replacement = player.load({ ...options, source: { kind: 'url', url: 'https://example.test/replacement.mp4' } })
    expect(player.ready).toBe(replacement)
    expect(player.ready).not.toBe(initial?.promise)
    expect(player.playback).toBe(snapshot)
    await expect(player.requestPreview({ time: 0 })).resolves.toBe(preview)
    pendingLoads[1]?.resolve()
    await replacement
    expect(fakeEngine.load).toHaveBeenCalledTimes(2)
    expect(fakeEngine.requestPreview).toHaveBeenCalledWith({ time: 0 })
    player.destroy()
  })
})
