import type { EngineError } from '@mx-player-max/types'

/** Error value used at the public engine boundary. */
export class EngineErrorException extends Error implements EngineError {
  readonly code: string
  readonly recoverable: boolean
  override readonly cause?: unknown

  constructor(code: string, message: string, recoverable: boolean, cause?: unknown) {
    super(message)
    this.name = 'EngineError'
    this.code = code
    this.recoverable = recoverable
    if (cause !== undefined) this.cause = cause
  }
}

export function createEngineError(
  code: string,
  message: string,
  recoverable = false,
  cause?: unknown,
): EngineErrorException {
  return new EngineErrorException(code, message, recoverable, cause)
}

export function isEngineError(value: unknown): value is EngineError {
  return typeof value === 'object'
    && value !== null
    && typeof (value as { code?: unknown }).code === 'string'
    && typeof (value as { message?: unknown }).message === 'string'
    && typeof (value as { recoverable?: unknown }).recoverable === 'boolean'
}

export function mapNativeDomError(cause: unknown, fallbackCode: string, fallbackMessage: string): EngineErrorException {
  const name = typeof cause === 'object' && cause !== null && 'name' in cause
    ? String((cause as { name?: unknown }).name)
    : ''
  if (name === 'NotAllowedError') {
    return createEngineError(fallbackCode, fallbackMessage, true, cause)
  }
  if (name === 'AbortError') {
    return createEngineError('NATIVE_ABORTED', 'The media operation was aborted', true, cause)
  }
  return createEngineError(fallbackCode, fallbackMessage, true, cause)
}
