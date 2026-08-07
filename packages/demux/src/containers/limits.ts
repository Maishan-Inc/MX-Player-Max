import { ErrorCodes } from '@mx-player-max/types'
import { DemuxError } from '../range/errors'

export interface DemuxLimits {
  maxReadRangeBytes: number
  maxMetadataElementBytes: number
  maxElementSizeBytes: number
  maxNestingDepth: number
  maxTracks: number
  maxPacketBytes: number
  maxKeyframes: number
  maxForwardScanBytes: number
  maxWorkerMessageBytes: number
}

export type DemuxLimitsInput = Partial<DemuxLimits>

export const DEFAULT_DEMUX_LIMITS: Readonly<DemuxLimits> = Object.freeze({
  maxReadRangeBytes: 8 * 1024 * 1024,
  maxMetadataElementBytes: 16 * 1024 * 1024,
  maxElementSizeBytes: 1024 * 1024 * 1024 * 1024,
  maxNestingDepth: 16,
  maxTracks: 64,
  maxPacketBytes: 32 * 1024 * 1024,
  maxKeyframes: 250_000,
  maxForwardScanBytes: 64 * 1024 * 1024,
  maxWorkerMessageBytes: 32 * 1024 * 1024,
})

const HARD_LIMITS: Readonly<DemuxLimits> = DEFAULT_DEMUX_LIMITS

export function resolveDemuxLimits(input: DemuxLimitsInput = {}): DemuxLimits {
  const result: DemuxLimits = { ...DEFAULT_DEMUX_LIMITS, ...input }
  for (const key of Object.keys(result) as (keyof DemuxLimits)[]) {
    const value = result[key]
    if (!Number.isSafeInteger(value) || value <= 0 || value > HARD_LIMITS[key]) {
      throw new DemuxError(ErrorCodes.CONTAINER_LIMIT_EXCEEDED, `Invalid or excessive demux limit: ${key}`, {
        context: { limit: key, value, hardLimit: HARD_LIMITS[key] },
      })
    }
  }
  return result
}

