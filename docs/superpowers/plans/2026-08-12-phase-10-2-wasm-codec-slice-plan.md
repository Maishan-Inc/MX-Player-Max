# Phase 10.2 WASM Codec Vertical Slice Implementation Plan

> **Execution rule:** Implement only Phase 10.2. Keep VP9/AV1/other video codecs, WASM audio, FFmpeg, streaming, Renderer, AI, subtitle, and UI work pending.

**Goal:** Decode a real, provenance-recorded, video-only VP8 WebM through verified libvpx WASM in a Worker, feed the existing Custom Pipeline, and render a non-empty frame while preserving epoch, backpressure, ownership, fallback, and release-review boundaries.

**Architecture:** Extract the existing backend-neutral Decoder Worker control plane into `@mx-player-max/decoder-worker`; extend `decoder-wasm` with a real compile/instantiate runtime and frame-producing instance contract; add a restricted `@mx-player-max/decoder-wasm-vpx` plugin implementing MXWF ABI v1; inject either WebCodecs or WASM adapters into the unchanged Custom Pipeline; expose restricted declarations only when `wasmBaseUrl` is explicit.

**Toolchain:** TypeScript 5.8, Vitest 3, Playwright, Emscripten, libvpx v1.15.2, WebAssembly, Web Workers, WebCodecs `VideoFrame`.

---

## Task 1: Freeze Public Contracts And Tests

**Files:**
- Modify: `packages/types/src/index.ts`
- Modify: `packages/types/tests/wasm-public-api.test.ts`
- Modify: `packages/decoder-wasm/src/contracts.ts`
- Modify: `packages/decoder-wasm/src/manager.ts`
- Modify: `packages/decoder-wasm/src/index.ts`
- Modify: `packages/decoder-wasm/tests/manager.test.ts`
- Create: `packages/decoder-wasm/tests/runtime.test.ts`

**Steps:**
1. Add stable WASM runtime/worker/ABI error codes and no unsafe event payloads.
2. Extend `WasmDecoderRuntime` with `instantiate()` and export `BrowserWasmDecoderRuntime`.
3. Add runtime and frame/error/dequeue callbacks to create context.
4. Add `decodeQueueSize` and `reset()` to decoder instances while retaining packet alias compatibility.
5. Update Manager validation/wrapping so partial initialization and close remain exactly-once.
6. Add real minimal-module compile/instantiate tests and update fake helpers.
7. Run `pnpm --filter @mx-player-max/types test` and `pnpm --filter @mx-player-max/decoder-wasm test`.

## Task 2: Extract The Shared Decoder Worker Control Plane

**Files:**
- Create: `packages/decoder-worker/package.json`
- Create: `packages/decoder-worker/tsconfig.json`
- Create: `packages/decoder-worker/README.md`
- Create: `packages/decoder-worker/LICENSE`
- Create: `packages/decoder-worker/src/index.ts`
- Move/adapt: worker contracts, protocol, adapter, and controller from `packages/decoder-webcodecs/src/`
- Create: `packages/decoder-worker/tests/decoder-worker.test.ts`
- Modify: `packages/decoder-webcodecs/package.json`
- Modify: `packages/decoder-webcodecs/src/index.ts`
- Modify: `packages/decoder-webcodecs/src/worker-entry.ts`
- Modify: `packages/decoder-webcodecs/tests/decoder-worker.test.ts`

**Steps:**
1. Copy the existing tests to the new package before moving implementation.
2. Generalize configure payload to a discriminated backend config without weakening identity validation.
3. Preserve transfer lists, pending-frame timestamp matching, epoch reset, EOS flush, stale close, timeout, and sanitized error behavior.
4. Re-export compatibility types/classes from `decoder-webcodecs` public entry.
5. Point the WebCodecs Worker entry at the shared controller plus WebCodecs adapter factory.
6. Remove duplicated control-plane implementations after imports compile.
7. Run both package test suites and typechecks.

## Task 3: Build And Audit Real libvpx WASM Assets

**Files:**
- Create: `packages/decoder-wasm-vpx/native/mxwf_vpx.c`
- Create: `packages/decoder-wasm-vpx/scripts/build-wasm.mjs`
- Create: `packages/decoder-wasm-vpx/scripts/audit-wasm.mjs`
- Create: `packages/decoder-wasm-vpx/third_party/libvpx/LICENSE`
- Create: `packages/decoder-wasm-vpx/third_party/libvpx/PATENTS`
- Create: `packages/decoder-wasm-vpx/wasm/libvpx-vp8-single.wasm`
- Create: `packages/decoder-wasm-vpx/wasm/libvpx-vp8-simd.wasm`
- Create: `packages/decoder-wasm-vpx/wasm/libvpx-vp8-threaded.wasm`
- Create: `packages/decoder-wasm-vpx/wasm/PROVENANCE.md`

**Steps:**
1. Bootstrap a pinned Emscripten toolchain outside the repository.
2. Fetch libvpx tag `v1.15.2` and verify commit `d168454...`.
3. Implement MXWF ABI v1 with bounded allocations, explicit frame tokens, reset, drain, destroy, and debug counters.
4. Build VP8-decoder-only single, SIMD, and threaded variants with fixed flags and bounded memory.
5. Audit imports/exports, byte sizes, SHA-256, ABI version, and absence of filesystem/network imports.
6. Record exact toolchain, commands, flags, source commit, license, PATENTS, hashes, and `restricted` review.
7. Run the asset audit script from a clean process.

## Task 4: Implement The VP8 Plugin And Frame ABI Adapter

**Files:**
- Create: `packages/decoder-wasm-vpx/package.json`
- Create: `packages/decoder-wasm-vpx/tsconfig.json`
- Create: `packages/decoder-wasm-vpx/README.md`
- Create: `packages/decoder-wasm-vpx/LICENSE`
- Create: `packages/decoder-wasm-vpx/src/index.ts`
- Create: `packages/decoder-wasm-vpx/src/manifest.ts`
- Create: `packages/decoder-wasm-vpx/src/abi.ts`
- Create: `packages/decoder-wasm-vpx/src/plugin.ts`
- Create: `packages/decoder-wasm-vpx/src/worker-adapter.ts`
- Create: `packages/decoder-wasm-vpx/src/worker-controller.ts`
- Create: `packages/decoder-wasm-vpx/src/worker-entry.ts`
- Create: `packages/decoder-wasm-vpx/tests/abi.test.ts`
- Create: `packages/decoder-wasm-vpx/tests/plugin.test.ts`
- Create: `packages/decoder-wasm-vpx/tests/worker.test.ts`

**Steps:**
1. Define restricted manifest entries using audited asset sizes and hashes.
2. Validate all MXWF descriptor, plane, timing, dimension, color, and memory ranges before constructing frames.
3. Construct I420 `VideoFrame` with preserved layout/visible/display/color metadata, then release the token in `finally`.
4. Implement plugin support matching, instantiate/export validation, decode/drain/reset/close, queue callbacks, and safe errors.
5. Implement a WASM Worker factory using the shared controller and no duplicate queue/epoch logic.
6. Test malformed ABI, non-16-aligned planes, color precedence, real module instantiate/decode, reset, leaks, and exactly-once ownership.
7. Run package build, typecheck, tests, and asset audit.

## Task 5: Add A Licensed Real Media Fixture

**Files:**
- Create: `packages/decoder-wasm-vpx/tests/fixtures/webm-vp8-p0-8bit-642x358.webm`
- Create: `packages/decoder-wasm-vpx/tests/fixtures/PROVENANCE.md`
- Create: `packages/decoder-wasm-vpx/tests/real-decode.test.ts`

**Steps:**
1. Generate the video-only non-16-aligned fixture from the existing MDN CC0 source with a pinned ffmpeg command.
2. Record source/output hashes, CC0, dimensions, profile, bit depth, no-audio fact, command, and tool version.
3. Demux through `@mx-player-max/demux`, pass actual packets to the real WASM plugin, and assert non-empty I420 frame data.
4. Verify EOS drain returns all frames and close leaves zero live frame allocations/bytes.
5. Run the real-decode test independently and twice consecutively to catch retained state.

## Task 6: Integrate Strategy And Core Atomic Fallback

**Files:**
- Modify: `packages/capabilities/src/index.ts`
- Modify: `packages/capabilities/tests/capabilities.test.ts`
- Modify: `packages/core/package.json`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/src/custom/pipeline.ts`
- Modify: `packages/core/tests/backend-fallback.test.ts`
- Create: `packages/core/tests/wasm-backend.test.ts`
- Modify: `packages/strategy/tests/strategy.test.ts`

**Steps:**
1. Allow `createCapabilityContext()` to receive immutable WASM declarations.
2. Create no Manager/plugin/declaration when `wasmBaseUrl` is absent.
3. With explicit `wasmBaseUrl`, expose only the restricted VP8 video declaration for that session.
4. Inject the selected decoder adapter into Custom Pipeline; keep all queue, seek, EOS, and pull behavior unchanged.
5. Handle `kind: 'wasm'` in the existing candidate scope and ensure failed candidate resources close before fallback.
6. Test WebCodecs failure to real/fake-WASM commit, threaded-to-single fallback, stale epoch frame rejection, no audio candidate, no unselected download, and trace ordering.
7. Run capabilities, strategy, core, decoder-wasm, and decoder-wasm-vpx tests together.

## Task 7: Browser Rendering And Release Exclusion

**Files:**
- Create/modify: focused Playwright WASM tests and test server fixtures
- Modify: `scripts/release/generate-manifest.mjs` tests only if needed to assert exclusion
- Modify: `packages/browser` release tests only if needed to assert exclusion

**Steps:**
1. Serve isolated and non-isolated fixture pages with correct WASM MIME and Range support.
2. Verify non-isolated playback never requests threaded and renders non-empty Canvas pixels.
3. Verify isolated threaded selection and controlled threaded-init failure fallback without interruption.
4. Verify consecutive seek never renders old epoch and queue/memory counters remain bounded.
5. Assert release manifest has no VP8 WASM publishable entry or file.
6. Record physical Safari as pending unless real macOS Safari evidence is available.

## Task 8: Documentation, Counts, And Full Gates

**Files:**
- Modify: `packages/decoder-wasm/README.md`
- Modify: `packages/core/README.md`
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/development/phase-10-acceptance.md`
- Modify: `docs/development/execution-plan.md`
- Modify: `docs/development/roadmap.md`
- Modify: `docs/architecture/wasm-and-distribution.md`

**Steps:**
1. Document explicit restricted opt-in, video-only VP8 coverage, worker/ABI ownership, and non-release status.
2. Record exact source/test line counts, exact test count, fixture/asset hashes, sources, licenses, flags, and browser evidence.
3. Mark only Phase 10.2 complete; keep 10.3, 10.4, 10.5, publication, and unavailable physical Safari checks pending.
4. Run `pnpm typecheck`.
5. Run `pnpm test`.
6. Run `pnpm build`.
7. Run `pnpm test:browser`.
8. Run asset/provenance/release-exclusion audits and `git diff --check`.
9. Review the final diff for cross-package private imports, browser-name branches, unsafe event payloads, release inclusion, and unrelated changes.
