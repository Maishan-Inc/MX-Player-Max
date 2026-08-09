import { ErrorCodes, type EngineError, type SubtitleErrorCode } from '@mx-player-max/types'

const KNOWN_SUBTITLE_CODES = new Set<string>(Object.values(ErrorCodes).filter((code) => code.startsWith('SUBTITLE_')))

export class SubtitleError extends Error implements EngineError {
  readonly code: SubtitleErrorCode
  readonly recoverable: boolean
  readonly context: Readonly<Record<string, string | number | boolean | null>>

  constructor(
    code: SubtitleErrorCode,
    message: string,
    recoverable = false,
    context: Readonly<Record<string, string | number | boolean | null>> = {},
  ) {
    super(message)
    this.name = 'SubtitleError'
    this.code = code
    this.recoverable = recoverable
    this.context = context
  }
}

interface SubtitleErrorShape {
  readonly code: string
  readonly message: string
  readonly recoverable: boolean
}

export function isSubtitleError(value: unknown): value is SubtitleErrorShape {
  return value instanceof SubtitleError
    ? KNOWN_SUBTITLE_CODES.has(value.code)
    : (typeof value === 'object' && value !== null
      && 'code' in value && typeof value.code === 'string'
      && KNOWN_SUBTITLE_CODES.has(value.code)
      && 'message' in value && typeof value.message === 'string'
      && 'recoverable' in value && typeof value.recoverable === 'boolean')
}

export function toSubtitleError(
  value: unknown,
  fallbackCode: SubtitleErrorCode = ErrorCodes.SUBTITLE_OPERATION_FAILED,
  fallbackMessage = 'The subtitle operation failed',
  recoverable = true,
): SubtitleError {
  if (isSubtitleError(value)) {
    return value instanceof SubtitleError
      ? value
      : new SubtitleError(value.code as SubtitleErrorCode, safeMessage(value.message, fallbackMessage), value.recoverable)
  }
  return new SubtitleError(fallbackCode, fallbackMessage, recoverable)
}

export function subtitleErrorPayload(error: unknown): EngineError {
  const value = toSubtitleError(error)
  return { code: value.code, message: value.message, recoverable: value.recoverable }
}

function safeMessage(value: string, fallback: string): string {
  return value.length > 256 ? fallback : value
}
