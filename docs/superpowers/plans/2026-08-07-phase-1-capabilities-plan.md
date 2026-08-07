# Phase 1 Implementation Plan

This plan implements the approved design in `docs/superpowers/specs/2026-08-07-phase-1-capabilities-design.md`.

## Step 1: Expand the public contracts first

Files:

- `packages/types/src/index.ts`
- `packages/types/README.md`

Work:

- Add normalized platform, capability support, codec configuration, media probe result, media capability report, capability context, WASM decoder declaration, and platform score adjustment types.
- Extend track metadata with the concrete fields needed for browser configuration validation while retaining deprecated color fields.
- Version `CapabilitySnapshot`, add the media report to playback selection/context, and reserve `BackendKind = 'mse'` without generating MSE candidates.
- Add stable capability and strategy error codes without weakening strict compiler settings.

Verification: `pnpm --filter @mx-player-max/types typecheck` and a public-export compile test.

## Step 2: Implement environment and media probing

Files:

- `packages/capabilities/src/index.ts`
- `packages/capabilities/src/contracts.ts`
- `packages/capabilities/src/default-adapter.ts`
- `packages/capabilities/src/environment.ts`
- `packages/capabilities/src/media-report.ts`
- `packages/capabilities/src/cache.ts`
- `packages/capabilities/tests/capabilities.test.ts`
- `packages/capabilities/README.md`

Work:

- Introduce injectable browser API adapters and a default adapter that safely reads DOM/WebCodecs/WebGPU/WebAssembly APIs.
- Normalize browser family/major version and operating system without retaining the raw User-Agent.
- Probe WebGPU adapter features/limits, WebGL2/Canvas2D, MediaSource worker support, and inline WASM SIMD/thread primitives. Gate threads on cross-origin isolation and SharedArrayBuffer.
- Add `probeMediaCapabilities` for native MIME/codec, MediaCapabilities, and concrete WebCodecs video/audio configs. Normalize supported/unsupported/unknown states and stable reason codes.
- Add memory plus optional sessionStorage cache, canonical keys, SDK/schema isolation, force refresh, malformed-entry fallback, and in-flight de-duplication.
- Ensure no media source, fetch, decoder instance, GPU device, or WASM asset is created.

Verification: unit tests for missing APIs, adapter failures, config gaps, cache behavior, browser normalization, GPU branches, and zero-network/zero-decoder spies.

## Step 3: Make strategy scoring capability-driven and deterministic

Files:

- `packages/strategy/src/index.ts`
- `packages/strategy/tests/strategy.test.ts`
- `packages/strategy/README.md`

Work:

- Change the strategy input to a capability context containing the static snapshot, media report, and optional explicit WASM declarations.
- Generate native and WebCodecs candidates only when required tracks are supported and a renderer is available. Generate WASM only from an explicit decoder declaration.
- Preserve intent weights for normal/low-power, frame access, filters/editing, HDR, and AI while removing browser-name hardcoding.
- Apply platform score deltas through validated candidate IDs; never mutate caller arrays or candidate capability requirements.
- Implement stable tie-breaking by score, fixed backend priority, and candidate ID; return a typed no-viable-backend error.

Verification: deterministic repeatability, tie ordering, HDR/native preference, custom intent behavior, missing renderer/WebCodecs, non-isolated WASM, no candidate fabrication, no input mutation, and policy invariant tests.

## Step 4: Align platform policy with the score-only contract

Files:

- `packages/platform/src/index.ts`
- `packages/platform/tests/platform.test.ts`
- `packages/platform/README.md`

Work:

- Replace candidate-array replacement with score adjustments keyed by existing candidate IDs.
- Keep native HLS, ManagedMediaSource, fastSeek, WebGPU external-texture hints, and Gecko diagnostics as optional enhancement signals only.
- Ensure enhancement detection never changes capability booleans or creates a backend.

Verification: policy output contains only known IDs and finite deltas; disabling any optional enhancement leaves generic capability decisions intact.

## Step 5: Update architecture, change record, and acceptance evidence

Files:

- `docs/architecture/browser-strategy.md`
- `docs/development/phase-1-acceptance.md`
- `docs/development/release.md` or the repository change-record location identified during implementation
- relevant package READMEs

Work:

- Document the two-layer snapshot/report contract, result semantics, cache keys, and zero-network boundary.
- Record supported test commands, DOM-less fallback shape, browser smoke expectations, and deferred decoder/demux behavior.
- Add browser compatibility notes for concrete WebCodecs/MediaCapabilities probing.

## Step 6: Full verification

Run:

```text
pnpm typecheck
pnpm test
pnpm build
git diff --check
```

Review generated declarations and the final diff for `any`, cross-package internal imports, raw browser-name backend branches, network calls, WASM asset references, and unrelated changes.
