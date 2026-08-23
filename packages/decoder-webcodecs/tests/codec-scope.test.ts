import { describe, expect, it } from 'vitest'
import type { MediaCapabilityReport, TrackInfo } from '@mx-player-max/types'
import { codecWithinDecoderScope, ErrorCodes } from '@mx-player-max/types'
import { createAudioDecoderConfig, createVideoDecoderConfig, WEBCODECS_CODEC_SCOPE } from '../src/index'

/**
 * The strategy layer decides whether to rank this backend from `WEBCODECS_CODEC_SCOPE` alone, so the
 * declaration has to agree with what the two config builders accept. These cases compare the two
 * directly: a codec is "declared" if it is in the scope, and "rejected" if the builder raises one of
 * the scope error codes. A `*_CONFIG_INVALID` rejection is deliberately not counted — that means the
 * codec is covered but its description is unusable, which is a different failure.
 */
const VIDEO_SCOPE_CODES = new Set<string>([ErrorCodes.WEBCODECS_NOT_SUPPORTED])
const AUDIO_SCOPE_CODES = new Set<string>([ErrorCodes.WEBCODECS_AUDIO_NOT_SUPPORTED])

const AVC_RECORD = Uint8Array.of(1, 0x64, 0x00, 0x28, 0xff, 0xe1, 0, 0).buffer

describe('declared WebCodecs codec scope', () => {
  it.each([
    'avc1',
    'avc1.640028',
    'avc3.640028',
    'vp8',
    'vp08.00.10.08',
    'vp09.00.11.08',
    'vp09.02.11.10',
    'av01.0.04M.08',
    'hvc1.2.4.L120.B0',
    'hev1.1.6.L93.B0',
    'theora',
    'mp4a.40.2',
  ])('agrees with createVideoDecoderConfig for %s', (codec) => {
    expect(codecWithinDecoderScope(WEBCODECS_CODEC_SCOPE, 'video', codec)).toBe(!videoRejectedAsOutOfScope(codec))
  })

  it.each([
    'mp4a.40.2',
    'mp4a.40.5',
    'opus',
    'mp3',
    'vorbis',
    'flac',
    'ac-3',
    'ec-3',
    'alaw',
    'vp8',
  ])('agrees with createAudioDecoderConfig for %s', (codec) => {
    expect(codecWithinDecoderScope(WEBCODECS_CODEC_SCOPE, 'audio', codec)).toBe(!audioRejectedAsOutOfScope(codec))
  })

  it('declares the same two-channel ceiling the audio builder enforces', () => {
    expect(codecWithinDecoderScope(WEBCODECS_CODEC_SCOPE, 'audio', 'mp3', 2)).toBe(true)
    expect(codecWithinDecoderScope(WEBCODECS_CODEC_SCOPE, 'audio', 'mp3', 6)).toBe(false)
    expect(() => createAudioDecoderConfig(audioTrack('mp3', 6), audioReport('mp3', 6)))
      .toThrowError(expect.objectContaining({ code: ErrorCodes.AUDIO_CHANNEL_LAYOUT_UNSUPPORTED }))
  })

  it('declares nothing for the container labels a codec string must never carry', () => {
    for (const label of ['mp4', 'webm', 'matroska', 'video/mp4', '']) {
      expect(codecWithinDecoderScope(WEBCODECS_CODEC_SCOPE, 'video', label)).toBe(false)
      expect(codecWithinDecoderScope(WEBCODECS_CODEC_SCOPE, 'audio', label)).toBe(false)
    }
  })
})

function videoRejectedAsOutOfScope(codec: string): boolean {
  try {
    createVideoDecoderConfig(
      { id: 1, kind: 'video', codecId: codec, codec, codecPrivate: AVC_RECORD, width: 320, height: 180 } satisfies TrackInfo,
      videoReport(codec),
    )
    return false
  } catch (cause) {
    return VIDEO_SCOPE_CODES.has(errorCode(cause))
  }
}

function audioRejectedAsOutOfScope(codec: string): boolean {
  try {
    createAudioDecoderConfig(audioTrack(codec, 2), audioReport(codec, 2))
    return false
  } catch (cause) {
    return AUDIO_SCOPE_CODES.has(errorCode(cause))
  }
}

function errorCode(cause: unknown): string {
  return typeof cause === 'object' && cause !== null && 'code' in cause && typeof cause.code === 'string' ? cause.code : 'UNKNOWN'
}

function audioTrack(codec: string, channels: number): TrackInfo {
  return { id: 2, kind: 'audio', codecId: codec, codec, sampleRate: 48_000, channels }
}

function videoReport(codec: string): MediaCapabilityReport {
  return {
    schemaVersion: 1,
    query: { container: 'test', mimeType: null, video: { codec, codedWidth: 320, codedHeight: 180 }, audio: null },
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

function audioReport(codec: string, channels: number): MediaCapabilityReport {
  return {
    schemaVersion: 1,
    query: { container: 'test', mimeType: null, video: null, audio: { codec, sampleRate: 48_000, numberOfChannels: channels } },
    native: {
      video: { status: 'unknown', reasons: [], contentType: null, canPlayType: '' },
      audio: { status: 'unsupported', reasons: [], contentType: null, canPlayType: '' },
      playable: 'unsupported', reasons: [],
    },
    webCodecs: {
      video: { status: 'unknown', reasons: [], configPresent: false },
      audio: { status: 'supported', reasons: [], configPresent: true },
      playable: 'supported', reasons: [],
    },
  }
}
