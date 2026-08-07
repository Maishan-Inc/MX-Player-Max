import { ErrorCodes, type RangeCache, type RangeCacheKey, type RangeReadResult } from '@mx-player-max/types'
import { DemuxError } from './errors'

export interface LruRangeCacheOptions {
  maxEntries?: number
  maxBytes?: number
}

interface CacheEntry {
  key: RangeCacheKey
  value: RangeReadResult
  bytes: number
}

const DEFAULT_MAX_ENTRIES = 128
const DEFAULT_MAX_BYTES = 32 * 1024 * 1024

function validateLimit(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new DemuxError(ErrorCodes.RANGE_INVALID, `${name} must be a non-negative safe integer`)
  }
  return value
}

function serializeKey(key: RangeCacheKey): string {
  return JSON.stringify([key.sourceKey, key.etag, key.range.start, key.range.endExclusive])
}

export function cloneRangeReadResult(value: RangeReadResult): RangeReadResult {
  return {
    data: new Uint8Array(value.data),
    sourceLength: value.sourceLength,
    contentRange: value.contentRange,
    etag: value.etag,
  }
}

export class LruRangeCache implements RangeCache {
  readonly #maxEntries: number
  readonly #maxBytes: number
  readonly #entries = new Map<string, CacheEntry>()
  #bytes = 0

  constructor(options: LruRangeCacheOptions = {}) {
    this.#maxEntries = validateLimit(options.maxEntries ?? DEFAULT_MAX_ENTRIES, 'maxEntries')
    this.#maxBytes = validateLimit(options.maxBytes ?? DEFAULT_MAX_BYTES, 'maxBytes')
  }

  get(key: RangeCacheKey): RangeReadResult | null {
    const serialized = serializeKey(key)
    const entry = this.#entries.get(serialized)
    if (entry === undefined) return null
    this.#entries.delete(serialized)
    this.#entries.set(serialized, entry)
    return cloneRangeReadResult(entry.value)
  }

  set(key: RangeCacheKey, value: RangeReadResult): void {
    const bytes = value.data.byteLength
    if (this.#maxEntries === 0 || bytes > this.#maxBytes) return
    const serialized = serializeKey(key)
    const previous = this.#entries.get(serialized)
    if (previous !== undefined) {
      this.#bytes -= previous.bytes
      this.#entries.delete(serialized)
    }
    const clonedKey: RangeCacheKey = {
      sourceKey: key.sourceKey,
      range: { ...key.range },
      etag: key.etag,
    }
    this.#entries.set(serialized, { key: clonedKey, value: cloneRangeReadResult(value), bytes })
    this.#bytes += bytes
    this.#evict()
  }

  deleteSource(sourceKey: string): void {
    for (const [serialized, entry] of this.#entries) {
      if (entry.key.sourceKey !== sourceKey) continue
      this.#entries.delete(serialized)
      this.#bytes -= entry.bytes
    }
  }

  clear(): void {
    this.#entries.clear()
    this.#bytes = 0
  }

  get size(): number {
    return this.#entries.size
  }

  get byteLength(): number {
    return this.#bytes
  }

  #evict(): void {
    while (this.#entries.size > this.#maxEntries || this.#bytes > this.#maxBytes) {
      const oldest = this.#entries.entries().next().value
      if (oldest === undefined) return
      const [serialized, entry] = oldest
      this.#entries.delete(serialized)
      this.#bytes -= entry.bytes
    }
  }
}

