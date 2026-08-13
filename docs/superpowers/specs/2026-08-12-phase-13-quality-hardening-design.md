# Phase 13 Quality, Security, and Performance Hardening Design

Date: 2026-08-12

## 1. Decision and evidence boundary

Phase 13 closes accumulated acceptance debt with reproducible evidence. It does not redefine simulated
results as platform results and it does not lower thresholds to make a matrix green.

The working tree contains a Phase 10.2 VP8 vertical slice, real restricted libvpx WebAssembly binaries,
Core integration, and Playwright coverage. However, `docs/development/phase-10-acceptance.md` still says
that Phase 10.2 is waiting for sub-phase review, clean-room reproducibility, and independent license and
patent review. Phase 10.2 therefore has not passed its gate for Phase 13. The Phase 13 release matrix covers
Native and WebCodecs. Every WASM playback, long-run, and distribution row is `blocked-by-phase-10`; fake
runtimes and the restricted VP8 slice may be used only as lower-level regression evidence.

Evidence has four non-interchangeable levels:

1. Vitest and Node contract tests prove deterministic logic, fault mapping, epochs, resource bounds, hashes,
   and reference numerical results.
2. Playwright media projects prove behavior inside the shipped Playwright Chromium, Firefox, and WebKit
   processes with real media bytes. Playwright WebKit never counts as macOS Safari.
3. Structured performance runs prove only the recorded browser, OS, GPU, isolation mode, sample hash, and
   duration. A run shorter than 30 minutes cannot close a 30-minute gate.
4. Manual real-browser records prove latest-two-stable Chrome/Chromium, Firefox, and physical macOS Safari
   only when full environment metadata and sample hashes are present.

## 2. Media corpus

`tests/media/manifest.json` is the source of truth. Each row records container, video codec/profile/bit
depth, audio codec, subtitle format, duration, source, license, SHA-256, reproduction command, intended
backend, and evidence status.

Small deterministic fixtures are committed directly so pull requests and offline CI execute the same bytes.
They are generated from an auditable synthetic test pattern and tone or derived from the existing CC0 MDN
flower asset. Long-duration assets are not committed: the performance runner loops a checked-in seed and
records the seed hash, loop parameters, and produced file hash. This avoids Git LFS/network availability
while keeping long-run input reproducible. The manifest verifier fails on an unknown license, missing hash,
hash mismatch, unbounded URL, or media metadata drift.

## 3. Postprocess correctness

The postprocess package gains a deterministic CPU numerical oracle for the algorithms encoded in WGSL:
bilinear warp, convolution, layer normalization, pixel unshuffle, and pixel shuffle. Tests compare known
inputs with explicit expected arrays and tolerances. Tiny packed graphs verify channel packing, residuals,
activation, and shuffle order independently of model parsing. RT4KSR and RIFE tests additionally validate
the checked-in model graphs and temporal blend semantics.

GPU integration remains separately observable. Browser conformance dispatches real WGSL when WebGPU is
available and reports `unsupported`, rather than passing, when no adapter exists. Fault-injection tests cover
no WebGPU, fallback adapter policy, device loss, and rejected GPU work. `AiPipeline` must emit an error and a
fallback event, then return the upstream frame without changing the audio clock. Tier changes continue through
the Core `qualitychange` event. Epoch changes discard late temporal and spatial results. Texture and packed
tensor pools expose bounded diagnostics so long-running acquire/release tests can prove allocation is capped.

## 4. Browser media automation

Playwright keeps UI tests and adds separate media projects. The media harness exposes the SDK instance and a
sanitized observation record, then tests:

- Native video and WebCodecs canvas selection with real manifest fixtures;
- non-empty decoded pixels, play, pause, seek, buffer, ended, error, and source replacement;
- external SRT/ASS cue timing;
- video/canvas surface dimensions, resize, and DPR;
- Range `206`, incorrect `200`, invalid `Content-Range`, truncation, disconnect, and corrupt media routes.

A capability-dependent skip is recorded as unsupported evidence, not a passing backend. Native and custom
surface consistency compares timing, dimensions, and non-empty image statistics; it does not require byte-
identical pixels across independent decoders and color pipelines.

## 5. Fault and privacy contracts

Each supported fault has a stable public error code and an explanatory recovery action. Tests inject network
loss, invalid Range responses, corrupt/truncated containers, duration/size limits, GPU loss, suspended audio,
and terminated workers. Recoverable backend initialization failures use the existing atomic candidate fallback;
terminal errors leave an explicit error state rather than a black surface.

Public errors, events, logs, and generated evidence pass through a redaction audit. They may contain stable
codes, bounded counters, origins, and normalized browser metadata. They must not contain full query strings,
credentials, local paths, raw platform exception text, subtitle markup, or media payload bytes. Subtitle DOM
rendering remains text-only and ASS parsing remains whitelist-based.

## 6. Performance evidence

Performance output uses a versioned JSON schema. It records first frame, first audio, first subtitle, seek
latency, buffered-ahead, dropped frames, A/V drift, CPU time, JS/UA memory when exposed, and a documented
power proxy. Baseline thresholds are explicit and directional; unsupported metrics are `null` with a reason.
Isolated and non-isolated runs are separate records.

The 30-minute scenario samples drift and memory at fixed intervals and fails on unexplained monotonic memory
growth, excessive final drift, or a threshold regression against an approved baseline. Short local smoke runs
validate the collector only and remain insufficient for the 30-minute acceptance row.

## 7. Supply chain and Docker

The quality audit verifies the RIFE and RT4KSR MXAI hashes, upstream references, license texts, build/conversion
metadata, review status, and release-manifest inclusion policy. It audits every WASM manifest found in the
working tree but cannot approve Phase 10 assets. CSP, CORS/CORP, COOP/COEP, MIME, Range, `nosniff`, subtitle
injection, and privacy rules have static tests. Runtime Docker claims require `docker compose build` and
`scripts/release/docker-smoke.ps1`; without a Docker CLI they stay pending with the exact missing prerequisite.

## 8. Drift prevention and acceptance

Test totals are generated from Vitest JSON output and stored as an evidence artifact, not copied into multiple
phase documents. `scripts/quality/check-acceptance-drift.mjs` rejects stale literal totals in Phase 11/12 and
validates that Phase 13 references the generated report. Phase 11 and 12 are corrected to their historical
counts and labeled historical snapshots; current counts live only in the generated Phase 13 evidence.

Phase 13 acceptance is complete only when every P0/P1 real-browser row, both isolation modes, the 30-minute
run, Docker runtime smoke, public API/change records, and approved WASM provenance gates pass. Until then the
phase document reports the exact completed automation plus concrete pending and blocked reasons.

## 9. Out of scope

HLS/DASH, PGS/VobSub, full libass, mobile compatibility, DRM, playlists, next-episode behavior, and new codec
implementation remain outside Phase 13. Quality tooling must not add a proxy or upload local media.
