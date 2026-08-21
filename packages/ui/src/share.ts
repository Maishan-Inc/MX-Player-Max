import type { PlayerUiShareOptions } from './contracts'
import { frameCounters, mysteryText, type StatsInput } from './stats'

const DEFAULT_EMBED_WIDTH = 560
const DEFAULT_EMBED_HEIGHT = 315
const DEFAULT_TIME_PARAM = 't'
const ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function resolveVideoUrl(share: PlayerUiShareOptions | undefined, pageUrl: string): string {
  const configured = share?.videoUrl ?? share?.pageUrl
  return typeof configured === 'string' && configured.length > 0 ? configured : pageUrl
}

/**
 * Appends the whole-second offset as a query parameter. An unparsable address is returned
 * untouched rather than mangled, so a copy always yields something the user can paste.
 */
export function resolveVideoUrlAtTime(share: PlayerUiShareOptions | undefined, pageUrl: string, currentTime: number | null): string {
  const base = resolveVideoUrl(share, pageUrl)
  const seconds = currentTime === null || !Number.isFinite(currentTime) || currentTime < 0 ? 0 : Math.floor(currentTime / 1_000_000)
  const parameter = share?.timeParam ?? DEFAULT_TIME_PARAM
  try {
    const url = new URL(base)
    url.searchParams.set(parameter, String(seconds))
    return url.href
  } catch {
    return base
  }
}

export function buildEmbedCode(share: PlayerUiShareOptions | undefined, pageUrl: string): string {
  const source = share?.embedUrl ?? share?.pageUrl ?? pageUrl
  const width = share?.embedWidth ?? DEFAULT_EMBED_WIDTH
  const height = share?.embedHeight ?? DEFAULT_EMBED_HEIGHT
  const title = share?.title ?? 'MX Player Max'
  return `<iframe width="${width}" height="${height}" src="${escapeAttribute(source)}" title="${escapeAttribute(title)}" frameborder="0" allow="autoplay; encrypted-media; fullscreen; picture-in-picture" allowfullscreen></iframe>`
}

/** 11 URL-safe characters derived from the media identity, stable across sessions. */
export function shortMediaId(seed: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  let value = hash
  let id = ''
  for (let index = 0; index < 11; index += 1) {
    id += ID_ALPHABET[value % ID_ALPHABET.length] ?? 'A'
    value = (Math.imul(value, 0x01000193) ^ (index + 1)) >>> 0
  }
  return id
}

/** Client playback nonce: 16 URL-safe characters generated once per playback session. */
export function createCpn(random: () => number): string {
  let cpn = ''
  for (let index = 0; index < 16; index += 1) {
    const pick = Math.floor(Math.abs(random()) * ID_ALPHABET.length) % ID_ALPHABET.length
    cpn += ID_ALPHABET[pick] ?? 'A'
  }
  return cpn
}

export function buildDebugInfo(input: StatsInput, userAgent: string, pageUrl: string): string {
  const { snapshot } = input
  const counters = frameCounters(input)
  return JSON.stringify({
    ns: 'mx-player-max',
    date: new Date(input.now).toISOString(),
    page: pageUrl,
    userAgent,
    videoId: input.videoId,
    cpn: input.cpn,
    debug: mysteryText(input),
    playback: {
      state: snapshot.state,
      paused: snapshot.paused,
      currentTime: snapshot.currentTime,
      duration: snapshot.duration,
      bufferedAhead: snapshot.bufferedAhead,
      buffered: snapshot.buffered,
      volume: snapshot.volume,
      muted: snapshot.muted,
      playbackRate: snapshot.playbackRate,
      presentationMode: snapshot.presentationMode,
      sessionEpoch: snapshot.sessionEpoch,
      capabilities: snapshot.capabilities,
      lastError: snapshot.lastError,
    },
    media: input.media === null ? null : {
      container: input.media.container,
      mimeType: input.media.mimeType,
      duration: input.media.duration,
      size: input.media.size,
      tracks: input.media.tracks.map((track) => ({
        id: track.id, kind: track.kind, codec: track.codec ?? track.codecId,
        width: track.width, height: track.height, frameRate: track.frameRate,
        sampleRate: track.sampleRate, channels: track.channels, color: track.color,
      })),
    },
    selection: input.selection === null ? null : { backend: input.selection.backend, intent: input.selection.intent },
    renderer: { kind: input.rendererKind, stats: input.rendererStats },
    frames: counters,
    customVideo: input.customVideoStats,
    customAudio: input.customAudioStats,
    audioClock: input.audioClock,
    viewport: input.viewport,
    connectionKbps: input.connectionKbps,
  }, null, 2)
}
