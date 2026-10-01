import { ErrorCodes } from '@mx-player-max/types'
import { DemuxError } from '../range/errors'
import type { RangeLoader } from '../range/types'
import { checkedAdd } from '../range/validation'
import type { DemuxLimits } from './limits'

export class BoundedRangeReader {
  readonly #loader: RangeLoader
  readonly #limits: DemuxLimits
  #sourceLength: number | null = null
  #sourceLengthObserved = false
  #readAheadBounds: { start: number; endExclusive: number } | null = null
  #window: { start: number; data: Uint8Array } | null = null

  constructor(loader: RangeLoader, limits: DemuxLimits) {
    this.#loader = loader
    this.#limits = limits
  }

  get sourceLength(): number | null {
    return this.#sourceLength
  }

  get sourceLengthObserved(): boolean {
    return this.#sourceLengthObserved
  }

  /** A per-operation 64 KiB window, bounded to one Cluster and never used by container probing. */
  forkWithReadAhead(start: number, endExclusive: number): BoundedRangeReader {
    if (!Number.isSafeInteger(start) || start < 0 || !Number.isSafeInteger(endExclusive) || endExclusive <= start
      || (this.#sourceLength !== null && endExclusive > this.#sourceLength)) {
      throw new DemuxError(ErrorCodes.CONTAINER_INVALID, 'Read-ahead bounds must fit the source')
    }
    const reader = new BoundedRangeReader(this.#loader, this.#limits)
    reader.#sourceLength = this.#sourceLength
    reader.#sourceLengthObserved = this.#sourceLengthObserved
    reader.#readAheadBounds = { start, endExclusive }
    return reader
  }

  async readAt(offset: number, length: number): Promise<Uint8Array> {
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length <= 0) {
      throw new DemuxError(ErrorCodes.CONTAINER_INVALID, 'Container read offset and length must be positive safe integers')
    }
    if (length > this.#limits.maxReadRangeBytes) {
      throw new DemuxError(ErrorCodes.CONTAINER_LIMIT_EXCEEDED, 'Container read exceeds the per-range budget', {
        context: { length, limit: this.#limits.maxReadRangeBytes },
      })
    }
    const endExclusive = checkedAdd(offset, length)
    if (this.#sourceLength !== null && endExclusive > this.#sourceLength) {
      throw new DemuxError(ErrorCodes.CONTAINER_TRUNCATED, 'Container read exceeds the source length', {
        context: { offset, length, sourceLength: this.#sourceLength },
      })
    }
    const bounds = this.#readAheadBounds
    if (bounds && (offset < bounds.start || endExclusive > bounds.endExclusive)) {
      throw new DemuxError(ErrorCodes.CONTAINER_TRUNCATED, 'Container read exceeds the read-ahead scope')
    }
    const window = this.#window
    if (window && offset >= window.start && endExclusive <= window.start + window.data.byteLength) {
      return window.data.slice(offset - window.start, endExclusive - window.start)
    }
    const fetchLength = bounds === null ? length
      : Math.min(bounds.endExclusive - offset, Math.max(length, Math.min(64 * 1024, this.#limits.maxReadRangeBytes)))
    const fetchEnd = checkedAdd(offset, fetchLength)
    let result
    try {
      result = await this.#loader.read({ start: offset, endExclusive: fetchEnd })
    } catch (cause) {
      if (cause instanceof DemuxError && cause.code === ErrorCodes.RANGE_INVALID) {
        throw new DemuxError(ErrorCodes.CONTAINER_TRUNCATED, 'Container ended before the requested bytes', {
          context: { offset, length },
          cause,
        })
      }
      throw cause
    }
    if (result.data.byteLength !== fetchLength) {
      throw new DemuxError(ErrorCodes.CONTAINER_TRUNCATED, 'Range Loader returned a short container read', {
        context: { offset, expectedLength: fetchLength, actualLength: result.data.byteLength },
      })
    }
    if (this.#sourceLengthObserved && result.sourceLength !== this.#sourceLength) {
      throw new DemuxError(ErrorCodes.RANGE_SOURCE_CHANGED, 'Source length changed while parsing the container')
    }
    this.#sourceLength = result.sourceLength
    this.#sourceLengthObserved = true
    if (bounds && fetchLength <= 64 * 1024) {
      this.#window = { start: offset, data: result.data }
      return result.data.slice(0, length)
    }
    return fetchLength === length ? result.data : result.data.slice(0, length)
  }

  async readMetadata(offset: number, length: number): Promise<Uint8Array> {
    return this.readBuffered(offset, length, this.#limits.maxMetadataElementBytes, 'Metadata element')
  }

  async readBuffered(offset: number, length: number, maxBytes: number, label: string): Promise<Uint8Array> {
    if (!Number.isSafeInteger(length) || length < 0 || length > maxBytes) {
      throw new DemuxError(ErrorCodes.CONTAINER_LIMIT_EXCEEDED, `${label} exceeds its buffer budget`, {
        context: { length, limit: maxBytes },
      })
    }
    if (length === 0) return new Uint8Array()
    const result = new Uint8Array(length)
    let copied = 0
    while (copied < length) {
      const chunkLength = Math.min(this.#limits.maxReadRangeBytes, length - copied)
      result.set(await this.readAt(checkedAdd(offset, copied), chunkLength), copied)
      copied += chunkLength
    }
    return result
  }
}
