# Phase 11 Browser Platform Optimization Implementation Plan

Status: completed on 2026-08-11.

This plan executes the approved Phase 11 scope in
`docs/development/execution-plan.md` and the detailed design in
`docs/superpowers/specs/2026-08-11-phase-11-browser-platform-optimization-design.md`.

## Implementation order

1. Define public platform enhancement, runtime adapter, issue rule, playback diagnostic, and WebCodecs acceleration observation contracts.
2. Add injectable runtime probes for HLS, HEVC, HDR display, ManagedMediaSource, AirPlay, PiP, fastSeek, standard playback quality, and Gecko counters.
3. Preserve Phase 1 Worker MediaSource and WebGPU external texture signals without duplicating capability ownership.
4. Implement candidate-local Chromium/WebKit/Gecko score hints and aggregate one adjustment per candidate.
5. Add strict negative issue rules with browser/version matching, HTTPS issue metadata, expiry, and regression sample references.
6. Add the Firefox Bugzilla #1918769 H.264 WebCodecs rule without changing capability support states.
7. Add bounded diagnostics that never infer hardware selection from support probes.
8. Add platform tests for missing features, version changes, expiry, invalid rules, immutable candidates, diagnostics, and generic fallback.
9. Update package/API/architecture/ADR/roadmap/changelog/acceptance documentation.
10. Run focused and repository-wide type, unit, build, browser, and diff verification.

## Files

- `packages/platform/src/contracts.ts`
- `packages/platform/src/runtime.ts`
- `packages/platform/src/enhancements.ts`
- `packages/platform/src/issues.ts`
- `packages/platform/src/diagnostics.ts`
- `packages/platform/src/policy.ts`
- `packages/platform/src/index.ts`
- `packages/platform/tests/platform.test.ts`
- `packages/platform/tests/fixtures/firefox-h264.ts`
- `packages/platform/README.md`
- `docs/decisions/ADR-0005-platform-policy-and-issue-rules.md`
- `docs/architecture/browser-strategy.md`
- `docs/development/phase-11-acceptance.md`
- `README.md`, `docs/README.md`, `CHANGELOG.md`
