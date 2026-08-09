import { describe, expect, it, vi } from 'vitest'
import type { MediaEngine, SubtitleCueStyle, SubtitleTrack } from '@mx-player-max/types'

const track: SubtitleTrack = {
  id: 'external',
  source: { kind: 'file', format: 'srt' },
  format: 'srt',
  language: 'en',
  name: 'English',
  state: 'ready',
  cueCount: 1,
  diagnosticCount: 0,
}
const style: SubtitleCueStyle = {
  fontFamily: 'system-ui, sans-serif',
  fontSize: 36,
  color: '#FFFFFF',
  outlineColor: '#000000',
  outlineWidth: 2,
  bold: false,
  italic: false,
  underline: false,
  alignment: 'bottom-center',
  x: 50,
  y: 88,
}

const fakeEngine = {
  state: 'ready' as const,
  media: null,
  selection: null,
  nativeFeatures: null,
  nativeStats: null,
  customVideoStats: null,
  customAudioStats: null,
  audioClock: null,
  rendererKind: null,
  rendererState: null,
  rendererStats: null,
  subtitleTracks: [track] as readonly SubtitleTrack[],
  selectedSubtitleTrack: 'external',
  subtitleState: 'ready' as const,
  subtitleStyle: style,
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
  setVideoFilter: vi.fn(async () => {}),
  setVideoTransform: vi.fn(),
  listSubtitleTracks: vi.fn(() => [track] as readonly SubtitleTrack[]),
  addSubtitleTrack: vi.fn(async () => track),
  selectSubtitleTrack: vi.fn(async () => {}),
  removeSubtitleTrack: vi.fn(),
  closeSubtitles: vi.fn(),
  setSubtitleStyle: vi.fn(),
  resetSubtitleStyle: vi.fn(),
  attachSubtitleOverlay: vi.fn(),
  detachSubtitleOverlay: vi.fn(),
  readVideoFrame: vi.fn(async () => null),
  requestFullscreen: vi.fn(async () => {}),
  exitFullscreen: vi.fn(async () => {}),
  requestPictureInPicture: vi.fn(async () => {}),
  exitPictureInPicture: vi.fn(async () => {}),
  close: vi.fn(),
} as unknown as MediaEngine

vi.mock('@mx-player-max/core', () => ({ createMediaEngine: () => fakeEngine }))

import { MXPlayer } from '../src/index'

describe('MXPlayer subtitle API proxy', () => {
  it('proxies tracks, style, overlay lifecycle, and typed subtitle events', async () => {
    const player = new MXPlayer({ target: '#video', source: { kind: 'file', file: new Blob(['media']) as File } })
    await player.ready
    expect(player.subtitleTracks).toEqual([track])
    expect(player.selectedSubtitleTrack).toBe('external')
    expect(player.subtitleStyle).toBe(style)

    const listener = vi.fn()
    player.on('subtitlecuechange', listener)
    await player.addSubtitleTrack({ kind: 'file', file: new Blob(['sub']) as File, format: 'srt' }, { id: 'external' })
    await player.selectSubtitleTrack('external')
    player.removeSubtitleTrack('external')
    player.closeSubtitles()
    player.setSubtitleStyle({ fontSize: 42 })
    player.resetSubtitleStyle()
    player.attachSubtitleOverlay()
    player.detachSubtitleOverlay()

    expect(fakeEngine.on).toHaveBeenCalledWith('subtitlecuechange', listener)
    expect(fakeEngine.addSubtitleTrack).toHaveBeenCalledWith(expect.objectContaining({ kind: 'file' }), { id: 'external' })
    expect(fakeEngine.selectSubtitleTrack).toHaveBeenCalledWith('external')
    expect(fakeEngine.removeSubtitleTrack).toHaveBeenCalledWith('external')
    expect(fakeEngine.closeSubtitles).toHaveBeenCalledOnce()
    expect(fakeEngine.setSubtitleStyle).toHaveBeenCalledWith({ fontSize: 42 })
    expect(fakeEngine.resetSubtitleStyle).toHaveBeenCalledOnce()
    expect(fakeEngine.attachSubtitleOverlay).toHaveBeenCalledOnce()
    expect(fakeEngine.detachSubtitleOverlay).toHaveBeenCalledOnce()
    player.destroy()
  })
})
