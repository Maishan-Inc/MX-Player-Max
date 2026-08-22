import type { MediaDescriptor, TrackInfo } from '@mx-player-max/types'

/**
 * Human names for the codec identifiers the SDK reports. Both shapes are covered: the RFC 6381
 * strings the native probe produces (`av01.0.05M.08`) and the Matroska ids the demuxer produces
 * (`V_AV1`), so the readout says the same thing on either playback path.
 */
const CODEC_NAMES: readonly (readonly [RegExp, string])[] = [
  [/^(?:av01|v_av1)/i, 'AV1'],
  [/^(?:avc[13]|h264|v_mpeg4\/iso\/avc)/i, 'H.264/AVC'],
  [/^(?:hvc1|hev1|v_mpegh\/iso\/hevc)/i, 'H.265/HEVC'],
  [/^(?:vvc1|vvi1|v_mpegi\/iso\/vvc)/i, 'H.266/VVC'],
  [/^(?:vp09|vp9|v_vp9)/i, 'VP9'],
  [/^(?:vp08|vp8|v_vp8)/i, 'VP8'],
  [/^(?:mp4a\.40|a_aac)/i, 'AAC'],
  [/^(?:mp4a\.(?:69|6b)|mp3|a_mpeg\/l3)/i, 'MP3'],
  [/^(?:opus|a_opus)/i, 'Opus'],
  [/^(?:vorbis|a_vorbis)/i, 'Vorbis'],
  [/^(?:flac|a_flac)/i, 'FLAC'],
  [/^(?:alac|a_alac)/i, 'ALAC'],
  [/^(?:ec-3|a_e-?ac-?3)/i, 'E-AC-3'],
  [/^(?:ac-3|a_ac-?3)/i, 'AC-3'],
  [/^(?:a_truehd)/i, 'TrueHD'],
  [/^(?:a_pcm)/i, 'PCM'],
]

export interface MediaSummaryInput {
  readonly media: MediaDescriptor | null
  /** Selected backend kind, for example `html-video` or `webcodecs`. */
  readonly backend: string | null
  /** Shown on its own while the engine has not identified any track yet. */
  readonly pendingLabel: string
}

/** Human name for one track, falling back to whatever identifier the engine supplied. */
export function codecName(track: TrackInfo): string {
  for (const [pattern, name] of CODEC_NAMES) {
    if (pattern.test(track.codec ?? '') || pattern.test(track.codecId)) return name
  }
  const fallback = track.codec ?? track.codecId
  return fallback.replace(/^[VAS]_/, '').replace(/\/ISO\//g, '/').replace(/_/g, ' ')
}

/**
 * Concrete file parameters rather than the playback intent: resolution, frame rate, video and
 * audio codecs, channel count, sample rate, container and the backend that was selected. Every
 * value comes from the public `MediaDescriptor`; nothing is derived from engine internals.
 */
export function mediaSummaryParts(input: MediaSummaryInput): readonly string[] {
  const media = input.media
  const tracks = media?.tracks ?? []
  const video = tracks.find((track) => track.kind === 'video')
  const audio = tracks.find((track) => track.kind === 'audio')
  const subtitles = tracks.filter((track) => track.kind === 'subtitle').length
  const parts: string[] = []
  if (video) {
    const geometry: string[] = []
    if (isPositive(video.width) && isPositive(video.height)) geometry.push(`${video.width}×${video.height}`)
    if (isPositive(video.frameRate)) geometry.push(`${round(video.frameRate, 3)} fps`)
    const depth = video.color?.bitDepth ?? video.bitDepth
    if (isPositive(depth)) geometry.push(`${depth}-bit`)
    const hdr = video.color?.hdrFormat
    if (hdr !== undefined && hdr !== 'none') geometry.push(hdr.toUpperCase())
    parts.push([codecName(video), ...geometry].join(' · '))
  }
  if (audio) {
    const audioParts = [codecName(audio)]
    if (isPositive(audio.channels)) audioParts.push(`${audio.channels}ch`)
    if (isPositive(audio.sampleRate)) audioParts.push(`${round(audio.sampleRate / 1000, 1)} kHz`)
    parts.push(audioParts.join(' · '))
  }
  if (subtitles > 0) parts.push(`${subtitles} sub`)
  const container = media?.container
  const tail: string[] = []
  if (typeof container === 'string' && container.length > 0) tail.push(container.toUpperCase())
  if (typeof input.backend === 'string' && input.backend.length > 0) tail.push(input.backend)
  if (tail.length > 0) parts.push(tail.join(' · '))
  return parts.length > 0 ? parts : [input.pendingLabel]
}

export function mediaSummaryText(input: MediaSummaryInput): string {
  return mediaSummaryParts(input).join('  ·  ')
}

function isPositive(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}
