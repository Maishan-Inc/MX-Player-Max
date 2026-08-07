import type { EngineError } from '@mx-player-max/types'

export class WebCodecsError extends Error implements EngineError {
  readonly code: string
  readonly recoverable: boolean
  override readonly cause?: unknown

  constructor(code: string, message: string, recoverable: boolean, cause?: unknown) {
    super(message)
    this.name = 'WebCodecsError'
    this.code = code
    this.recoverable = recoverable
    if (cause !== undefined) this.cause = cause
  }
}

export function createWebCodecsError(
  code: string,
  message: string,
  recoverable = false,
  cause?: unknown,
): WebCodecsError {
  return new WebCodecsError(code, message, recoverable, cause)
}
