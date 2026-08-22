import { describe, expect, it } from 'vitest'
import type { MediaDescriptor } from '@mx-player-max/types'
import { codecName, mediaSummaryParts, mediaSummaryText } from './media-summary'

const MEDIA: MediaDescriptor = {
  container: 'webm',
  mimeType: 'video/webm',
  duration: 180_000_000,
  size: 15_540_736,
  tracks: [
    { id: 1, kind: 'video', codecId: 'V_VP8', codec: 'vp8', width: 640, height: 360, frameRate: 24, color: { bitDepth: 8, hdrFormat: 'none' } },
    { id: 2, kind: 'audio', codecId: 'A_OPUS', codec: 'opus', channels: 1, sampleRate: 48_000 },
  ],
}

describe('demo media readout', () => {
  it('reports the concrete file parameters instead of the playback intent', () => {
    expect(mediaSummaryParts({ media: MEDIA, backend: 'html-video', pendingLabel: 'pending' })).toEqual([
      'VP8 · 640×360 · 24 fps · 8-bit',
      'Opus · 1ch · 48 kHz',
      'WEBM · html-video',
    ])
    expect(mediaSummaryText({ media: MEDIA, backend: null, pendingLabel: 'pending' })).toBe('VP8 · 640×360 · 24 fps · 8-bit  ·  Opus · 1ch · 48 kHz  ·  WEBM')
  })

  it('names HDR and counts subtitle tracks', () => {
    const media: MediaDescriptor = {
      ...MEDIA,
      container: 'matroska',
      tracks: [
        { id: 1, kind: 'video', codecId: 'V_MPEGH/ISO/HEVC', codec: 'hvc1.2.4.L153.B0', width: 3840, height: 2160, frameRate: 23.976, color: { bitDepth: 10, hdrFormat: 'hdr10' } },
        { id: 2, kind: 'audio', codecId: 'A_EAC3', channels: 6, sampleRate: 48_000 },
        { id: 3, kind: 'subtitle', codecId: 'S_TEXT/ASS' },
        { id: 4, kind: 'subtitle', codecId: 'S_TEXT/UTF8' },
      ],
    }
    expect(mediaSummaryParts({ media, backend: 'webcodecs', pendingLabel: 'pending' })).toEqual([
      'H.265/HEVC · 3840×2160 · 23.976 fps · 10-bit · HDR10',
      'E-AC-3 · 6ch · 48 kHz',
      '2 sub',
      'MATROSKA · webcodecs',
    ])
  })

  it('falls back to the pending label and keeps unknown identifiers readable', () => {
    expect(mediaSummaryParts({ media: null, backend: null, pendingLabel: 'pending' })).toEqual(['pending'])
    expect(mediaSummaryParts({ media: { ...MEDIA, container: '', tracks: [] }, backend: null, pendingLabel: 'pending' })).toEqual(['pending'])
    expect(codecName({ id: 9, kind: 'audio', codecId: 'A_MYSTERY/CODEC' })).toBe('MYSTERY/CODEC')
  })
})
