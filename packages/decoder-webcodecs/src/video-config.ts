import type { CustomVideoOptions, MediaCapabilityReport, TrackInfo, VideoCodecConfig } from '@mx-player-max/types'
import { ErrorCodes } from '@mx-player-max/types'
import type { Phase4VideoDecoderConfig } from './contracts'
import { createWebCodecsError } from './errors'

const FULL_AVC_CODEC = /^avc[13]\.[0-9a-f]{6}$/i
const VP8_CODEC = /^(?:vp8|vp08(?:\..+)?)$/i
const VP9_CODEC = /^vp09\.\d{2}\.\d{2}\.(?:08|10|12)(?:\..+)?$/i
const AV1_CODEC = /^av01\.[0-2]\.\d{2}[mh]\.(?:08|10|12)(?:\..+)?$/i
const HEVC_CODEC = /^(?:hvc1|hev1)/i

export function createVideoDecoderConfig(
  track: TrackInfo,
  report: MediaCapabilityReport,
  options: CustomVideoOptions = {},
): Phase4VideoDecoderConfig {
  if (track.kind !== 'video') throw invalidConfig('The selected track is not video')
  if (report.webCodecs.video.status !== 'supported') {
    throw createWebCodecsError(ErrorCodes.WEBCODECS_NOT_SUPPORTED, 'The video configuration was not verified as supported', false)
  }
  const query = report.query.video
  if (!query) throw invalidConfig('The verified video configuration is missing')
  const codec = normalizeCodec(query, track)
  const codedWidth = query.codedWidth ?? track.width
  const codedHeight = query.codedHeight ?? track.height
  if (!positiveInteger(codedWidth) || !positiveInteger(codedHeight)) {
    throw invalidConfig('The video dimensions are missing or invalid')
  }

  const description = query.description ?? track.codecPrivate
  const base: Phase4VideoDecoderConfig = {
    codec,
    codedWidth,
    codedHeight,
    ...(query.displayWidth !== undefined ? { displayWidth: query.displayWidth } : {}),
    ...(query.displayHeight !== undefined ? { displayHeight: query.displayHeight } : {}),
    ...(query.bitrate !== undefined ? { bitrate: finitePositive(query.bitrate, 'bitrate') } : {}),
    ...(query.framerate !== undefined ? { framerate: finitePositive(query.framerate, 'framerate') } : {}),
    ...(options.hardwareAcceleration !== undefined ? { hardwareAcceleration: options.hardwareAcceleration } : {}),
    ...(options.optimizeForLatency !== undefined ? { optimizeForLatency: options.optimizeForLatency } : {}),
    ...colorSpace(track),
  }

  if (FULL_AVC_CODEC.test(codec)) {
    if (!isAvcConfigurationRecord(description)) throw invalidConfig('H.264 requires a compatible avcC description')
    return { ...base, description, avc: { format: 'avc' } }
  }
  if (VP8_CODEC.test(codec)) return base
  if (VP9_CODEC.test(codec)) return base
  if (AV1_CODEC.test(codec)) {
    if (description === undefined) return base
    if (!isCompatibleAv1Description(description)) throw invalidConfig('AV1 codec private data is incompatible')
    return { ...base, description }
  }
  if (HEVC_CODEC.test(codec)) {
    throw createWebCodecsError(ErrorCodes.WEBCODECS_NOT_SUPPORTED, 'HEVC is outside the Phase 4 codec scope', false)
  }
  throw createWebCodecsError(ErrorCodes.WEBCODECS_NOT_SUPPORTED, 'The video codec is outside the Phase 4 codec scope', false)
}

function normalizeCodec(query: VideoCodecConfig, track: TrackInfo): string {
  const value = query.codec.trim()
  if (!value || value.includes('/') || /^video\//i.test(value) || value === track.codecId && /^(?:mp4|webm|matroska)$/i.test(value)) {
    throw invalidConfig('The video codec is missing or invalid')
  }
  if (/^avc[13]$/i.test(value)) {
    const description = query.description ?? track.codecPrivate
    if (!isAvcConfigurationRecord(description)) throw invalidConfig('H.264 requires an RFC 6381 codec and avcC data')
    const bytes = new Uint8Array(description)
    return `${value.toLowerCase()}.${[bytes[1], bytes[2], bytes[3]].map((part) => (part ?? 0).toString(16).padStart(2, '0')).join('')}`
  }
  return value
}

function positiveInteger(value: number | undefined): value is number {
  return value !== undefined && Number.isSafeInteger(value) && value > 0
}

function finitePositive(value: number, field: string): number {
  if (!Number.isFinite(value) || value <= 0) throw invalidConfig(`The video ${field} is invalid`)
  return value
}

function isAvcConfigurationRecord(value: ArrayBuffer | undefined): value is ArrayBuffer {
  if (value === undefined || value.byteLength < 7) return false
  const bytes = new Uint8Array(value)
  return bytes[0] === 1 && (bytes[4] ?? 0) >>> 2 === 63
}

function isCompatibleAv1Description(value: ArrayBuffer): boolean {
  if (value.byteLength === 0) return false
  const first = new Uint8Array(value)[0] ?? 0
  const av1CMarker = (first & 0x80) !== 0
  const obuType = (first >> 3) & 0x0f
  return av1CMarker || obuType === 1
}

function colorSpace(track: TrackInfo): Pick<VideoDecoderConfig, 'colorSpace'> {
  const color = track.color
  if (!color) return {}
  const primaries = color.primaries === 'bt709' ? 'bt709' : undefined
  const transfer = color.transfer === 'bt1886' ? 'bt709' : undefined
  const matrix = color.matrix === 'bt709' ? 'bt709' : undefined
  if (primaries === undefined && transfer === undefined && matrix === undefined && color.fullRange === undefined) return {}
  return { colorSpace: {
    ...(primaries !== undefined ? { primaries } : {}),
    ...(transfer !== undefined ? { transfer } : {}),
    ...(matrix !== undefined ? { matrix } : {}),
    ...(color.fullRange !== undefined ? { fullRange: color.fullRange } : {}),
  } }
}

function invalidConfig(message: string) {
  return createWebCodecsError(ErrorCodes.WEBCODECS_CONFIG_INVALID, message, false)
}
