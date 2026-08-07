import { ErrorCodes, type ByteRange, type RetryPolicy } from '@mx-player-max/types'
import { DemuxError } from './errors'

const CONTROLLED_HEADERS = new Set([
  'connection',
  'content-length',
  'cookie',
  'host',
  'if-range',
  'proxy-authorization',
  'range',
  'referer',
  'transfer-encoding',
])

export interface ParsedContentRange {
  start: number
  endInclusive: number
  total: number | null
}

export function validateByteRange(range: ByteRange, sourceLength?: number): ByteRange {
  if (!Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.endExclusive)) {
    throw new DemuxError(ErrorCodes.RANGE_INVALID, 'Range offsets must be safe integers')
  }
  if (range.start < 0 || range.endExclusive < 0 || range.start >= range.endExclusive) {
    throw new DemuxError(ErrorCodes.RANGE_INVALID, 'Range must be a non-empty non-negative half-open interval', {
      context: { start: range.start, endExclusive: range.endExclusive },
    })
  }
  if (sourceLength !== undefined) {
    if (!Number.isSafeInteger(sourceLength) || sourceLength < 0 || range.endExclusive > sourceLength) {
      throw new DemuxError(ErrorCodes.RANGE_INVALID, 'Range exceeds the source length', {
        context: { start: range.start, endExclusive: range.endExclusive, sourceLength },
      })
    }
  }
  return { start: range.start, endExclusive: range.endExclusive }
}

export function checkedAdd(left: number, right: number, code = ErrorCodes.CONTAINER_INVALID): number {
  if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right)) {
    throw new DemuxError(code, 'Offset operands must be safe integers')
  }
  const result = left + right
  if (!Number.isSafeInteger(result)) {
    throw new DemuxError(code, 'Offset arithmetic exceeded the safe integer range')
  }
  return result
}

export function validateRetryPolicy(policy: RetryPolicy): RetryPolicy {
  if (!Number.isSafeInteger(policy.maxRetries) || policy.maxRetries < 0) {
    throw new DemuxError(ErrorCodes.RANGE_INVALID, 'maxRetries must be a non-negative safe integer')
  }
  if (!Number.isFinite(policy.baseDelayMs) || policy.baseDelayMs < 0) {
    throw new DemuxError(ErrorCodes.RANGE_INVALID, 'baseDelayMs must be a finite non-negative number')
  }
  if (!Number.isFinite(policy.maxDelayMs) || policy.maxDelayMs < policy.baseDelayMs) {
    throw new DemuxError(ErrorCodes.RANGE_INVALID, 'maxDelayMs must be finite and at least baseDelayMs')
  }
  return { ...policy }
}

export function validateConcurrency(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new DemuxError(ErrorCodes.RANGE_INVALID, 'maxConcurrentReads must be a positive safe integer')
  }
  return value
}

export function createHttpHeaders(
  customHeaders: Readonly<Record<string, string>> | undefined,
  range: ByteRange,
  etag: string | null,
): Headers {
  const headers = new Headers()
  if (customHeaders !== undefined) {
    for (const [name, value] of Object.entries(customHeaders)) {
      if (CONTROLLED_HEADERS.has(name.toLowerCase())) {
        throw new DemuxError(ErrorCodes.RANGE_HEADER_INVALID, 'A caller header conflicts with Range Loader control', {
          context: { header: name.toLowerCase() },
        })
      }
      try {
        headers.append(name, value)
      } catch (cause) {
        throw new DemuxError(ErrorCodes.RANGE_HEADER_INVALID, 'A caller header is invalid', {
          context: { header: name.toLowerCase() },
          cause,
        })
      }
    }
  }
  headers.set('Range', `bytes=${range.start}-${range.endExclusive - 1}`)
  if (etag !== null) headers.set('If-Range', etag)
  return headers
}

export function parseContentRange(value: string | null): ParsedContentRange {
  if (value === null) {
    throw new DemuxError(ErrorCodes.RANGE_CONTENT_RANGE_INVALID, 'A 206 response must include Content-Range')
  }
  const match = /^bytes ([0-9]+)-([0-9]+)\/([0-9]+|\*)$/.exec(value)
  const startText = match?.[1]
  const endText = match?.[2]
  const totalText = match?.[3]
  if (startText === undefined || endText === undefined || totalText === undefined) {
    throw new DemuxError(ErrorCodes.RANGE_CONTENT_RANGE_INVALID, 'Content-Range has an invalid format')
  }
  const start = Number(startText)
  const endInclusive = Number(endText)
  const total = totalText === '*' ? null : Number(totalText)
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(endInclusive) || start < 0 || endInclusive < start) {
    throw new DemuxError(ErrorCodes.RANGE_CONTENT_RANGE_INVALID, 'Content-Range offsets are invalid')
  }
  if (total !== null && (!Number.isSafeInteger(total) || total <= endInclusive)) {
    throw new DemuxError(ErrorCodes.RANGE_CONTENT_RANGE_INVALID, 'Content-Range total is invalid')
  }
  return { start, endInclusive, total }
}

export function parseContentLength(value: string | null): number | null {
  if (value === null) return null
  if (!/^[0-9]+$/.test(value)) {
    throw new DemuxError(ErrorCodes.RANGE_RESPONSE_LENGTH_MISMATCH, 'Content-Length is not a non-negative integer')
  }
  const length = Number(value)
  if (!Number.isSafeInteger(length)) {
    throw new DemuxError(ErrorCodes.RANGE_RESPONSE_LENGTH_MISMATCH, 'Content-Length exceeds the safe integer range')
  }
  return length
}

export function parseHttpUrl(input: string | URL): URL {
  let url: URL
  try {
    url = new URL(input)
  } catch (cause) {
    throw new DemuxError(ErrorCodes.RANGE_INVALID, 'Remote source URL is invalid', { cause })
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new DemuxError(ErrorCodes.RANGE_UNSUPPORTED, 'Remote source URL must use HTTP or HTTPS', {
      context: { protocol: url.protocol },
    })
  }
  return url
}

export function isAbortLike(value: unknown): boolean {
  return value instanceof DOMException && value.name === 'AbortError'
}

