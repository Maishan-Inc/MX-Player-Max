import { ErrorCodes, type EngineError } from '@mx-player-max/types'

export type DemuxErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes]
export type DemuxErrorContextValue = string | number | boolean | null
export type DemuxErrorContext = Readonly<Record<string, DemuxErrorContextValue>>

interface DemuxErrorOptions {
  recoverable?: boolean
  context?: DemuxErrorContext
  cause?: unknown
}

export class DemuxError extends Error implements EngineError {
  override readonly name = 'DemuxError'
  readonly code: DemuxErrorCode
  readonly recoverable: boolean
  readonly context: DemuxErrorContext

  constructor(code: DemuxErrorCode, message: string, options: DemuxErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.code = code
    this.recoverable = options.recoverable ?? false
    this.context = options.context ?? {}
  }
}

export function isDemuxError(value: unknown): value is DemuxError {
  return value instanceof DemuxError
}

export function createRangeAbortError(closed: boolean, cause?: unknown): DemuxError {
  const code = closed ? ErrorCodes.RANGE_CLOSED : ErrorCodes.RANGE_ABORTED
  const message = closed ? 'Range loader is closed' : 'Range read was aborted'
  return new DemuxError(code, message, cause === undefined ? {} : { cause })
}

