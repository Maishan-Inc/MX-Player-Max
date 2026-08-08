import type { EngineError } from '@mx-player-max/types'
import { ErrorCodes } from '@mx-player-max/types'

export type RendererErrorCode =
  | typeof ErrorCodes.RENDERER_BACKEND_UNAVAILABLE
  | typeof ErrorCodes.RENDERER_TARGET_INVALID
  | typeof ErrorCodes.RENDERER_CONTEXT_UNAVAILABLE
  | typeof ErrorCodes.RENDERER_DEVICE_REQUEST_FAILED
  | typeof ErrorCodes.RENDERER_DEVICE_LOST
  | typeof ErrorCodes.RENDERER_DEVICE_REBUILD_FAILED
  | typeof ErrorCodes.RENDERER_SHADER_FAILED
  | typeof ErrorCodes.RENDERER_FRAME_INVALID
  | typeof ErrorCodes.RENDERER_RESIZE_INVALID
  | typeof ErrorCodes.RENDERER_FILTER_UNSUPPORTED
  | typeof ErrorCodes.RENDERER_HDR_UNSUPPORTED
  | typeof ErrorCodes.RENDERER_OPERATION_FAILED
  | typeof ErrorCodes.RENDERER_CLOSED

export class RendererException extends Error implements EngineError {
  readonly code: RendererErrorCode
  readonly recoverable: boolean
  override readonly cause?: unknown

  constructor(code: RendererErrorCode, message: string, recoverable = false, cause?: unknown) {
    super(message)
    this.name = 'RendererError'
    this.code = code
    this.recoverable = recoverable
    if (cause !== undefined) this.cause = cause
  }
}

export function rendererError(code: RendererErrorCode, message: string, recoverable = false, cause?: unknown): RendererException {
  return new RendererException(code, message, recoverable, cause)
}

export function isRendererError(value: unknown): value is RendererException {
  return typeof value === 'object' && value !== null
    && typeof (value as { code?: unknown }).code === 'string'
    && String((value as { code?: unknown }).code).startsWith('RENDERER_')
}

/** Public renderer events expose stable diagnostics only, never DOM/GPU causes. */
export function publicRendererError(error: EngineError): EngineError {
  return { code: error.code, message: error.message, recoverable: error.recoverable }
}
