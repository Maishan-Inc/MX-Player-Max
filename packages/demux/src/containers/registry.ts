import { ErrorCodes } from '@mx-player-max/types'
import { DemuxError, isDemuxError } from '../range/errors'
import type { RangeLoader } from '../range/types'
import { MatroskaContainerAdapter } from './ebml/matroska-adapter'
import { WebMContainerAdapter } from './ebml/webm-adapter'
import type { DemuxLimitsInput } from './limits'
import { Mp4ContainerAdapter } from './mp4/mp4-adapter'
import type { ContainerAdapter, ContainerProbeResult, Demuxer } from './types'

export interface ContainerSelection {
  adapter: ContainerAdapter
  metadata: ContainerProbeResult
  demuxer: Demuxer
}

export interface ProbeContainerOptions {
  adapters?: readonly ContainerAdapter[]
  limits?: DemuxLimitsInput
}

export function createDefaultContainerAdapters(limits: DemuxLimitsInput = {}): ContainerAdapter[] {
  return [new Mp4ContainerAdapter(limits), new MatroskaContainerAdapter(limits), new WebMContainerAdapter(limits)]
}

export async function probeContainer(reader: RangeLoader, options: ProbeContainerOptions = {}): Promise<ContainerSelection> {
  let headerResult
  try {
    headerResult = await reader.read({ start: 0, endExclusive: 12 })
  } catch (cause) {
    if (isDemuxError(cause) && cause.code !== ErrorCodes.RANGE_INVALID) throw cause
    throw new DemuxError(ErrorCodes.CONTAINER_TRUNCATED, 'Source is too short for container identification', { cause })
  }
  const adapters = options.adapters ?? createDefaultContainerAdapters(options.limits)
  const candidates = adapters.filter((adapter) => adapter.canProbe(headerResult.data))
  if (candidates.length === 0) throw new DemuxError(ErrorCodes.CONTAINER_UNSUPPORTED, 'No container adapter recognized the source header')

  const successes: { adapter: ContainerAdapter; metadata: ContainerProbeResult }[] = []
  let structuralFailure: unknown
  for (const adapter of candidates) {
    try {
      successes.push({ adapter, metadata: await adapter.probe(reader) })
    } catch (cause) {
      if (cause instanceof DemuxError && cause.code === ErrorCodes.CONTAINER_UNSUPPORTED) continue
      structuralFailure ??= cause
    }
  }
  if (successes.length === 0) {
    if (structuralFailure !== undefined) throw structuralFailure
    throw new DemuxError(ErrorCodes.CONTAINER_UNSUPPORTED, 'Container candidates rejected the source metadata')
  }
  if (successes.length !== 1) throw new DemuxError(ErrorCodes.CONTAINER_INVALID, 'Container probe produced an ambiguous result')
  const selected = successes[0]
  if (selected === undefined) throw new DemuxError(ErrorCodes.CONTAINER_INVALID, 'Container selection failed unexpectedly')
  return {
    adapter: selected.adapter,
    metadata: selected.metadata,
    demuxer: selected.adapter.createDemuxer(reader, selected.metadata),
  }
}
