import type {
  ExternalSubtitleSourceDescriptor,
  SubtitleFormat,
  SubtitleParseResult,
  SubtitleParserLimitsInput,
  SubtitleSourceLimitsInput,
} from '@mx-player-max/types'
import { ErrorCodes } from '@mx-player-max/types'
import { parseAss } from './ass'
import { decodeUtf8 } from './parser-common'
import { parseSrt } from './srt'
import { resolveSubtitleSourceLimits, validateSubtitleFormat } from './limits'
import { SubtitleError } from './errors'

export interface SubtitleLoadOptions {
  trackId: string
  format?: SubtitleFormat
  parserLimits?: SubtitleParserLimitsInput
  sourceLimits?: SubtitleSourceLimitsInput
  signal?: AbortSignal
  fetchImpl?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  now?: () => number
}

export async function loadExternalSubtitle(source: ExternalSubtitleSourceDescriptor, options: SubtitleLoadOptions): Promise<SubtitleParseResult> {
  validateExternalSubtitleSource(source)
  const sourceLimits = resolveSubtitleSourceLimits(options.sourceLimits)
  const candidate = options.format ?? source.format ?? inferSubtitleFormat(source)
  if (candidate === null) throw new SubtitleError(ErrorCodes.SUBTITLE_FORMAT_UNSUPPORTED, 'Subtitle format could not be determined', false)
  const format = validateSubtitleFormat(candidate)
  const bytes = source.kind === 'file'
    ? await readFileBytes(source.file, sourceLimits, options.signal)
    : await readUrlBytes(source.url, sourceLimits, options)
  if (bytes.byteLength > sourceLimits.maxResponseBytes) throw new SubtitleError(ErrorCodes.SUBTITLE_SOURCE_TOO_LARGE, 'Subtitle response exceeds the configured byte budget', false)
  const text = decodeUtf8(bytes)
  if (format === 'srt') return parseSrt(text, { trackId: options.trackId, ...(options.parserLimits === undefined ? {} : { limits: options.parserLimits }), ...(options.now === undefined ? {} : { now: options.now }) })
  return parseAss(text, { trackId: options.trackId, ...(options.parserLimits === undefined ? {} : { limits: options.parserLimits }), ...(options.now === undefined ? {} : { now: options.now }) })
}

export function inferSubtitleFormat(source: ExternalSubtitleSourceDescriptor): SubtitleFormat | null {
  if (!source || (source.kind !== 'file' && source.kind !== 'url')) return null
  const name = source.kind === 'file' && source.file && typeof source.file.name === 'string'
    ? source.file.name
    : source.kind === 'url' && typeof source.url === 'string'
      ? safeUrlPath(source.url)
      : ''
  const extension = name.toLowerCase().match(/\.([a-z0-9]+)$/u)?.[1]
  if (extension === 'srt') return 'srt'
  if (extension === 'ass') return 'ass'
  if (extension === 'ssa') return 'ssa'
  return null
}

async function readFileBytes(file: File, limits: ReturnType<typeof resolveSubtitleSourceLimits>, signal: AbortSignal | undefined): Promise<Uint8Array> {
  if (!file || typeof file.arrayBuffer !== 'function') throw new SubtitleError(ErrorCodes.SUBTITLE_SOURCE_INVALID, 'Subtitle file is invalid', false)
  if (signal?.aborted) throw new SubtitleError(ErrorCodes.SUBTITLE_ABORTED, 'Subtitle loading was aborted', true)
  const size = Number(file.size)
  if (!Number.isSafeInteger(size) || size < 0 || size > limits.maxResponseBytes) throw new SubtitleError(ErrorCodes.SUBTITLE_SOURCE_TOO_LARGE, 'Subtitle file exceeds the configured byte budget', false)
  try {
    const data = new Uint8Array(await readWithDeadline(file.arrayBuffer(), signal, Date.now() + limits.operationTimeoutMs))
    if (signal?.aborted) throw new SubtitleError(ErrorCodes.SUBTITLE_ABORTED, 'Subtitle loading was aborted', true)
    return data
  } catch (cause) {
    if (cause instanceof SubtitleError) throw cause
    throw new SubtitleError(ErrorCodes.SUBTITLE_SOURCE_INVALID, 'Subtitle file could not be read', false)
  }
}

async function readUrlBytes(urlValue: string, limits: ReturnType<typeof resolveSubtitleSourceLimits>, options: SubtitleLoadOptions): Promise<Uint8Array> {
  if (options.signal?.aborted) throw new SubtitleError(ErrorCodes.SUBTITLE_ABORTED, 'Subtitle loading was aborted', true)
  let url: URL
  try { url = new URL(urlValue) } catch { throw new SubtitleError(ErrorCodes.SUBTITLE_SOURCE_INVALID, 'Subtitle URL is invalid', false) }
  if (url.protocol !== 'https:' || url.username || url.password) throw new SubtitleError(ErrorCodes.SUBTITLE_SOURCE_UNSUPPORTED, 'Remote subtitles require an HTTPS URL', false)
  const fetchImpl = options.fetchImpl ?? (typeof fetch === 'function' ? fetch.bind(globalThis) : null)
  if (fetchImpl === null) throw new SubtitleError(ErrorCodes.SUBTITLE_NETWORK_FAILED, 'Subtitle fetch is unavailable', true)
  const controller = typeof AbortController === 'undefined' ? null : new AbortController()
  const signal = controller?.signal
  const operationSignal = signal ?? options.signal
  let timedOut = false
  const abort = (): void => { try { controller?.abort() } catch { /* best effort */ } }
  if (options.signal?.aborted) abort()
  options.signal?.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(() => { timedOut = true; abort() }, limits.operationTimeoutMs)
  const deadline = Date.now() + limits.operationTimeoutMs
  try {
    let response: Response
    try {
      response = await readWithDeadline(fetchImpl(url, { method: 'GET', mode: 'cors', credentials: 'omit', redirect: 'error', ...(operationSignal === undefined ? {} : { signal: operationSignal }) }), operationSignal, deadline)
    } catch (cause) {
      if (options.signal?.aborted) throw new SubtitleError(ErrorCodes.SUBTITLE_ABORTED, 'Subtitle loading was aborted', true)
      if (timedOut) throw new SubtitleError(ErrorCodes.SUBTITLE_NETWORK_FAILED, 'Subtitle network request timed out', true)
      if (cause instanceof SubtitleError) throw cause
      throw new SubtitleError(isCrossOrigin(url) ? ErrorCodes.SUBTITLE_CORS_FAILED : ErrorCodes.SUBTITLE_NETWORK_FAILED, 'Subtitle network request failed', true)
    }
    if (response.type === 'opaque') throw new SubtitleError(ErrorCodes.SUBTITLE_CORS_FAILED, 'Subtitle response did not satisfy CORS', true)
    if (response.type === 'opaqueredirect' || response.redirected) throw new SubtitleError(ErrorCodes.SUBTITLE_SOURCE_UNSUPPORTED, 'Subtitle redirects are not allowed', false)
    if (!response.ok) throw new SubtitleError(ErrorCodes.SUBTITLE_NETWORK_FAILED, 'Subtitle server returned an unsuccessful response', true)
    const contentLength = response.headers.get('content-length')
    if (contentLength !== null) {
      const length = Number(contentLength)
      if (!Number.isSafeInteger(length) || length < 0 || length > limits.maxResponseBytes) throw new SubtitleError(ErrorCodes.SUBTITLE_SOURCE_TOO_LARGE, 'Subtitle response exceeds the configured byte budget', false)
    }
    try {
      return await readResponse(response, limits, operationSignal, deadline)
    } catch (cause) {
      if (options.signal?.aborted) throw new SubtitleError(ErrorCodes.SUBTITLE_ABORTED, 'Subtitle loading was aborted', true)
      if (timedOut) throw new SubtitleError(ErrorCodes.SUBTITLE_NETWORK_FAILED, 'Subtitle network request timed out', true)
      if (cause instanceof SubtitleError) throw cause
      throw new SubtitleError(ErrorCodes.SUBTITLE_NETWORK_FAILED, 'Subtitle response could not be read', true)
    }
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', abort)
  }
}

export function validateExternalSubtitleSource(source: ExternalSubtitleSourceDescriptor): void {
  if (!source || typeof source !== 'object') throw new SubtitleError(ErrorCodes.SUBTITLE_SOURCE_INVALID, 'Subtitle source is invalid', false)
  if (source.kind === 'file') {
    if (!source.file || typeof source.file !== 'object') throw new SubtitleError(ErrorCodes.SUBTITLE_SOURCE_INVALID, 'Subtitle file is invalid', false)
    return
  }
  if (source.kind !== 'url' || typeof source.url !== 'string' || source.url.length === 0 || source.url.length > 8_192) {
    throw new SubtitleError(ErrorCodes.SUBTITLE_SOURCE_INVALID, 'Subtitle URL is invalid', false)
  }
  let url: URL
  try { url = new URL(source.url) } catch { throw new SubtitleError(ErrorCodes.SUBTITLE_SOURCE_INVALID, 'Subtitle URL is invalid', false) }
  if (url.protocol !== 'https:' || url.username || url.password) throw new SubtitleError(ErrorCodes.SUBTITLE_SOURCE_UNSUPPORTED, 'Remote subtitles require an HTTPS URL', false)
}

async function readResponse(response: Response, limits: ReturnType<typeof resolveSubtitleSourceLimits>, signal: AbortSignal | undefined, deadline: number): Promise<Uint8Array> {
  if (response.body === null || typeof response.body.getReader !== 'function') {
    const data = new Uint8Array(await readWithDeadline(response.arrayBuffer(), signal, deadline))
    if (data.byteLength > limits.maxResponseBytes) throw new SubtitleError(ErrorCodes.SUBTITLE_SOURCE_TOO_LARGE, 'Subtitle response exceeds the configured byte budget', false)
    return data
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  let chunkCount = 0
  let completed = false
  try {
    while (true) {
      const result = await readWithDeadline(reader.read(), signal, deadline)
      if (result.done) { completed = true; break }
      chunkCount += 1
      if (chunkCount > limits.maxResponseChunks) throw new SubtitleError(ErrorCodes.SUBTITLE_SOURCE_TOO_LARGE, 'Subtitle response exceeds the configured chunk budget', false)
      const chunk = result.value
      if (!(chunk instanceof Uint8Array)) throw new SubtitleError(ErrorCodes.SUBTITLE_SOURCE_INVALID, 'Subtitle response bytes are invalid', false)
      total += chunk.byteLength
      if (!Number.isSafeInteger(total) || total > limits.maxResponseBytes) {
        throw new SubtitleError(ErrorCodes.SUBTITLE_SOURCE_TOO_LARGE, 'Subtitle response exceeds the configured byte budget', false)
      }
      if (chunk.byteLength > 0) chunks.push(chunk.slice())
    }
  } finally {
    if (!completed) {
      try { void reader.cancel().catch(() => {}) } catch { /* best effort */ }
    }
    try { reader.releaseLock() } catch { /* best effort */ }
  }
  const output = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength }
  return output
}

async function readWithDeadline<T>(operation: Promise<T>, signal: AbortSignal | undefined, deadline: number): Promise<T> {
  if (signal?.aborted) throw new SubtitleError(ErrorCodes.SUBTITLE_ABORTED, 'Subtitle loading was aborted', true)
  const remaining = deadline - Date.now()
  if (!Number.isFinite(remaining) || remaining <= 0) throw new SubtitleError(ErrorCodes.SUBTITLE_NETWORK_FAILED, 'Subtitle response read timed out', true)
  let timer: ReturnType<typeof setTimeout> | null = null
  let abort: (() => void) | null = null
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new SubtitleError(ErrorCodes.SUBTITLE_NETWORK_FAILED, 'Subtitle response read timed out', true)), remaining)
  })
  const aborted = signal === undefined ? null : new Promise<never>((_, reject) => {
    abort = (): void => reject(new SubtitleError(ErrorCodes.SUBTITLE_ABORTED, 'Subtitle loading was aborted', true))
    signal.addEventListener('abort', abort, { once: true })
  })
  try { return await Promise.race(aborted === null ? [operation, timeout] : [operation, timeout, aborted]) }
  finally {
    if (timer !== null) clearTimeout(timer)
    if (abort !== null) signal?.removeEventListener('abort', abort)
  }
}

function safeUrlPath(value: string): string {
  try { return new URL(value).pathname } catch { return '' }
}

function isCrossOrigin(url: URL): boolean {
  try { return typeof location !== 'undefined' && location.origin !== 'null' && url.origin !== location.origin }
  catch { return true }
}
