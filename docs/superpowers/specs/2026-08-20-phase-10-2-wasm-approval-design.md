# Phase 10.2 WASM Approval and Distribution Design

Date: 2026-08-20
Status: Approved by project owner for implementation

## Decision

The three libvpx VP8 WASM variants are approved for the repository's
license/patent review gate based on the project owner's confirmation that the
required authorization has been obtained. This repository record is an
authorization record, not independent legal advice.

The distribution boundary is split by technical readiness:

- `single` and `simd` become publishable release assets.
- `threaded` remains excluded from Browser/Pages release assets because the
  Phase 10.2 plugin does not ship Emscripten pthread host glue. It remains a
  reviewed development asset and is attempted only in isolated sessions,
  where initialization failure must fall back to `simd` or `single`.

All three variants retain their exact upstream, compiler, build-flag, byte
length, SHA-256, license, and patent provenance. The approval does not expand
codec coverage beyond VP8 profile 0, 8-bit I420 video-only decoding.

## Boundaries

The implementation must keep these decisions aligned:

1. The VPX plugin manifest and supply-chain audit use `reviewStatus: approved`
   for all three variants.
2. The Browser release manifest contains only `single` and `simd` as
   publishable WASM assets. The `threaded` entry is explicitly excluded with
   a technical host-glue reason.
3. The npm package and Browser artifact checks may distribute approved
   `single`/`simd` WASM only through the existing manifest-controlled paths.
4. Runtime variant selection remains capability-driven. `threaded` is never
   selected without cross-origin isolation, SharedArrayBuffer, and WASM
   threads support, and failed initialization remains recoverable.
5. Existing BSD-3-Clause and WebM patent text stays vendored beside the
   assets. The approval record must link to both files and to the provenance
   record.

## Verification

The change must add or update tests for:

- approved WASM entries passing the supply-chain policy;
- publishable `single`/`simd` manifest entries carrying bytes, hashes, MIME,
  and SRI metadata;
- excluded `threaded` entry and its technical exclusion reason;
- package and Pages output containing no unlisted or excluded WASM; and
- runtime fallback behavior remaining unchanged.

The current environment does not have Emscripten installed, so this change
must not claim a clean-room rebuild. The existing `audit:wasm` command proves
the recorded bytes, hashes, imports, and exports only. A separately executed
Emscripten rebuild remains a release-evidence follow-up.

## Out of Scope

- implementing Emscripten pthread host glue;
- adding VP9, AV1, H.264, HEVC, audio, FFmpeg, or live-stream codecs;
- changing the PolyForm license for MX-Player-Max packages; or
- claiming physical Safari, Docker runtime, or latest-two-stable browser
  evidence that has not been run.
