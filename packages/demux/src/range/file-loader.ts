import { ErrorCodes, type ByteRange, type RangeCacheKey, type RangeLoaderOptions, type RangeReadResult } from '@mx-player-max/types'
import { cloneRangeReadResult } from './cache'
import { DemuxError, createRangeAbortError } from './errors'
import { RangeScheduler } from './scheduler'
import { DEFAULT_MAX_CONCURRENT_READS, type FileRangeLoaderOptions, type RangeLoader } from './types'
import { validateByteRange, validateConcurrency } from './validation'

const fileIds = new WeakMap<File, number>()
let nextFileId = 1

function getFileSourceKey(file: File): string {
  let id = fileIds.get(file)
  if (id === undefined) {
    id = nextFileId
    nextFileId += 1
    fileIds.set(file, id)
  }
  return `file:${id}:${file.size}:${file.lastModified}`
}

async function readBlobWithAbort(blob: Blob, signal: AbortSignal): Promise<ArrayBuffer> {
  if (signal.aborted) throw createRangeAbortError(false, signal.reason)
  const streamReader = blob.stream().getReader()
  const result = new Uint8Array(blob.size)
  let offset = 0
  const onAbort = (): void => { void streamReader.cancel(signal.reason) }
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    while (true) {
      const chunk = await streamReader.read()
      if (signal.aborted) throw createRangeAbortError(false, signal.reason)
      if (chunk.done) break
      if (offset + chunk.value.byteLength > result.byteLength) {
        throw new DemuxError(ErrorCodes.RANGE_RESPONSE_LENGTH_MISMATCH, 'File stream exceeded its slice length')
      }
      result.set(chunk.value, offset)
      offset += chunk.value.byteLength
    }
  } finally {
    signal.removeEventListener('abort', onAbort)
    streamReader.releaseLock()
  }
  if (offset !== result.byteLength) {
    throw new DemuxError(ErrorCodes.RANGE_RESPONSE_LENGTH_MISMATCH, 'File stream ended before its slice length')
  }
  return result.buffer
}

export class FileRangeLoader implements RangeLoader {
  readonly #file: File
  readonly #sourceKey: string
  readonly #scheduler: RangeScheduler
  readonly #defaultOptions: RangeLoaderOptions
  #closed = false

  constructor(file: File, options: FileRangeLoaderOptions = {}) {
    if (!Number.isSafeInteger(file.size) || file.size < 0) {
      throw new DemuxError(ErrorCodes.RANGE_INVALID, 'File size must be a non-negative safe integer')
    }
    this.#file = file
    this.#sourceKey = getFileSourceKey(file)
    this.#scheduler = new RangeScheduler(validateConcurrency(options.maxConcurrentReads ?? DEFAULT_MAX_CONCURRENT_READS))
    this.#defaultOptions = {
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      ...(options.retry === undefined ? {} : { retry: options.retry }),
      ...(options.cache === undefined ? {} : { cache: options.cache }),
    }
    options.signal?.addEventListener('abort', () => this.close(), { once: true })
  }

  async read(range: ByteRange, options: RangeLoaderOptions = {}): Promise<RangeReadResult> {
    if (this.#closed) throw createRangeAbortError(true)
    const validRange = validateByteRange(range, this.#file.size)
    const cache = options.cache ?? this.#defaultOptions.cache
    const cacheKey: RangeCacheKey = { sourceKey: this.#sourceKey, range: validRange, etag: null }
    const cached = cache?.get(cacheKey)
    if (cached !== undefined && cached !== null) return cloneRangeReadResult(cached)
    const signal = options.signal ?? this.#defaultOptions.signal

    return this.#scheduler.schedule(async (taskSignal) => {
      const buffer = await readBlobWithAbort(this.#file.slice(validRange.start, validRange.endExclusive), taskSignal)
      const expectedLength = validRange.endExclusive - validRange.start
      if (buffer.byteLength !== expectedLength) {
        throw new DemuxError(ErrorCodes.RANGE_RESPONSE_LENGTH_MISMATCH, 'File slice length did not match the requested range', {
          context: { expectedLength, actualLength: buffer.byteLength },
        })
      }
      const result: RangeReadResult = {
        data: new Uint8Array(buffer),
        sourceLength: this.#file.size,
        contentRange: null,
        etag: null,
      }
      cache?.set(cacheKey, result)
      return cloneRangeReadResult(result)
    }, signal)
  }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    this.#scheduler.close()
    this.#defaultOptions.cache?.deleteSource(this.#sourceKey)
  }
}
