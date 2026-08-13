import { createWasmError } from '@mx-player-max/decoder-wasm'
import { ErrorCodes, type EngineError } from '@mx-player-max/types'

export const wasmWorkerErrors = Object.freeze({
  aborted: ErrorCodes.WASM_ABORTED,
  configInvalid: ErrorCodes.WASM_MANIFEST_INVALID,
  configureFailed: ErrorCodes.WASM_PLUGIN_INIT_FAILED,
  decodeFailed: ErrorCodes.WASM_DECODE_FAILED,
  flushFailed: ErrorCodes.WASM_DECODE_FAILED,
  resetFailed: ErrorCodes.WASM_RESET_FAILED,
  workerFailed: ErrorCodes.WASM_WORKER_FAILED,
  frameInvalid: ErrorCodes.WASM_FRAME_ABI_INVALID,
})

export function createWasmWorkerError(
  code: string,
  message: string,
  recoverable: boolean,
  cause?: unknown,
): EngineError {
  return createWasmError(code, message, recoverable, cause === undefined ? undefined : { cause })
}
