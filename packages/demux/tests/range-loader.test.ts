import { describe, expect, it, vi } from 'vitest'
import { ErrorCodes, type ByteRange } from '@mx-player-max/types'
import {
  DemuxError,
  FileRangeLoader,
  HttpRangeLoader,
  LruRangeCache,
  type RangeFetch,
} from '../src/index'

function exactResponse(
  bytes: readonly number[],
  range: ByteRange,
  total: number | '*',
  extraHeaders: Readonly<Record<string, string>> = {},
): Response {
  return new Response(Uint8Array.from(bytes), {
    status: 206,
    headers: {
      'Content-Range': `bytes ${range.start}-${range.endExclusive - 1}/${total}`,
      'Content-Length': String(bytes.length),
      ...extraHeaders,
    },
  })
}

function expectCode(error: unknown, code: string): void {
  expect(error).toBeInstanceOf(DemuxError)
  expect((error as DemuxError).code).toBe(code)
}

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('FileRangeLoader', () => {
  it('reads only the requested half-open range and reports File.size', async () => {
    const file = new File([Uint8Array.from([0, 1, 2, 3, 4])], 'fixture.bin')
    const loader = new FileRangeLoader(file)

    const result = await loader.read({ start: 1, endExclusive: 4 })

    expect([...result.data]).toEqual([1, 2, 3])
    expect(result.sourceLength).toBe(5)
    expect(result.contentRange).toBeNull()
    expect(result.etag).toBeNull()
  })

  it('rejects invalid and out-of-file ranges with a stable code', async () => {
    const loader = new FileRangeLoader(new File([Uint8Array.of(1, 2)], 'fixture.bin'))

    await expect(loader.read({ start: 1, endExclusive: 1 })).rejects.toSatisfy(
      (error: unknown) => (expectCode(error, ErrorCodes.RANGE_INVALID), true),
    )
    await expect(loader.read({ start: 0, endExclusive: 3 })).rejects.toSatisfy(
      (error: unknown) => (expectCode(error, ErrorCodes.RANGE_INVALID), true),
    )
  })

  it('aborts an unfinished slice and rejects reads after close', async () => {
    const cancel = vi.fn()
    const pendingBlob = {
      size: 2,
      stream: () => new ReadableStream<Uint8Array>({ cancel }),
    } as unknown as Blob
    const fakeFile = {
      size: 4,
      lastModified: 1,
      slice: () => pendingBlob,
    } as unknown as File
    const loader = new FileRangeLoader(fakeFile)
    const read = loader.read({ start: 0, endExclusive: 2 })

    loader.close()

    await expect(read).rejects.toSatisfy((error: unknown) => (expectCode(error, ErrorCodes.RANGE_CLOSED), true))
    await expect(loader.read({ start: 0, endExclusive: 1 })).rejects.toSatisfy(
      (error: unknown) => (expectCode(error, ErrorCodes.RANGE_CLOSED), true),
    )
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('uses exact LRU entries and protects cached bytes from mutation', async () => {
    const cache = new LruRangeCache({ maxEntries: 1, maxBytes: 4 })
    const file = new File([Uint8Array.of(1, 2, 3)], 'fixture.bin')
    const loader = new FileRangeLoader(file, { cache })
    const first = await loader.read({ start: 0, endExclusive: 1 })
    first.data[0] = 99
    const cached = await loader.read({ start: 0, endExclusive: 1 })

    expect([...cached.data]).toEqual([1])
    await loader.read({ start: 1, endExclusive: 2 })
    expect(cache.size).toBe(1)
    expect(cache.byteLength).toBe(1)
  })
})

describe('HttpRangeLoader', () => {
  it('accepts an exact 206 response and owns the Range header', async () => {
    const fetchMock: RangeFetch = vi.fn(async (_input, init) => {
      const headers = new Headers(init?.headers)
      expect(headers.get('Range')).toBe('bytes=2-4')
      expect(init?.credentials).toBe('omit')
      expect(init?.redirect).toBe('manual')
      return exactResponse([2, 3, 4], { start: 2, endExclusive: 5 }, 9, { ETag: '"v1"' })
    })
    const loader = new HttpRangeLoader('https://media.test/video.bin?token=secret', { fetch: fetchMock })

    const result = await loader.read({ start: 2, endExclusive: 5 })

    expect([...result.data]).toEqual([2, 3, 4])
    expect(result.sourceLength).toBe(9)
    expect(result.etag).toBe('"v1"')
  })

  it('rejects caller-controlled Range headers and non-HTTP URLs', () => {
    expect(() => new HttpRangeLoader('ftp://media.test/file')).toThrowError(DemuxError)
    const loader = new HttpRangeLoader('https://media.test/file', {
      headers: { Range: 'bytes=0-999' },
      fetch: vi.fn(),
    })

    return expect(loader.read({ start: 0, endExclusive: 1 })).rejects.toSatisfy(
      (error: unknown) => (expectCode(error, ErrorCodes.RANGE_HEADER_INVALID), true),
    )
  })

  it('rejects 200, mismatched Content-Range, and mismatched lengths', async () => {
    const okLoader = new HttpRangeLoader('https://media.test/file', {
      fetch: async () => new Response(Uint8Array.of(1), { status: 200 }),
      retry: { maxRetries: 0, baseDelayMs: 0, maxDelayMs: 0 },
    })
    await expect(okLoader.read({ start: 0, endExclusive: 1 })).rejects.toSatisfy(
      (error: unknown) => (expectCode(error, ErrorCodes.RANGE_UNSUPPORTED), true),
    )

    const contentRangeLoader = new HttpRangeLoader('https://media.test/file', {
      fetch: async () => exactResponse([1], { start: 1, endExclusive: 2 }, 3),
      retry: { maxRetries: 0, baseDelayMs: 0, maxDelayMs: 0 },
    })
    await expect(contentRangeLoader.read({ start: 0, endExclusive: 1 })).rejects.toSatisfy(
      (error: unknown) => (expectCode(error, ErrorCodes.RANGE_CONTENT_RANGE_INVALID), true),
    )

    const lengthLoader = new HttpRangeLoader('https://media.test/file', {
      fetch: async () => new Response(Uint8Array.of(1), {
        status: 206,
        headers: { 'Content-Range': 'bytes 0-1/4', 'Content-Length': '1' },
      }),
      retry: { maxRetries: 0, baseDelayMs: 0, maxDelayMs: 0 },
    })
    await expect(lengthLoader.read({ start: 0, endExclusive: 2 })).rejects.toSatisfy(
      (error: unknown) => (expectCode(error, ErrorCodes.RANGE_RESPONSE_LENGTH_MISMATCH), true),
    )
  })

  it('supports an unknown source total', async () => {
    const loader = new HttpRangeLoader('https://media.test/file', {
      fetch: async () => exactResponse([7, 8], { start: 5, endExclusive: 7 }, '*'),
    })

    const result = await loader.read({ start: 5, endExclusive: 7 })

    expect(result.sourceLength).toBeNull()
    expect(result.contentRange).toBe('bytes 5-6/*')
  })

  it('accepts a legal 206 response without Content-Length', async () => {
    const loader = new HttpRangeLoader('https://media.test/file', {
      fetch: async () => new Response(Uint8Array.of(4, 5), {
        status: 206,
        headers: { 'Content-Range': 'bytes 3-4/8' },
      }),
    })

    await expect(loader.read({ start: 3, endExclusive: 5 })).resolves.toMatchObject({ sourceLength: 8 })
  })

  it('retries 5xx within policy and reports retry exhaustion', async () => {
    let attempts = 0
    const loader = new HttpRangeLoader('https://media.test/file', {
      fetch: async () => {
        attempts += 1
        return new Response(null, { status: 503 })
      },
      retry: { maxRetries: 2, baseDelayMs: 0, maxDelayMs: 0 },
    })

    await expect(loader.read({ start: 0, endExclusive: 1 })).rejects.toSatisfy(
      (error: unknown) => (expectCode(error, ErrorCodes.RANGE_RETRY_EXHAUSTED), true),
    )
    expect(attempts).toBe(3)
  })

  it('retries a transient network failure and then succeeds', async () => {
    let attempts = 0
    const loader = new HttpRangeLoader('https://media.test/file', {
      fetch: async () => {
        attempts += 1
        if (attempts === 1) throw new TypeError('connection reset')
        return exactResponse([9], { start: 0, endExclusive: 1 }, 1)
      },
      retry: { maxRetries: 1, baseDelayMs: 0, maxDelayMs: 0 },
    })

    await expect(loader.read({ start: 0, endExclusive: 1 })).resolves.toMatchObject({ sourceLength: 1 })
    expect(attempts).toBe(2)
  })

  it('stops retrying immediately after cancellation', async () => {
    let attempts = 0
    const fetchMock: RangeFetch = async (_input, init) => {
      attempts += 1
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
      })
    }
    const controller = new AbortController()
    const loader = new HttpRangeLoader('https://media.test/file', {
      fetch: fetchMock,
      retry: { maxRetries: 3, baseDelayMs: 0, maxDelayMs: 0 },
    })
    const read = loader.read({ start: 0, endExclusive: 1 }, { signal: controller.signal })
    await vi.waitFor(() => expect(attempts).toBe(1))

    controller.abort()

    await expect(read).rejects.toSatisfy((error: unknown) => (expectCode(error, ErrorCodes.RANGE_ABORTED), true))
    expect(attempts).toBe(1)
  })

  it('reports redirects separately from CORS and network failures', async () => {
    const response = exactResponse([1], { start: 0, endExclusive: 1 }, 1)
    Object.defineProperty(response, 'redirected', { value: true })
    const loader = new HttpRangeLoader('https://media.test/file', { fetch: async () => response })

    await expect(loader.read({ start: 0, endExclusive: 1 })).rejects.toSatisfy(
      (error: unknown) => (expectCode(error, ErrorCodes.RANGE_REDIRECTED), true),
    )
  })

  it('serves exact ETag-qualified ranges from cache without another fetch', async () => {
    const cache = new LruRangeCache()
    const fetchMock: RangeFetch = vi.fn(async () => exactResponse(
      [6, 7],
      { start: 0, endExclusive: 2 },
      2,
      { ETag: '"stable"' },
    ))
    const loader = new HttpRangeLoader('https://media.test/file', { fetch: fetchMock, cache })
    const first = await loader.read({ start: 0, endExclusive: 2 })
    first.data[0] = 99

    const second = await loader.read({ start: 0, endExclusive: 2 })

    expect([...second.data]).toEqual([6, 7])
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('does not retry an inferred CORS failure', async () => {
    vi.stubGlobal('location', { origin: 'https://app.test' })
    const fetchMock: RangeFetch = vi.fn(async () => { throw new TypeError('Failed to fetch') })
    const loader = new HttpRangeLoader('https://media.test/file?secret=yes', {
      fetch: fetchMock,
      retry: { maxRetries: 3, baseDelayMs: 0, maxDelayMs: 0 },
    })

    await expect(loader.read({ start: 0, endExclusive: 1 })).rejects.toSatisfy(
      (error: unknown) => {
        expectCode(error, ErrorCodes.RANGE_CORS_FAILED)
        expect(JSON.stringify((error as DemuxError).context)).not.toContain('secret')
        return true
      },
    )
    expect(fetchMock).toHaveBeenCalledOnce()
    vi.unstubAllGlobals()
  })

  it('enforces the configured concurrency window', async () => {
    const responses = [deferred<Response>(), deferred<Response>(), deferred<Response>()]
    let calls = 0
    let active = 0
    let peak = 0
    const fetchMock: RangeFetch = vi.fn(() => {
      const current = calls
      calls += 1
      active += 1
      peak = Math.max(peak, active)
      return responses[current]?.promise.then((response) => {
        active -= 1
        return response
      }) ?? Promise.reject(new Error('unexpected request'))
    })
    const loader = new HttpRangeLoader('https://media.test/file', {
      fetch: fetchMock,
      maxConcurrentReads: 2,
      retry: { maxRetries: 0, baseDelayMs: 0, maxDelayMs: 0 },
    })
    const reads = [0, 1, 2].map((start) => loader.read({ start, endExclusive: start + 1 }))
    await Promise.resolve()
    expect(calls).toBe(2)
    responses[0]?.resolve(exactResponse([0], { start: 0, endExclusive: 1 }, 3))
    await vi.waitFor(() => expect(calls).toBe(3))
    responses[1]?.resolve(exactResponse([1], { start: 1, endExclusive: 2 }, 3))
    responses[2]?.resolve(exactResponse([2], { start: 2, endExclusive: 3 }, 3))

    await expect(Promise.all(reads)).resolves.toHaveLength(3)
    expect(peak).toBe(2)
  })

  it('pins ETag and rejects a changed source generation', async () => {
    let call = 0
    const loader = new HttpRangeLoader('https://media.test/file', {
      fetch: async (_input, init) => {
        call += 1
        const requestHeaders = new Headers(init?.headers)
        if (call === 2) expect(requestHeaders.get('If-Range')).toBe('"v1"')
        return exactResponse([call], { start: call - 1, endExclusive: call }, 2, { ETag: call === 1 ? '"v1"' : '"v2"' })
      },
      retry: { maxRetries: 0, baseDelayMs: 0, maxDelayMs: 0 },
    })
    await loader.read({ start: 0, endExclusive: 1 })

    await expect(loader.read({ start: 1, endExclusive: 2 })).rejects.toSatisfy(
      (error: unknown) => (expectCode(error, ErrorCodes.RANGE_SOURCE_CHANGED), true),
    )
  })
})
