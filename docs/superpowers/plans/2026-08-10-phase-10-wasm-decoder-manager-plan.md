# Phase 10 WASM Decoder Manager Implementation Plan

Status: completed on 2026-08-10 for the approved Manager + Plugin Factory scope.

This plan executes the approved design in
`docs/superpowers/specs/2026-08-10-phase-10-wasm-decoder-manager-design.md`.

## Scope

- Implement `@mx-player-max/decoder-wasm` as a standalone, injectable Manager.
- Add strict manifest validation, deterministic variant selection, URL safety,
  SHA-256 verification, memory/Cache Storage caching, failure memoization,
  registry ordering, plugin lifecycle, abort, and atomic fallback.
- Add public WASM error codes to `@mx-player-max/types`.
- Use fake plugins and runtimes in tests; do not add real WASM binaries or Core
  pipeline integration.
- Update public/package/architecture/acceptance documentation and changelog.

## Implementation order

### 1. Public contracts and fixtures

Files:

- `packages/types/src/index.ts`
- `packages/types/tests/public-api.test.ts` or a focused WASM public API test
- `packages/decoder-wasm/src/contracts.ts`
- `packages/decoder-wasm/src/errors.ts`

Tasks:

- Add the stable `WASM_*` error codes listed in the approved design.
- Keep existing `WasmVariant` and `WasmDecoderInstance` names source-compatible
  where possible, while adding plugin metadata and reset/lifecycle types only if
  required by the Manager contract.
- Define manifest, review, plugin descriptor, create context, cache, runtime,
  loader options, and Manager interfaces with strict optional-property semantics.
- Add error class/type conversion that never exposes response bodies.

Tests first:

- Assert all new error-code values are exported and stable.
- Assert the public decoder-wasm types compile through the package entry point.

### 2. Manifest validation and variant selector

Files:

- `packages/decoder-wasm/src/manifest.ts`
- `packages/decoder-wasm/src/variants.ts`
- `packages/decoder-wasm/tests/manifest.test.ts`
- `packages/decoder-wasm/tests/variants.test.ts`

Tasks:

- Validate bounded strings, supported variants, paired URL/hash entries,
  positive sizes, codec capability flags, profile/level/pixel/bit-depth values,
  and review status.
- Return normalized immutable data and reject malformed/unknown keys.
- Select `threaded`, `simd`, then `single` only when the snapshot and manifest
  permit each variant; never probe browser names or download resources here.

### 3. URL resolution, digest, cache, and verified asset loader

Files:

- `packages/decoder-wasm/src/cache.ts`
- `packages/decoder-wasm/src/loader.ts`
- `packages/decoder-wasm/tests/cache.test.ts`
- `packages/decoder-wasm/tests/loader.test.ts`

Tasks:

- Provide memory and optional Cache Storage cache implementations.
- Validate HTTP(S) base/variant URLs and keep relative assets under the configured
  base origin/path.
- Copy byte arrays before hashing/caching; use `crypto.subtle.digest` for SHA-256.
- Verify cached and fetched data before calling the injected runtime compiler.
- Include plugin/version/variant/hash/URL in cache keys.
- Dedupe concurrent asset loads per key and memoize verification failures.
- Support AbortSignal without turning cancellation into ordinary fallback.

### 4. Registry and Manager orchestration

Files:

- `packages/decoder-wasm/src/registry.ts`
- `packages/decoder-wasm/src/manager.ts`
- `packages/decoder-wasm/tests/registry.test.ts`
- `packages/decoder-wasm/tests/manager.test.ts`
- `packages/decoder-wasm/src/index.ts`

Tasks:

- Validate and register plugins, reject duplicate IDs, expose stable descriptors,
  and sort matching candidates by priority then ID.
- Enforce the review gate by default.
- Resolve plugin candidates, select variants, call the verified loader and then
  `plugin.create()` with a non-aborted signal.
- Try only one plugin/variant at a time; on hash, compile, or plugin-init failure
  record a structured attempt and atomically continue.
- Stop immediately for abort/closed errors; return a deterministic aggregate
  error when candidates are exhausted.
- Track successful instances for idempotent Manager close and release in-flight
  operations without double-closing instances.

### 5. Documentation and acceptance evidence

Files:

- `packages/decoder-wasm/README.md`
- `docs/architecture/wasm-and-distribution.md`
- `docs/architecture/codec-strategy.md`
- `docs/README.md`
- `docs/development/phase-10-acceptance.md`
- `CHANGELOG.md`

Tasks:

- Document public imports, fake/plugin registration shape, base URL rules,
  variant fallback, cache behavior, review gate, and stable errors.
- Record that no real binary is shipped and that Core integration and physical
  browser Codec verification remain pending gates.
- Add a fake-plugin diagnostic/test entry, with no dependency from Core or Demo.

### 6. Verification

Run from the repository root:

```text
pnpm --filter @mx-player-max/decoder-wasm test
pnpm typecheck
pnpm test
pnpm build
git diff --check
```

Before completion, inspect the dependency graph and package entry points to
confirm only `@mx-player-max/types` is imported by decoder-wasm, no real WASM
files were added, and all intended files are included in the acceptance record.
