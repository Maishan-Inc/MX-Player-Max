import type { CustomAudioOptions, MediaCapabilityReport, TrackInfo } from '@mx-player-max/types'
import { ErrorCodes } from '@mx-player-max/types'
import { createWebCodecsError } from './errors'

const AAC_CODEC = /^mp4a\.40\.(\d+)$/i

export function createAudioDecoderConfig(
  track: TrackInfo,
  report: MediaCapabilityReport,
  _options: CustomAudioOptions = {},
): AudioDecoderConfig {
  if (track.kind !== 'audio') throw invalidConfig('The selected track is not audio')
  if (report.webCodecs.audio.status !== 'supported') {
    throw createWebCodecsError(ErrorCodes.WEBCODECS_AUDIO_NOT_SUPPORTED, 'The audio configuration was not verified as supported', false)
  }
  const query = report.query.audio
  if (!query) throw invalidConfig('The verified audio configuration is missing')
  const codec = query.codec.trim().toLowerCase()
  const trackCodec = track.codec?.trim().toLowerCase()
  const sampleRate = query.sampleRate ?? track.sampleRate
  const numberOfChannels = query.numberOfChannels ?? track.channels
  if (!codec || !trackCodec || codec !== trackCodec || codec.includes('/') || !positiveInteger(sampleRate) || !positiveInteger(numberOfChannels)) {
    throw invalidConfig('The AudioDecoder configuration is incomplete')
  }
  if (numberOfChannels > 2) {
    throw createWebCodecsError(ErrorCodes.AUDIO_CHANNEL_LAYOUT_UNSUPPORTED, 'Only mono and stereo audio layouts are enabled in Phase 5', false)
  }
  const base: AudioDecoderConfig = {
    codec,
    sampleRate,
    numberOfChannels,
    ...(query.bitrate !== undefined ? { bitrate: finitePositive(query.bitrate) } : {}),
  }
  const aac = AAC_CODEC.exec(codec)
  if (aac) {
    const description = query.description ?? track.codecPrivate
    const objectType = Number(aac[1])
    if (!isCompatibleAsc(description, objectType, sampleRate, numberOfChannels)) throw invalidConfig('AAC requires a compatible AudioSpecificConfig')
    return { ...base, description }
  }
  if (codec === 'opus') {
    const description = query.description ?? track.codecPrivate
    if (description === undefined) return base
    const opusHead = normalizeOpusDescription(description, numberOfChannels)
    return { ...base, description: opusHead }
  }
  if (codec === 'mp3') {
    if (query.description !== undefined || track.codecPrivate !== undefined) {
      throw invalidConfig('MP3 must not include fabricated codec private data')
    }
    return base
  }
  throw createWebCodecsError(ErrorCodes.WEBCODECS_AUDIO_NOT_SUPPORTED, 'The audio codec is outside the Phase 5 codec scope', false)
}

function normalizeOpusDescription(value: ArrayBuffer, channels: number): ArrayBuffer {
  const bytes = new Uint8Array(value)
  if (isOpusHead(bytes, channels)) return value
  if (isDops(bytes, channels)) return dopsToOpusHead(bytes)
  throw invalidConfig('Opus codec private data is not a compatible OpusHead or dOps record')
}

function isOpusHead(bytes: Uint8Array, channels: number): boolean {
  if (bytes.byteLength < 19) return false
  const signature = String.fromCharCode(...bytes.subarray(0, 8))
  return signature === 'OpusHead' && bytes[8] === 1 && bytes[9] === channels
}

function isDops(bytes: Uint8Array, channels: number): boolean {
  if (bytes.byteLength < 11 || bytes[0] !== 0 || bytes[1] !== channels) return false
  const mappingFamily = bytes[10]
  if (mappingFamily === 0) return channels === 1 || channels === 2
  return bytes.byteLength >= 13 + channels
}

function dopsToOpusHead(bytes: Uint8Array): ArrayBuffer {
  const channels = bytes[1] ?? 0
  const mappingFamily = bytes[10] ?? 0
  const extra = mappingFamily === 0 ? 0 : 2 + channels
  const output = new Uint8Array(19 + extra)
  output.set(new TextEncoder().encode('OpusHead'), 0)
  output[8] = 1
  output[9] = channels
  output[10] = bytes[3] ?? 0
  output[11] = bytes[2] ?? 0
  output[12] = bytes[7] ?? 0
  output[13] = bytes[6] ?? 0
  output[14] = bytes[5] ?? 0
  output[15] = bytes[4] ?? 0
  output[16] = bytes[9] ?? 0
  output[17] = bytes[8] ?? 0
  output[18] = mappingFamily
  if (mappingFamily !== 0) output.set(bytes.subarray(11), 19)
  return output.buffer
}

function isCompatibleAsc(
  value: ArrayBuffer | undefined,
  codecObjectType: number,
  sampleRate: number,
  channels: number,
): value is ArrayBuffer {
  if (value === undefined || value.byteLength < 2) return false
  try {
    const bits = new AscBitReader(new Uint8Array(value))
    let objectType = bits.read(5)
    if (objectType === 31) objectType = 32 + bits.read(6)
    const frequencyIndex = bits.read(4)
    const frequency = frequencyIndex === 15 ? bits.read(24) : AAC_SAMPLE_RATES[frequencyIndex]
    const channelConfig = bits.read(4)
    return objectType === codecObjectType && frequency === sampleRate && channelConfig === channels
  } catch {
    return false
  }
}

const AAC_SAMPLE_RATES: readonly number[] = [96_000, 88_200, 64_000, 48_000, 44_100, 32_000, 24_000, 22_050, 16_000, 12_000, 11_025, 8_000, 7_350]

class AscBitReader {
  readonly #bytes: Uint8Array
  #offset = 0

  constructor(bytes: Uint8Array) { this.#bytes = bytes }

  read(count: number): number {
    if (!Number.isSafeInteger(count) || count < 1 || count > 24 || this.#offset + count > this.#bytes.byteLength * 8) throw new Error('truncated ASC')
    let value = 0
    for (let index = 0; index < count; index += 1) {
      const bitOffset = this.#offset + index
      const byte = this.#bytes[Math.floor(bitOffset / 8)] ?? 0
      value = value * 2 + ((byte >> (7 - bitOffset % 8)) & 1)
    }
    this.#offset += count
    return value
  }
}

function positiveInteger(value: number | undefined): value is number {
  return value !== undefined && Number.isSafeInteger(value) && value > 0
}

function finitePositive(value: number): number {
  if (!Number.isFinite(value) || value <= 0) throw invalidConfig('The audio bitrate is invalid')
  return value
}

function invalidConfig(message: string) {
  return createWebCodecsError(ErrorCodes.WEBCODECS_AUDIO_CONFIG_INVALID, message, false)
}
