import type {
  AudioClockSnapshot,
  CustomAudioStats,
  CustomRendererKind,
  CustomVideoStats,
  MediaDescriptor,
  NativePlaybackStats,
  PlaybackDecisionTrace,
  PlaybackSelection,
  PlaybackSnapshot,
  PlaybackState,
  RendererStats,
  TrackInfo,
} from '@mx-player-max/types'
import type { PlayerUiLabels, PlayerUiLocale } from './contracts'

/** Buffer target the health meter is scaled against, in seconds. */
export const BUFFER_TARGET_SECONDS = 30
/** Connection speed the meter treats as full scale, in Kbps. */
export const CONNECTION_FULL_SCALE_KBPS = 40_000
/** Samples retained by the network activity graph. */
export const NETWORK_SAMPLE_COUNT = 40

const STATE_CODES: readonly PlaybackState[] = ['idle', 'loading', 'ready', 'playing', 'paused', 'seeking', 'ended', 'error', 'closed']

const INTL_TAGS: Readonly<Record<PlayerUiLocale, string>> = { en: 'en-US', 'zh-CN': 'zh-CN', 'zh-TW': 'zh-TW', ja: 'ja-JP' }

export interface StatsViewport {
  readonly width: number
  readonly height: number
  readonly devicePixelRatio: number
}

export interface StatsInput {
  readonly labels: PlayerUiLabels
  readonly locale: PlayerUiLocale
  readonly snapshot: PlaybackSnapshot
  readonly media: MediaDescriptor | null
  readonly selection: PlaybackSelection | null
  /** Per-candidate attempt codes; the only place the real reason for a failed load lives. */
  readonly decisionTrace: PlaybackDecisionTrace | null
  readonly nativeStats: NativePlaybackStats | null
  readonly customVideoStats: CustomVideoStats | null
  readonly customAudioStats: CustomAudioStats | null
  readonly audioClock: AudioClockSnapshot | null
  readonly rendererKind: CustomRendererKind | null
  readonly rendererStats: RendererStats | null
  readonly viewport: StatsViewport
  readonly videoId: string
  readonly cpn: string
  readonly connectionKbps: number | null
  /** Newest-last byte counts, one entry per sampling window. */
  readonly networkSamples: readonly number[]
  readonly networkBytes: number
  readonly now: number
}

export type StatsRowKind = 'text' | 'meter' | 'graph'

export interface StatsRow {
  readonly key: string
  readonly label: string
  readonly value: string
  readonly kind: StatsRowKind
  /** Meter fill in the 0-1 range. */
  readonly ratio?: number
  /** Graph bars in the 0-1 range, newest last. */
  readonly samples?: readonly number[]
  readonly tone?: 'normal' | 'warn'
}

export interface FrameCounters {
  readonly total: number
  readonly dropped: number
}

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

export function videoTrack(media: MediaDescriptor | null): TrackInfo | null {
  return media?.tracks.find((track) => track.kind === 'video') ?? null
}

export function audioTrack(media: MediaDescriptor | null): TrackInfo | null {
  return media?.tracks.find((track) => track.kind === 'audio') ?? null
}

/**
 * Frame accounting differs per pipeline: the native path exposes the element playback quality,
 * the custom path exposes decoder and renderer counters. Returns `null` when neither is active.
 */
export function frameCounters(input: Pick<StatsInput, 'nativeStats' | 'customVideoStats' | 'rendererStats'>): FrameCounters | null {
  const custom = input.customVideoStats
  if (custom) {
    const dropped = custom.droppedFrames + custom.droppedStaleFrames + (input.rendererStats?.droppedFrames ?? 0)
    return { total: Math.max(custom.decodedFrames, dropped), dropped }
  }
  const native = input.nativeStats
  if (native) {
    const dropped = native.droppedFrames ?? 0
    return { total: native.presentedFrames + dropped, dropped }
  }
  return null
}

function microsToSeconds(value: number | null | undefined): number | null {
  return value === null || value === undefined || !Number.isFinite(value) ? null : value / 1_000_000
}

function frameRateSuffix(track: TrackInfo | null): string {
  const rate = track?.frameRate
  return rate !== undefined && Number.isFinite(rate) && rate > 0 ? `@${Math.round(rate)}` : ''
}

export function formatResolution(track: TrackInfo | null, unknown: string): string {
  if (!track || track.width === undefined || track.height === undefined) return unknown
  return `${track.width}x${track.height}${frameRateSuffix(track)}`
}

/** The device-pixel box the surface currently occupies, which is the resolution worth fetching. */
export function formatOptimalResolution(viewport: StatsViewport, track: TrackInfo | null, unknown: string): string {
  const ratio = Number.isFinite(viewport.devicePixelRatio) && viewport.devicePixelRatio > 0 ? viewport.devicePixelRatio : 1
  const width = Math.round(viewport.width * ratio)
  const height = Math.round(viewport.height * ratio)
  if (width <= 0 || height <= 0) return unknown
  return `${width}x${height}${frameRateSuffix(track)}`
}

export function formatCodecs(media: MediaDescriptor | null, unknown: string): string {
  const video = videoTrack(media)
  const audio = audioTrack(media)
  if (!video && !audio) return unknown
  const describe = (track: TrackInfo | null): string => track === null ? unknown : `${track.codec ?? track.codecId} (${track.id})`
  return `${describe(video)} / ${describe(audio)}`
}

export function formatColor(track: TrackInfo | null, unknown: string): string {
  const color = track?.color
  if (!color) return unknown
  const primaries = color.primaries ?? 'unknown'
  const transfer = color.transfer ?? 'unknown'
  const depth = color.bitDepth === undefined ? '' : ` ${color.bitDepth}-bit`
  const hdr = color.hdrFormat === undefined || color.hdrFormat === 'none' ? '' : ` ${color.hdrFormat}`
  return `${primaries} / ${transfer}${depth}${hdr}`
}

export function formatVolume(snapshot: PlaybackSnapshot, audio: TrackInfo | null, custom: CustomAudioStats | null): string {
  const requested = Math.round(clamp01(snapshot.volume) * 100)
  const effective = snapshot.muted ? 0 : requested
  const rate = custom?.outputSampleRate ?? audio?.sampleRate ?? null
  const channels = custom?.channels ?? audio?.channels ?? null
  const parts: string[] = []
  if (rate !== null && Number.isFinite(rate) && rate > 0) parts.push(`${(rate / 1000).toFixed(1)} kHz`)
  if (channels !== null && Number.isFinite(channels) && channels > 0) parts.push(`${channels}ch`)
  if (custom) parts.push(custom.transport)
  return parts.length === 0 ? `${requested}% / ${effective}%` : `${requested}% / ${effective}% (${parts.join(' ')})`
}

export function formatFrames(counters: FrameCounters | null, labels: PlayerUiLabels): string {
  if (!counters) return labels.statsUnknown
  return labels.statsFrames
    .replace('{dropped}', String(counters.dropped))
    .replace('{total}', String(counters.total))
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 KB'
  if (bytes < 1_048_576) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1_048_576).toFixed(2)} MB`
}

/**
 * A single dense debug token, the analogue of the opaque line other players print. Every field
 * comes from the public SDK snapshot so the string can be pasted into an issue as-is.
 */
export function mysteryText(input: StatsInput): string {
  const { snapshot } = input
  const stateCode = Math.max(0, STATE_CODES.indexOf(snapshot.state))
  const time = microsToSeconds(snapshot.currentTime) ?? 0
  const range = snapshot.buffered[snapshot.buffered.length - 1]
  const start = microsToSeconds(range?.start ?? 0) ?? 0
  const end = microsToSeconds(range?.end ?? 0) ?? 0
  const backend = input.selection?.backend.kind ?? 'none'
  const renderer = input.rendererKind ?? input.selection?.backend.renderer ?? 'native'
  const queue = input.customVideoStats?.decodeQueueSize ?? 0
  const clock = input.audioClock?.source === 'audio-context' ? 'ac' : 'wc'
  const flag = snapshot.paused ? 'P' : snapshot.buffering ? 'B' : snapshot.seeking ? 'S' : '>'
  return `${backend} s:${stateCode} t:${time.toFixed(2)} b:${start.toFixed(3)}-${end.toFixed(3)} ${flag} r:${renderer} c:${clock} q:${queue} e:${snapshot.sessionEpoch} pbr:${snapshot.playbackRate}`
}

export function formatStatsDate(now: number, locale: PlayerUiLocale): string {
  const date = new Date(now)
  try {
    return new Intl.DateTimeFormat(INTL_TAGS[locale], { dateStyle: 'full', timeStyle: 'long' }).format(date)
  } catch {
    return date.toISOString()
  }
}

/** Scales raw byte samples into 0-1 graph bars against the largest sample in the window. */
export function normalizeSamples(samples: readonly number[]): readonly number[] {
  const peak = samples.reduce((largest, value) => Number.isFinite(value) && value > largest ? value : largest, 0)
  if (peak <= 0) return samples.map(() => 0)
  return samples.map((value) => clamp01((Number.isFinite(value) ? value : 0) / peak))
}

/** The eleven rows the statistics overlay renders, in display order. */
export function buildStatsRows(input: StatsInput): readonly StatsRow[] {
  const { labels, snapshot, viewport } = input
  const video = videoTrack(input.media)
  const unknown = labels.statsUnknown
  const bufferSeconds = (microsToSeconds(snapshot.bufferedAhead) ?? 0)
  const kbps = input.connectionKbps
  return [
    { key: 'videoId', kind: 'text', label: labels.statsVideoId, value: `${input.videoId} / ${input.cpn}` },
    {
      key: 'viewport',
      kind: 'text',
      label: labels.statsViewport,
      value: `${Math.round(viewport.width)}x${Math.round(viewport.height)} / ${formatFrames(frameCounters(input), labels)}`,
    },
    {
      key: 'resolution',
      kind: 'text',
      label: labels.statsResolution,
      value: `${formatResolution(video, unknown)} / ${formatOptimalResolution(viewport, video, unknown)}`,
    },
    { key: 'volume', kind: 'text', label: labels.statsVolume, value: formatVolume(snapshot, audioTrack(input.media), input.customAudioStats) },
    { key: 'codecs', kind: 'text', label: labels.statsCodecs, value: formatCodecs(input.media, unknown) },
    { key: 'color', kind: 'text', label: labels.statsColor, value: formatColor(video, unknown) },
    {
      key: 'connection',
      kind: 'meter',
      label: labels.statsConnection,
      value: kbps === null ? unknown : `${Math.round(kbps)} Kbps`,
      ratio: kbps === null ? 0 : clamp01(kbps / CONNECTION_FULL_SCALE_KBPS),
    },
    {
      key: 'network',
      kind: 'graph',
      label: labels.statsNetwork,
      value: formatBytes(input.networkBytes),
      samples: normalizeSamples(input.networkSamples),
    },
    {
      key: 'buffer',
      kind: 'meter',
      label: labels.statsBufferHealth,
      value: `${bufferSeconds.toFixed(2)} s`,
      ratio: clamp01(bufferSeconds / BUFFER_TARGET_SECONDS),
      tone: bufferSeconds < 2 && snapshot.state === 'playing' ? 'warn' : 'normal',
    },
    { key: 'mystery', kind: 'text', label: labels.statsMystery, value: mysteryText(input) },
    { key: 'date', kind: 'text', label: labels.statsDate, value: formatStatsDate(input.now, input.locale) },
  ]
}
