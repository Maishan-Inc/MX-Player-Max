import { describe, expect, it } from 'vitest'
import { ErrorCodes } from '../src'

describe('WASM public error codes', () => {
  it('exports stable Manager error codes', () => {
    const codes = [
      'WASM_MANIFEST_INVALID',
      'WASM_PLUGIN_DUPLICATE',
      'WASM_PLUGIN_NOT_FOUND',
      'WASM_VARIANT_UNAVAILABLE',
      'WASM_URL_INVALID',
      'WASM_FETCH_FAILED',
      'WASM_HASH_MISMATCH',
      'WASM_CACHE_FAILED',
      'WASM_INSTANTIATE_FAILED',
      'WASM_RUNTIME_UNAVAILABLE',
      'WASM_EXPORT_INVALID',
      'WASM_FRAME_ABI_INVALID',
      'WASM_DECODE_FAILED',
      'WASM_RESET_FAILED',
      'WASM_WORKER_FAILED',
      'WASM_PLUGIN_INIT_FAILED',
      'WASM_REVIEW_REQUIRED',
      'WASM_ABORTED',
      'WASM_CLOSED',
      'WASM_ALL_VARIANTS_FAILED',
    ] as const

    for (const code of codes) expect(ErrorCodes[code]).toBe(code)
  })
})
