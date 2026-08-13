# Phase 13 Quality Hardening Implementation Plan

Date: 2026-08-12

## Gate

Phase 10.2 is implemented in the current working tree but still awaits its documented sub-phase review,
clean-room rebuild, and independent license/patent approval. Phase 13 therefore covers Native + WebCodecs.
WASM rows are `blocked-by-phase-10` and must not be populated with fake-runtime results.

## PR 1 - `test(quality): add reproducible media corpus`

1. Add a versioned media manifest schema and checked-in, clearly licensed minimal fixtures.
2. Add deterministic FFmpeg generation instructions and SHA-256/ffprobe verification.
3. Define a generated long-run asset workflow from a checked-in seed.
4. Add CI verification without downloading copyright-unclear media.

## PR 2 - `test(quality): verify postprocess numerics`

1. Add CPU reference oracles for warp, convolution, layer norm, unshuffle, and shuffle.
2. Assert known arrays and tolerances, packed graph topology, RT4KSR, and RIFE semantics.
3. Test unavailable/fallback/lost WebGPU passthrough, SDK quality events, and epoch cancellation.
4. Expose bounded pool diagnostics and prove long-run reuse does not grow allocations.

## PR 3 - `test(quality): exercise browser media paths`

1. Split UI and media Playwright projects.
2. Add an SDK media harness using manifest fixtures and sanitized observations.
3. Assert pixels, lifecycle, seek/buffer/end/error/reload, subtitles, surfaces, resize, and DPR.
4. Keep Playwright WebKit labeled as automation-only evidence.

## PR 4 - `test(quality): record real browser matrix`

1. Add a validated evidence schema and blank latest-two-stable matrix.
2. Add an environment collector for browser, OS, GPU, isolation, and sample hashes.
3. Record only browsers actually run; keep unavailable physical macOS Safari rows pending.
4. Reject simulated browser names in real-platform evidence.

## PR 5 - `test(quality): harden failure and stress cases`

1. Add deterministic Range/network/corrupt/truncated/duration-limit server routes and tests.
2. Cover device lost, suspended AudioContext, Worker termination, stale epochs, and bounded queues.
3. Assert stable error codes, atomic fallback, explicit terminal errors, and no silent black screen.
4. Add a configurable repeated-seek and memory-pressure smoke runner.

## PR 6 - `perf(core): add performance baselines`

1. Define metrics, units, environment fields, and baseline thresholds.
2. Add isolated/non-isolated collectors for startup, seek, buffering, drops, drift, CPU, memory, and power proxy.
3. Add a 30-minute scenario and a shorter collector smoke mode.
4. Store measured results only after a complete run; otherwise retain pending reasons.

## PR 7 - `test(quality): audit security and supply chain`

1. Verify MXAI and WASM provenance, hashes, licenses, build options, and review status.
2. Audit CSP, CORS/CORP, COOP/COEP, MIME, `nosniff`, subtitle text rendering, and URL boundaries.
3. Test evidence/log/event redaction for URLs, paths, subtitle input, and platform errors.
4. Fail release checks for publishable unapproved binary/model assets.

## PR 8 - `ci(quality): verify docker runtime contracts`

1. Extend Docker static checks for headers, MIME, Range, 404, and non-isolated behavior.
2. Run `docker compose build` and `scripts/release/docker-smoke.ps1` where Docker is available.
3. Persist runtime results with image digest and environment metadata.
4. Keep local Docker rows pending when the CLI is missing.

## PR 9 - `docs(development): close acceptance drift`

1. Generate current per-package Vitest counts into one evidence report.
2. Correct Phase 11/12 historical text and add an automated drift check.
3. Write Phase 13 acceptance with exact commands, hashes, results, and blockers.
4. Update testing, execution plan, roadmap, changelog, API/change coverage, and compatibility notes.

## Verification order

1. Focused postprocess, demux, Core, media-manifest, audit, and drift tests.
2. `pnpm typecheck` and `pnpm test` with generated count report.
3. `pnpm build` and media Playwright projects, then full `pnpm test:browser`.
4. Release/package checks, Docker smoke when available, and `git diff --check`.
5. Real latest-two-stable and 30-minute rows remain pending until their required environments run.
