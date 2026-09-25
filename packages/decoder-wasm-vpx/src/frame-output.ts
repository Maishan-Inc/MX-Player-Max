import type { DecoderFrameOutputDeclaration } from '@mx-player-max/types'

/**
 * The global this backend hands decoded planes over in, named once so that the frame factory in
 * `abi.ts` and the declaration the strategy layer reads can never disagree about which constructor
 * has to exist.
 */
export const WASM_FRAME_OUTPUT_CONSTRUCTOR = 'VideoFrame'

/**
 * Whether {@link WASM_FRAME_OUTPUT_CONSTRUCTOR} exists in the realm asked about. Defaults to the
 * current one, which is the decoder Worker when the frame factory calls it and the host realm when
 * the engine builds its capability context; `VideoFrame` is exposed to both or to neither.
 */
export function hasWasmFrameOutput(scope: object = globalThis): boolean {
  return typeof (scope as Record<string, unknown>)[WASM_FRAME_OUTPUT_CONSTRUCTOR] === 'function'
}

/**
 * What this backend needs from the realm before a decoded frame can leave linear memory, published
 * as data so the strategy layer can decline to rank it instead of letting a session reach `ready`
 * and then fail on the handover.
 *
 * libvpx decoding itself needs nothing from WebCodecs — Playwright's WebKit fetches the module,
 * instantiates it and decodes into WASM memory perfectly well, and only the `VideoFrame` wrapping
 * the planes is beyond it. A codec scope cannot express that, because the codec is not the problem.
 */
export function describeWasmFrameOutput(scope: object = globalThis): DecoderFrameOutputDeclaration {
  return { frameConstructor: WASM_FRAME_OUTPUT_CONSTRUCTOR, available: hasWasmFrameOutput(scope) }
}
