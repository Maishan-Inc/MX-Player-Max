# Phase 8 Subtitle Kernel Implementation Plan

This plan implements the approved design in
`docs/superpowers/specs/2026-08-08-phase-8-subtitles-design.md`.

## 1. Public contracts

- Extend `@mx-player-max/types` with subtitle cues, styles, sources, tracks,
  diagnostics, limits, states, clock snapshots, events, SDK options, and stable
  `SUBTITLE_*` error codes.
- Add public API type tests before wiring behavior.

## 2. Pure parsers

- Add shared bounded parsing utilities and safe error conversion.
- Implement SRT parsing for BOM, newline variants, optional sequence numbers,
  multi-line text, common timestamps, limits, and stable diagnostics.
- Implement ASS/SSA sections, Format mapping, styles, dialogue comma handling,
  the approved override whitelist, and explicit unsupported-feature warnings.

## 3. Subtitle kernel services

- Implement external File/HTTPS loading with byte/time/CORS limits.
- Implement embedded packet conversion for Matroska UTF-8 and ASS/SSA tracks.
- Implement deterministic cue indexing, track lifecycle, async generation and
  epoch cancellation, style scoping/stores, and media-clock scheduling.
- Implement a safe DOM overlay using text nodes, bounded rAF, ResizeObserver,
  fullscreen refresh, and exact close cleanup.

## 4. Core and SDK integration

- Add a Core subtitle controller that owns an independent embedded Demux
  session, clock adapter, manager, and overlay lifecycle.
- Wire Native and Custom play/pause/seek/rate/EOS/source-replacement/close
  events without changing Phase 3-7 decoder, audio, renderer, or AI ownership.
- Expose track, external source, selection, close/remove, style, and overlay
  APIs through `MediaEngine` and `MXPlayer`.

## 5. Tests and documentation

- Add parser, source, track, clock, style, overlay, Core, SDK, and public API
  tests for normal, malformed, malicious, oversized, stale, and close paths.
- Update package READMEs, root README, CHANGELOG, architecture/security/browser
  compatibility documentation, and add Phase 8 acceptance notes.

## 6. Verification and delivery

- Run focused tests while implementing.
- Run `pnpm typecheck`, `pnpm test`, `pnpm build`, and `git diff --check`.
- Record that fake DOM/unit tests are not real browser validation.
- Commit the completed phase as
  `feat(subtitles): implement phase 8 subtitle pipeline`.
