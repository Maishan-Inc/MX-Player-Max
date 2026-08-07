import type { EngineError } from '@mx-player-max/types'
import { createEngineError, isEngineError, type EngineErrorException } from '../native/errors'

export function toCustomEngineError(
  cause: unknown,
  fallbackCode: string,
  fallbackMessage: string,
  recoverable = true,
): EngineErrorException {
  if (isEngineError(cause)) return cause as EngineErrorException
  return createEngineError(fallbackCode, fallbackMessage, recoverable, cause)
}

export function safeEngineError(error: EngineError): EngineError {
  return { code: error.code, message: error.message, recoverable: error.recoverable }
}
