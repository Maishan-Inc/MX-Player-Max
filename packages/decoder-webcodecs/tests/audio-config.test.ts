import { describe, expect, it } from 'vitest'
import type { MediaCapabilityReport, TrackInfo } from '@mx-player-max/types'
import { ErrorCodes } from '@mx-player-max/types'
import { createAudioDecoderConfig } from '../src/index'

const asc = Uint8Array.of(0x11, 0x90).buffer
const dops = Uint8Array.of(0, 2, 0x01, 0x38, 0, 0, 0xbb, 0x80, 0, 0, 0).buffer

describe('createAudioDecoderConfig', () => {
  it('builds AAC from a full codec and compatible ASC', () => {
    expect(createAudioDecoderConfig(track({ codec: 'mp4a.40.2', codecPrivate: asc }), report('mp4a.40.2', asc)))
      .toMatchObject({ codec: 'mp4a.40.2', sampleRate: 48_000, numberOfChannels: 2, description: asc })
  })

  it('converts a compatible MP4 dOps record to OpusHead', () => {
    const config = createAudioDecoderConfig(track({ codec: 'opus', codecPrivate: dops }), report('opus', dops))
    expect(new TextDecoder().decode(new Uint8Array(config.description as ArrayBuffer, 0, 8))).toBe('OpusHead')
    expect(new Uint8Array(config.description as ArrayBuffer)[9]).toBe(2)
  })

  it('supports OpusHead and MP3 without inventing descriptions', () => {
    const head = Uint8Array.of(...new TextEncoder().encode('OpusHead'), 1, 1, 0, 0, 0x80, 0xbb, 0, 0, 0, 0, 0).buffer
    expect(createAudioDecoderConfig(track({ codec: 'opus', channels: 1, codecPrivate: head }), report('opus', head, 1)).description).toBe(head)
    expect(createAudioDecoderConfig(track({ codec: 'mp3' }), report('mp3')).description).toBeUndefined()
  })

  it.each([
    ['unknown codec', track({ codec: 'flac' }), report('flac'), ErrorCodes.WEBCODECS_AUDIO_NOT_SUPPORTED],
    ['missing sample rate', track({ codec: 'mp3', sampleRate: undefined }), report('mp3', undefined, 2, null), ErrorCodes.WEBCODECS_AUDIO_CONFIG_INVALID],
    ['unsupported layout', track({ codec: 'mp3', channels: 6 }), report('mp3', undefined, 6), ErrorCodes.AUDIO_CHANNEL_LAYOUT_UNSUPPORTED],
    ['bad AAC private data', track({ codec: 'mp4a.40.2', codecPrivate: Uint8Array.of(1).buffer }), report('mp4a.40.2', Uint8Array.of(1).buffer), ErrorCodes.WEBCODECS_AUDIO_CONFIG_INVALID],
    ['AAC sample rate mismatch', track({ codec: 'mp4a.40.2', codecPrivate: Uint8Array.of(0x12, 0x10).buffer }), report('mp4a.40.2', Uint8Array.of(0x12, 0x10).buffer), ErrorCodes.WEBCODECS_AUDIO_CONFIG_INVALID],
    ['AAC channel mismatch', track({ codec: 'mp4a.40.2', codecPrivate: Uint8Array.of(0x11, 0x88).buffer }), report('mp4a.40.2', Uint8Array.of(0x11, 0x88).buffer), ErrorCodes.WEBCODECS_AUDIO_CONFIG_INVALID],
    ['bad Opus private data', track({ codec: 'opus', codecPrivate: Uint8Array.of(1, 2).buffer }), report('opus', Uint8Array.of(1, 2).buffer), ErrorCodes.WEBCODECS_AUDIO_CONFIG_INVALID],
    ['MP3 private data', track({ codec: 'mp3', codecPrivate: asc }), report('mp3', asc), ErrorCodes.WEBCODECS_AUDIO_CONFIG_INVALID],
    ['mismatched capability codec', track({ codec: 'mp3' }), report('opus'), ErrorCodes.WEBCODECS_AUDIO_CONFIG_INVALID],
  ])('rejects %s', (_label, value, capability, code) => {
    expect(() => createAudioDecoderConfig(value, capability)).toThrowError(expect.objectContaining({ code }))
  })
})

function track(overrides: Partial<TrackInfo>): TrackInfo {
  return { id: 2, kind: 'audio', codecId: 'audio', codec: 'mp3', sampleRate: 48_000, channels: 2, ...overrides }
}

function report(codec: string, description?: ArrayBuffer, channels = 2, sampleRate: number | null = 48_000): MediaCapabilityReport {
  return {
    schemaVersion: 1,
    query: { container: 'test', mimeType: null, video: null, audio: { codec, ...(sampleRate === null ? {} : { sampleRate }), numberOfChannels: channels, ...(description === undefined ? {} : { description }) } },
    native: { video: { status: 'unknown', reasons: [], contentType: null, canPlayType: '' }, audio: { status: 'unsupported', reasons: [], contentType: null, canPlayType: '' }, playable: 'unsupported', reasons: [] },
    webCodecs: { video: { status: 'unknown', reasons: [], configPresent: false }, audio: { status: 'supported', reasons: [], configPresent: true }, playable: 'supported', reasons: [] },
  }
}
