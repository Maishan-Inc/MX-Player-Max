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
    let result
    try {
      result = await this.#loader.read({ start: offset, endExclusive })
    } catch (cause) {
      if (cause instanceof DemuxError && cause.code === ErrorCodes.RANGE_INVALID) {
        throw new DemuxError(ErrorCodes.CONTAINER_TRUNCATED, 'Container ended before the requested bytes', {
          context: { offset, length },
          cause,
        })
      }
      throw cause
    }
    if (result.data.byteLength !== length) {
      throw new DemuxError(ErrorCodes.CONTAINER_TRUNCATED, 'Range Loader returned a short container read', {
        context: { offset, expectedLength: length, actualLength: result.data.byteLength },
      })
    }
    if (this.#sourceLengthObserved && result.sourceLength !== this.#sourceLength) {
      throw new DemuxError(ErrorCodes.RANGE_SOURCE_CHANGED, 'Source length changed while parsing the container')
    }
    this.#sourceLength = result.sourceLength
    this.#sourceLengthObserved = true
    return result.data
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
