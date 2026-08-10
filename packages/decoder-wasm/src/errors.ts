import type { EngineError } from '@mx-player-max/types'
import { ErrorCodes } from '@mx-player-max/types'
import type { WasmVariant } from './contracts'

export interface WasmDecoderAttempt {
  readonly pluginId: string
  readonly variant: WasmVariant | null
  readonly code: string
  readonly message: string
}

export class WasmDecoderError extends Error implements EngineError {
  readonly code: string
  readonly recoverable: boolean
  readonly attempts?: readonly WasmDecoderAttempt[]
  override readonly cause?: unknown

  constructor(
    code: string,
    message: string,
    recoverable: boolean,
    options?: { cause?: unknown; attempts?: readonly WasmDecoderAttempt[] },
  ) {
    super(message)
    this.name = 'WasmDecoderError'
    this.code = code
    this.recoverable = recoverable
    if (options?.cause !== undefined) this.cause = options.cause
    if (options?.attempts !== undefined) this.attempts = options.attempts
  }
}

export function createWasmError(
  code: string,
  message: string,
  recoverable = false,
  options?: { cause?: unknown; attempts?: readonly WasmDecoderAttempt[] },
): WasmDecoderError {
  return new WasmDecoderError(code, message, recoverable, options)
}

export function isWasmDecoderError(value: unknown): value is WasmDecoderError {
  return value instanceof WasmDecoderError
}

export function isWasmAbort(value: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted === true) return true
  if (value instanceof WasmDecoderError) return value.code === ErrorCodes.WASM_ABORTED
  return typeof DOMException !== 'undefined' && value instanceof DOMException && value.name === 'AbortError'
}

export function toWasmError(
  value: unknown,
  fallbackCode: string,
  message: string,
  recoverable = true,
): WasmDecoderError {
  if (value instanceof WasmDecoderError) return value
  return createWasmError(fallbackCode, message, recoverable)
}

export function isWasmTerminalError(value: unknown): boolean {
  return value instanceof WasmDecoderError
    && (value.code === ErrorCodes.WASM_ABORTED || value.code === ErrorCodes.WASM_CLOSED)
}
