# Phase 2 Implementation Plan

This plan implements the approved design in `docs/superpowers/specs/2026-08-07-phase-2-range-container-design.md`.

## Step 1: Extend public contracts first

Files:

- `packages/types/src/index.ts`
- `packages/types/tests/public-api.test.ts`
- `packages/types/README.md`

Work:

- Add byte-range, read-result, retry, cache, packet, and error-code contracts.
- Keep unknown numeric packet duration nullable and document all byte/time units.
- Preserve every Phase 1 capability and strategy contract unchanged.

Verification: `pnpm --filter @mx-player-max/types test` and `pnpm --filter @mx-player-max/types typecheck`.

## Step 2: Implement bounded Range loading

Files:

- `packages/demux/src/range/types.ts`
- `packages/demux/src/range/errors.ts`
- `packages/demux/src/range/validation.ts`
- `packages/demux/src/range/scheduler.ts`
- `packages/demux/src/range/cache.ts`
- `packages/demux/src/range/file-loader.ts`
- `packages/demux/src/range/http-loader.ts`
- `packages/demux/tests/range-loader.test.ts`

Work:

- Validate safe integer ranges and controlled HTTP headers.
- Add close-aware FIFO concurrency, abortable retry delays, and bounded LRU storage.
- Read exact File slices and strict HTTP 206 responses.
- Pin ETag/source length, reject redirects and 200 responses, and redact URL diagnostics.

Verification: focused Range Loader tests plus package typecheck.

## Step 3: Add bounded container infrastructure

Files:

- `packages/demux/src/containers/limits.ts`
- `packages/demux/src/containers/bounded-reader.ts`
- `packages/demux/src/containers/registry.ts`
- `packages/demux/src/index.ts`

Work:

- Export the stable RangeLoader, ContainerAdapter, ContainerProbeResult, and Demuxer contracts.
- Add configurable parsing budgets and checked offset arithmetic.
- Select containers from bytes, allowing EBML candidates to resolve through DocType.

Verification: public-export compile coverage and malformed-header tests.

## Step 4: Implement EBML, Matroska, and WebM

Files:

- `packages/demux/src/containers/ebml/ids.ts`
- `packages/demux/src/containers/ebml/reader.ts`
- `packages/demux/src/containers/ebml/blocks.ts`
- `packages/demux/src/containers/ebml/matroska-adapter.ts`
- `packages/demux/src/containers/ebml/webm-adapter.ts`
- `packages/demux/tests/fixtures/ebml.ts`
- `packages/demux/tests/container-matroska.test.ts`
- `packages/demux/tests/container-webm.test.ts`

Work:

- Parse bounded EBML IDs, sizes, scalar values, unknown-size Segment/Cluster, tracks, blocks, and Cues.
- Output individual packets for supported lacing modes.
- Use Cues for seek and a byte-budgeted Cluster scan when Cues are absent.
- Keep unknown Codec IDs truthful and distinguish WebM by DocType.

Verification: hand-built fixtures covering tracks, packets, Cues, no-Cues fallback, varint failures, truncation, and limits.

## Step 5: Implement ISO BMFF / MP4

Files:

- `packages/demux/src/containers/mp4/boxes.ts`
- `packages/demux/src/containers/mp4/sample-table.ts`
- `packages/demux/src/containers/mp4/mp4-adapter.ts`
- `packages/demux/tests/fixtures/mp4.ts`
- `packages/demux/tests/container-mp4.test.ts`

Work:

- Walk 32-bit, 64-bit, and size-zero boxes without buffering mdat.
- Parse movie/track headers, sample descriptions, timestamps, chunk mapping, sample sizes, offsets, and sync samples.
- Build validated sample indexes and read packets in decode order with presentation timestamps.
- Detect fragmented MP4 without creating MSE or fabricating complete indexes.

Verification: faststart, tail-moov, sample packet, 64-bit box, size-zero, truncated table, overflow, and budget tests.

## Step 6: Implement Worker lifecycle

Files:

- `packages/demux/src/worker/protocol.ts`
- `packages/demux/src/worker/controller.ts`
- `packages/demux/src/worker/entry.ts`
- `packages/demux/package.json`
- `packages/demux/tests/worker-lifecycle.test.ts`

Work:

- Add serializable start/read/seek/close messages with session, request, and epoch identity.
- Transfer packet buffers within a bounded message size.
- Abort and release Loader/Demuxer/cache state on close and suppress stale async results.
- Export an explicit worker subpath without creating a Worker as an import side effect.

Verification: close while start/read is pending, stale seek epochs, idempotent close, and zero post-close packet messages.

## Step 7: Complete parity and adversarial coverage

Files:

- all required `packages/demux/tests/*.test.ts`
- fixture helpers under `packages/demux/tests/fixtures/`

Work:

- Compare File and mocked HTTP output for identical fixture bytes.
- Cover retry exhaustion, cache eviction, concurrency limits, unknown total length, and source mutation.
- Cover element/box size, depth, track, packet, keyframe, scan, and Worker message budgets.
- Assert tests never use a real network or decoder/WASM API.

Verification: `pnpm --filter @mx-player-max/demux test` and package typecheck.

## Step 8: Update public documentation and acceptance evidence

Files:

- `packages/demux/README.md`
- `docs/architecture/codec-strategy.md`
- `docs/architecture/security-and-privacy.md`
- `docs/development/phase-2-acceptance.md`
- `CHANGELOG.md`

Work:

- Document the Range contract, strict HTTP behavior, parser limits, supported metadata, and fMP4 boundary.
- Record automated evidence separately from the pending real-browser smoke matrix.
- State explicitly that Phase 2 loads no decoder, renderer, MSE, or WASM asset.

## Step 9: Full verification and scope audit

Run:

```text
pnpm typecheck
pnpm test
pnpm build
git diff --check
```

Review declarations and the final diff for `any`, cross-package internal imports, full-file remote reads, unsafe URL logging, decoder/WebCodecs/WASM references, unbounded loops or allocations, and unrelated changes.
