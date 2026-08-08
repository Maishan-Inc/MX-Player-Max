import type { EngineError } from '@mx-player-max/types'

export class AudioPipelineError extends Error implements EngineError {
  readonly code: string
  readonly recoverable: boolean
  override readonly cause?: unknown

  constructor(code: string, message: string, recoverable: boolean, cause?: unknown) {
    super(message)
    this.name = 'AudioPipelineError'
    this.code = code
    this.recoverable = recoverable
    if (cause !== undefined) this.cause = cause
  }
}

export function audioError(code: string, message: string, recoverable = false, cause?: unknown): AudioPipelineError {
  return new AudioPipelineError(code, message, recoverable, cause)
}
