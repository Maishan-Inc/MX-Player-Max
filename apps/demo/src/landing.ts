export interface CopyItem {
  readonly title: string
  readonly text: string
}

export interface StepItem extends CopyItem {
  readonly step: string
}

export interface QaItem {
  readonly q: string
  readonly a: string
}

/** Why a picked source was refused. The presentation layer maps this onto localized copy. */
export type SourceRejection = 'no-file' | 'not-media' | 'empty-url' | 'bad-url' | 'bad-protocol'

export type SourceOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: SourceRejection }

const MEDIA_EXTENSIONS = ['.mkv', '.webm', '.mp4', '.mov', '.m4v', '.ogg', '.oga', '.opus', '.mp3', '.flac', '.wav'] as const

/**
 * Accepts a picked or dropped file when the browser reports a media MIME type or the name
 * carries a container extension the engine can demux. Firefox reports an empty `type` for
 * `.mkv`, so the extension check is not redundant.
 */
export function acceptMediaFile(file: File | undefined): SourceOutcome<File> {
  if (!file) return { ok: false, reason: 'no-file' }
  const name = file.name.toLowerCase()
  const byExtension = MEDIA_EXTENSIONS.some((extension) => name.endsWith(extension))
  const byType = file.type.startsWith('video/') || file.type.startsWith('audio/')
  if (!byExtension && !byType) return { ok: false, reason: 'not-media' }
  return { ok: true, value: file }
}

/** Resolves a typed source against the page URL and keeps playback on HTTP(S) only. */
export function normalizeMediaUrl(value: string, pageUrl: string): SourceOutcome<string> {
  const trimmed = value.trim()
  if (!trimmed) return { ok: false, reason: 'empty-url' }
  let parsed: URL
  try {
    parsed = new URL(trimmed, pageUrl)
  } catch {
    return { ok: false, reason: 'bad-url' }
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, reason: 'bad-protocol' }
  }
  return { ok: true, value: parsed.href }
}

/** Returns `null` for an unusable byte count so the caller can supply localized copy. */
export function formatBytes(bytes: number): string | null {
  if (!Number.isFinite(bytes) || bytes < 0) return null
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}
