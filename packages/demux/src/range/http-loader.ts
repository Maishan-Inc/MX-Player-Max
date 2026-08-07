import { ErrorCodes, type ByteRange, type RangeCache, type RangeCacheKey, type RangeLoaderOptions, type RangeReadResult, type RetryPolicy } from '@mx-player-max/types'
import { cloneRangeReadResult } from './cache'
import { DemuxError, createRangeAbortError, isDemuxError } from './errors'
import { RangeScheduler } from './scheduler'
import {
  DEFAULT_MAX_CONCURRENT_READS,
  DEFAULT_RETRY_POLICY,
  type HttpRangeLoaderOptions,
  type RangeFetch,
  type RangeLoader,
} from './types'
import {
  createHttpHeaders,
  isAbortLike,
  parseContentLength,
  parseContentRange,
  parseHttpUrl,
  validateByteRange,
  validateConcurrency,
  validateRetryPolicy,
} from './validation'

let nextHttpLoaderId = 1

function defaultFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return globalThis.fetch(input, init)
}

function isCrossOrigin(url: URL): boolean {
  try {
    return typeof location !== 'undefined' && location.origin !== url.origin
  } catch {
    return false
  }
}

function isOffline(): boolean {
  try {
    return typeof navigator !== 'undefined' && navigator.onLine === false
  } catch {
    return false
  }
}

function fetchFailure(url: URL, cause: unknown): DemuxError {
  if (isOffline() || !isCrossOrigin(url)) {
    return new DemuxError(ErrorCodes.RANGE_NETWORK_FAILED, 'Remote range request failed', {
      recoverable: true,
      context: { origin: url.origin, path: url.pathname.split('/').at(-1) ?? '' },
      cause,
    })
  }
  return new DemuxError(ErrorCodes.RANGE_CORS_FAILED, 'Cross-origin range request was blocked', {
    context: { origin: url.origin, path: url.pathname.split('/').at(-1) ?? '' },
    cause,
  })
}

function isRetryable(error: DemuxError): boolean {
  if (error.code === ErrorCodes.RANGE_NETWORK_FAILED) return true
  const status = error.context['status']
  return error.code === ErrorCodes.RANGE_HTTP_STATUS && typeof status === 'number' && status >= 500 && status <= 599
}

function retryDelay(policy: RetryPolicy, retryIndex: number): number {
  return Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** Math.max(0, retryIndex - 1))
}

function waitForRetry(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(createRangeAbortError(false, signal.reason))
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, delayMs)
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(createRangeAbortError(false, signal.reason))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

export class HttpRangeLoader implements RangeLoader {
  readonly #url: URL
  readonly #headers: Readonly<Record<string, string>> | undefined
  readonly #credentials: RequestCredentials
  readonly #fetch: RangeFetch
  readonly #scheduler: RangeScheduler
  readonly #defaultOptions: RangeLoaderOptions
  readonly #stableSourceKey: string
  readonly #instanceSourceKey: string
  #etag: string | null = null
  #sourceLength: number | null = null
  #sourceLengthKnown = false
  #closed = false

  constructor(url: string | URL, options: HttpRangeLoaderOptions = {}) {
    this.#url = parseHttpUrl(url)
    this.#headers = options.headers
    this.#credentials = options.credentials ?? 'omit'
    this.#fetch = options.fetch ?? defaultFetch
    this.#scheduler = new RangeScheduler(validateConcurrency(options.maxConcurrentReads ?? DEFAULT_MAX_CONCURRENT_READS))
    const retry = validateRetryPolicy(options.retry ?? DEFAULT_RETRY_POLICY)
    this.#defaultOptions = {
      retry,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      ...(options.cache === undefined ? {} : { cache: options.cache }),
    }
    const loaderId = nextHttpLoaderId
    const basename = this.#url.pathname.split('/').at(-1) ?? ''
    this.#stableSourceKey = `http:${loaderId}:${this.#url.origin}:${basename}`
    this.#instanceSourceKey = `${this.#stableSourceKey}:unvalidated`
    nextHttpLoaderId += 1
    options.signal?.addEventListener('abort', () => this.close(), { once: true })
  }

  read(range: ByteRange, options: RangeLoaderOptions = {}): Promise<RangeReadResult> {
    if (this.#closed) return Promise.reject(createRangeAbortError(true))
    const validRange = validateByteRange(range, this.#sourceLengthKnown && this.#sourceLength !== null ? this.#sourceLength : undefined)
    const cache = options.cache ?? this.#defaultOptions.cache
    const retry = validateRetryPolicy(options.retry ?? this.#defaultOptions.retry ?? DEFAULT_RETRY_POLICY)
    const cacheKey = this.#cacheKey(validRange)
    const cached = cache?.get(cacheKey)
    if (cached !== undefined && cached !== null) return Promise.resolve(cloneRangeReadResult(cached))
    const signal = options.signal ?? this.#defaultOptions.signal

    return this.#scheduler.schedule(
      (taskSignal) => this.#readWithRetry(validRange, retry, cache, taskSignal),
      signal,
    )
  }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    this.#scheduler.close()
    const cache = this.#defaultOptions.cache
    cache?.deleteSource(this.#stableSourceKey)
    cache?.deleteSource(this.#instanceSourceKey)
  }

  async #readWithRetry(
    range: ByteRange,
    retry: RetryPolicy,
    cache: RangeCache | undefined,
    signal: AbortSignal,
  ): Promise<RangeReadResult> {
    let retryCount = 0
    while (true) {
      if (signal.aborted) throw createRangeAbortError(false, signal.reason)
      try {
        const result = await this.#readOnce(range, signal)
        cache?.set(this.#cacheKey(range), result)
        return cloneRangeReadResult(result)
      } catch (cause) {
        if (signal.aborted || isAbortLike(cause)) throw createRangeAbortError(false, cause)
        const error = isDemuxError(cause) ? cause : fetchFailure(this.#url, cause)
        if (!isRetryable(error)) throw error
        if (retryCount >= retry.maxRetries) {
          if (retry.maxRetries === 0) throw error
          throw new DemuxError(ErrorCodes.RANGE_RETRY_EXHAUSTED, 'Remote range retries were exhausted', {
            context: { retries: retryCount },
            cause: error,
          })
        }
        retryCount += 1
        await waitForRetry(retryDelay(retry, retryCount), signal)
      }
    }
  }

  async #readOnce(range: ByteRange, signal: AbortSignal): Promise<RangeReadResult> {
    const requestHeaders = createHttpHeaders(this.#headers, range, this.#etag)
    let response: Response
    try {
      response = await this.#fetch(this.#url, {
        method: 'GET',
        headers: requestHeaders,
        credentials: this.#credentials,
        redirect: 'manual',
        signal,
      })
    } catch (cause) {
      if (signal.aborted || isAbortLike(cause)) throw createRangeAbortError(false, cause)
      throw fetchFailure(this.#url, cause)
    }

    if (response.type === 'opaqueredirect' || response.redirected) {
      throw new DemuxError(ErrorCodes.RANGE_REDIRECTED, 'Remote range request was redirected', {
        context: { origin: this.#url.origin },
      })
    }
    if (response.status >= 500 && response.status <= 599) {
      void response.body?.cancel().catch(() => undefined)
      throw new DemuxError(ErrorCodes.RANGE_HTTP_STATUS, 'Remote server returned a transient error', {
        recoverable: true,
        context: { status: response.status },
      })
    }
    if (response.status === 200) {
      void response.body?.cancel().catch(() => undefined)
      const sourceChanged = this.#etag !== null || this.#sourceLengthKnown
      throw new DemuxError(
        sourceChanged ? ErrorCodes.RANGE_SOURCE_CHANGED : ErrorCodes.RANGE_UNSUPPORTED,
        sourceChanged ? 'Remote source changed during range reads' : 'Remote server did not honor the Range request',
        { context: { status: response.status } },
      )
    }
    if (response.status !== 206) {
      void response.body?.cancel().catch(() => undefined)
      throw new DemuxError(ErrorCodes.RANGE_HTTP_STATUS, 'Remote server returned an unsupported status', {
        context: { status: response.status },
      })
    }

    const rawContentRange = response.headers.get('Content-Range')
    const contentRange = parseContentRange(rawContentRange)
    if (contentRange.start !== range.start || contentRange.endInclusive !== range.endExclusive - 1) {
      throw new DemuxError(ErrorCodes.RANGE_CONTENT_RANGE_INVALID, 'Content-Range does not match the requested range', {
        context: {
          requestedStart: range.start,
          requestedEndExclusive: range.endExclusive,
          responseStart: contentRange.start,
          responseEndInclusive: contentRange.endInclusive,
        },
      })
    }
    const expectedLength = range.endExclusive - range.start
    const contentLength = parseContentLength(response.headers.get('Content-Length'))
    if (contentLength !== null && contentLength !== expectedLength) {
      throw new DemuxError(ErrorCodes.RANGE_RESPONSE_LENGTH_MISMATCH, 'Content-Length does not match the requested range', {
        context: { expectedLength, contentLength },
      })
    }

    const etag = response.headers.get('ETag')
    if (etag !== null && etag.length > 1_024) {
      throw new DemuxError(ErrorCodes.RANGE_HEADER_INVALID, 'ETag exceeds the allowed length')
    }
    if (this.#etag !== null && etag !== this.#etag) {
      this.#invalidateSourceCache()
      throw new DemuxError(ErrorCodes.RANGE_SOURCE_CHANGED, 'Remote ETag changed during range reads')
    }
    if (this.#sourceLengthKnown && contentRange.total !== this.#sourceLength) {
      this.#invalidateSourceCache()
      throw new DemuxError(ErrorCodes.RANGE_SOURCE_CHANGED, 'Remote source length changed during range reads')
    }

    let buffer: ArrayBuffer
    try {
      buffer = await response.arrayBuffer()
    } catch (cause) {
      if (signal.aborted || isAbortLike(cause)) throw createRangeAbortError(false, cause)
      throw fetchFailure(this.#url, cause)
    }
    if (buffer.byteLength !== expectedLength) {
      throw new DemuxError(ErrorCodes.RANGE_RESPONSE_LENGTH_MISMATCH, 'Response body length does not match the requested range', {
        context: { expectedLength, actualLength: buffer.byteLength },
      })
    }

    if (this.#etag === null && etag !== null) this.#etag = etag
    if (!this.#sourceLengthKnown) {
      this.#sourceLength = contentRange.total
      this.#sourceLengthKnown = true
    }
    return {
      data: new Uint8Array(buffer),
      sourceLength: contentRange.total,
      contentRange: rawContentRange,
      etag,
    }
  }

  #cacheKey(range: ByteRange): RangeCacheKey {
    return {
      sourceKey: this.#etag === null ? this.#instanceSourceKey : this.#stableSourceKey,
      range,
      etag: this.#etag,
    }
  }

  #invalidateSourceCache(): void {
    const cache = this.#defaultOptions.cache
    cache?.deleteSource(this.#stableSourceKey)
    cache?.deleteSource(this.#instanceSourceKey)
  }
}
