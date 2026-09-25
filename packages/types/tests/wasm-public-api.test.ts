import { describe, expect, it } from 'vitest'
import { decoderFrameOutputUsable, ErrorCodes } from '../src'

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
      'WASM_FRAME_OUTPUT_UNAVAILABLE',
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

  /**
   * A realm that cannot construct the frame is a distinct fact from a descriptor the host and the
   * module disagree about, so the two codes stay distinct. Reusing the ABI code sent readers to the
   * frame layout for a browser gap.
   */
  it('keeps the frame-output gap apart from a malformed descriptor', () => {
    expect(ErrorCodes.WASM_FRAME_OUTPUT_UNAVAILABLE).not.toBe(ErrorCodes.WASM_FRAME_ABI_INVALID)
  })

  /**
   * The declaration format has exactly one interpreter, so the package publishing a frame-output
   * requirement and the strategy layer consuming it cannot disagree about what it means. An absent
   * declaration is usable, which is what keeps a host that declares nothing behaving as before.
   */
  it('treats an absent frame-output declaration as usable and an unavailable one as not', () => {
    expect(decoderFrameOutputUsable()).toBe(true)
    expect(decoderFrameOutputUsable(undefined)).toBe(true)
    expect(decoderFrameOutputUsable({ frameConstructor: 'VideoFrame', available: true })).toBe(true)
    expect(decoderFrameOutputUsable({ frameConstructor: 'VideoFrame', available: false })).toBe(false)
  })
})
