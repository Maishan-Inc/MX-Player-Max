import { describe, expect, it } from 'vitest'
import type { MediaCapabilityReport, TrackInfo } from '@mx-player-max/types'
import { ErrorCodes } from '@mx-player-max/types'
import { createVideoDecoderConfig } from '../src/index'

const avcC = Uint8Array.of(1, 0x64, 0, 0x28, 0xff, 0xe1, 0).buffer

describe('createVideoDecoderConfig', () => {
  it('builds MP4 H.264 avc1 with the real avcC description', () => {
    const track = videoTrack({ codecId: 'avc1', codec: 'avc1.640028', codecPrivate: avcC })
    const config = createVideoDecoderConfig(track, report('avc1.640028', avcC))
    expect(config).toMatchObject({ codec: 'avc1.640028', codedWidth: 1920, codedHeight: 1080, avc: { format: 'avc' } })
    expect(config.description).toBe(avcC)
  })

  it('derives an RFC 6381 H.264 codec from compatible Matroska avcC data', () => {
    const track = videoTrack({ codecId: 'V_MPEG4/ISO/AVC', codec: 'avc1', codecPrivate: avcC })
    expect(createVideoDecoderConfig(track, report('avc1', avcC)).codec).toBe('avc1.640028')
  })

  it('supports WebM VP8 without inventing a description', () => {
    const config = createVideoDecoderConfig(videoTrack({ codecId: 'V_VP8', codec: 'vp8' }), report('vp8'))
    expect(config.codec).toBe('vp8')
    expect(config.description).toBeUndefined()
  })

  it('preserves verified VP9 profile, level and bit depth', () => {
    const codec = 'vp09.02.10.10'
    expect(createVideoDecoderConfig(videoTrack({ codecId: 'V_VP9', codec }), report(codec)).codec).toBe(codec)
  })

  it('preserves verified AV1 configuration and compatible sequence data', () => {
    const codec = 'av01.0.04M.08'
    const description = Uint8Array.of(0x81, 0, 0, 0).buffer
    expect(createVideoDecoderConfig(videoTrack({ codecId: 'V_AV1', codec, codecPrivate: description }), report(codec, description))).toMatchObject({ codec, description })
  })

  it.each([
    ['unknown codec', videoTrack({ codecId: 'V_UNKNOWN', codec: 'unknown' }), report('unknown'), ErrorCodes.WEBCODECS_NOT_SUPPORTED],
    ['missing codec', videoTrack({ codecId: 'V_UNKNOWN' }), report(''), ErrorCodes.WEBCODECS_CONFIG_INVALID],
    ['container MIME', videoTrack({ codecId: 'V_VP9', codec: 'video/webm' }), report('video/webm'), ErrorCodes.WEBCODECS_CONFIG_INVALID],
    ['incomplete VP9 profile', videoTrack({ codecId: 'V_VP9', codec: 'vp09' }), report('vp09'), ErrorCodes.WEBCODECS_NOT_SUPPORTED],
    ['incomplete AV1 profile', videoTrack({ codecId: 'V_AV1', codec: 'av01' }), report('av01'), ErrorCodes.WEBCODECS_NOT_SUPPORTED],
    ['HEVC', videoTrack({ codecId: 'hvc1', codec: 'hvc1.1.6.L93.B0' }), report('hvc1.1.6.L93.B0'), ErrorCodes.WEBCODECS_NOT_SUPPORTED],
  ])('rejects %s without guessing from a file extension or container', (_label, track, capability, code) => {
    expect(() => createVideoDecoderConfig(track, capability)).toThrowError(expect.objectContaining({ code }))
  })

  it('rejects missing dimensions', () => {
    const track = videoTrack({ codecId: 'V_VP8', codec: 'vp8' })
    delete track.width
    const capability = report('vp8')
    if (capability.query.video) delete capability.query.video.codedWidth
    expect(() => createVideoDecoderConfig(track, capability)).toThrowError(expect.objectContaining({ code: ErrorCodes.WEBCODECS_CONFIG_INVALID }))
  })

  it('rejects incompatible H.264 and AV1 codec private data', () => {
    const bad = Uint8Array.of(0, 1, 2, 3).buffer
    expect(() => createVideoDecoderConfig(videoTrack({ codecId: 'avc1', codec: 'avc1.640028', codecPrivate: bad }), report('avc1.640028', bad))).toThrowError(expect.objectContaining({ code: ErrorCodes.WEBCODECS_CONFIG_INVALID }))
    expect(() => createVideoDecoderConfig(videoTrack({ codecId: 'V_AV1', codec: 'av01.0.04M.08', codecPrivate: bad }), report('av01.0.04M.08', bad))).toThrowError(expect.objectContaining({ code: ErrorCodes.WEBCODECS_CONFIG_INVALID }))
  })

  it('requires the concrete capability report to be supported', () => {
    const capability = report('vp8')
    capability.webCodecs.video.status = 'unsupported'
    expect(() => createVideoDecoderConfig(videoTrack({ codecId: 'V_VP8', codec: 'vp8' }), capability)).toThrowError(expect.objectContaining({ code: ErrorCodes.WEBCODECS_NOT_SUPPORTED }))
  })
})

function videoTrack(overrides: Partial<TrackInfo>): TrackInfo {
  return { id: 1, kind: 'video', codecId: 'V_VP8', width: 1920, height: 1080, frameRate: 30, ...overrides }
}

function report(codec: string, description?: ArrayBuffer, width = 1920): MediaCapabilityReport {
  return {
    schemaVersion: 1,
    query: {
      container: 'test',
      mimeType: null,
      video: {
        codec,
        ...(width === undefined ? {} : { codedWidth: width }),
        codedHeight: 1080,
        ...(description === undefined ? {} : { description }),
      },
      audio: null,
    },
    native: {
      video: { status: 'unsupported', reasons: [], contentType: null, canPlayType: '' },
      audio: { status: 'unknown', reasons: [], contentType: null, canPlayType: '' },
      playable: 'unsupported', reasons: [],
    },
    webCodecs: {
      video: { status: 'supported', reasons: [], configPresent: true },
      audio: { status: 'unknown', reasons: [], configPresent: false },
      playable: 'supported', reasons: [],
    },
  }
}
