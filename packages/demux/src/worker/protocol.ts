import type { DemuxPacket, Micros, SourceDescriptor } from '@mx-player-max/types'
import type { DemuxErrorContext } from '../range/errors'
import type { DemuxLimitsInput } from '../containers/limits'
import type { ContainerProbeResult } from '../containers/types'

interface WorkerRequestBase {
  sessionId: string
  epoch: number
  requestId: string
}

export interface DemuxWorkerStartRequest extends WorkerRequestBase {
  command: 'start'
  source: SourceDescriptor
  limits?: DemuxLimitsInput
}

export interface DemuxWorkerReadRequest extends WorkerRequestBase {
  command: 'read'
}

export interface DemuxWorkerSeekRequest extends WorkerRequestBase {
  command: 'seek'
  time: Micros
}

export interface DemuxWorkerCloseRequest extends WorkerRequestBase {
  command: 'close'
}

export type DemuxWorkerRequest =
  | DemuxWorkerStartRequest
  | DemuxWorkerReadRequest
  | DemuxWorkerSeekRequest
  | DemuxWorkerCloseRequest

interface WorkerResponseBase {
  sessionId: string
  epoch: number
  requestId: string
}

export interface DemuxWorkerProbeResponse extends WorkerResponseBase {
  type: 'probe'
  metadata: ContainerProbeResult
}

export interface DemuxWorkerPacketsResponse extends WorkerResponseBase {
  type: 'packets'
  packets: DemuxPacket[]
  endOfStream: boolean
}

export interface DemuxWorkerSeekedResponse extends WorkerResponseBase {
  type: 'seeked'
  time: Micros
}

export interface DemuxWorkerClosedResponse extends WorkerResponseBase {
  type: 'closed'
}

export interface SerializedDemuxError {
  code: string
  message: string
  recoverable: boolean
  context: DemuxErrorContext
}

export interface DemuxWorkerErrorResponse extends WorkerResponseBase {
  type: 'error'
  error: SerializedDemuxError
}

export type DemuxWorkerResponse =
  | DemuxWorkerProbeResponse
  | DemuxWorkerPacketsResponse
  | DemuxWorkerSeekedResponse
  | DemuxWorkerClosedResponse
  | DemuxWorkerErrorResponse

