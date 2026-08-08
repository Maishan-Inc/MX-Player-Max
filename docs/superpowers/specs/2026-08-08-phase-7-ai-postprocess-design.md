# Phase 7 AI Post-Processing Design

Date: 2026-08-08
Status: Approved

## Goal

Add a pull-based AI post-processing layer between decoded `VideoFrame` objects and the Phase 6 renderer. Phase 7 provides frame interpolation and 2x super-resolution, adapts quality to a bounded frame budget, validates and caches model assets, and always degrades to normal playback when AI cannot initialize or remain healthy.

The feature is available only to the Custom WebCodecs path with a usable, non-fallback WebGPU adapter. Native HTMLVideo candidates remain explicitly ineligible for AI.

## Boundaries

`@mx-player-max/postprocess` remains a leaf package. It depends only on public types and browser WebGPU/Web Crypto APIs. It does not import renderers, core, strategy, demux, decoder, audio, or UI packages. Core owns composition and lifecycle; the postprocess package knows only decoded frame and clock-facing contracts.

The pipeline is:

```text
DecodedFrameSource.peek
  -> RGB input texture
  -> optional RIFE interpolation
  -> optional RT4KSR x2 or Anime4K spatial stage
  -> PipelineFrame
  -> Phase 6 renderer
  -> subtitle overlay (Phase 8)
```

The presentation clock remains authoritative. `frameAt(t, epoch)` is the only pull entry point. The decoder frame source is non-consuming, and ownership is transferred only by an explicit `PipelineFrame` release boundary.

## Model Assets and Licensing

Assets use a versioned `MXAI` binary tensor format. The header contains a magic value, schema version, model id, precision, tensor count, and a bounded tensor table. Each tensor entry contains a name, rank, checked dimensions, byte offset, byte length, and element type. Parsers reject truncation, overflow, unknown element types, duplicate names, and offsets outside the payload.

The manifest mirrors the WASM manifest pattern and records model, version, tier, precision variants, SHA-256 per variant, license, upstream URL plus immutable commit, build flags, patent risk, required WebGPU features, and a release-review status. The loader uses a caller-provided base URL or `aiModelBaseUrl`, performs lazy fetch, verifies SHA-256 with Web Crypto, and stores verified blobs in versioned Cache Storage when available. A failed URL/hash is remembered for the session to avoid retrying a known-bad asset. Responses are treated as opaque bytes only.

RIFE uses the MIT-licensed Practical-RIFE upstream at commit `17d8c7a1005b37f4c97bfee04e316aaec7fdc536`. RT4KSR is loaded only after its exact upstream commit, redistribution terms, training-data notice, and patent review are recorded. An unresolved review keeps the manifest entry non-publishable and prevents automatic selection. Converted weights are derived artifacts, not silently relabeled as upstream files.

## GPU Runtime

The runtime uses a fixed compute graph and WGSL kernels rather than a general-purpose inference dependency. A graph manifest maps model layers to bounded convolution, activation, warp, blend, and x2 reconstruction passes. Weights are uploaded once to storage buffers for the selected precision. Activations and stage outputs use a fixed-capacity texture pool; no per-frame unbounded allocations are permitted.

RIFE requires two source frames and an arbitrary phase. It exposes `lookaheadFrames = 1`, keeps a bounded A/B cache, and checks the captured epoch after every asynchronous GPU submission. A stale result is released and never reaches the renderer. At EOS, the final decoded frame is held rather than synthesised without a successor.

RT4KSR and Anime4K are one-in/one-out stages. RT4KSR is the default photographic x2 stage; Anime4K is selected only when `float32-filterable` is available and the content policy requests the animation model. Every output validates safe dimensions against the renderer and adapter limits before allocation.

The chain catches model, shader, command encoding, queue, and device-loss failures. It transitions atomically to passthrough, emits an AI error/reason, releases in-flight resources exactly once, and preserves the decoder, audio clock, and current playback epoch.

## Governor

The frame-budget governor is stateful and lives in postprocess. It measures stage time using timestamp queries when available, otherwise a bounded wall-clock measurement. The default budget is `1000 / displayHz * frameBudgetRatio`, with a ratio of `0.6`.

Every 30 samples, a median above 85% of budget degrades immediately. The order is: disable interpolation, lower super-resolution tier (`ultra` to `low`), then disable super-resolution. A median below 50% for 10 seconds permits one-step recovery, with no more than one recovery per 30 seconds. Seek/reset freezes decisions and clears the window. A device loss forces `off` and passthrough. Each tier transition emits `qualitychange` with a stable reason; no degradation is silent.

## Core and SDK Integration

Strategy keeps `ai-enhance` deterministic: it excludes Native HTMLVideo and accepts only a WebCodecs candidate whose renderer is WebGPU and whose snapshot is not a fallback adapter. It proposes a starting `AiQualityTier` from immutable capabilities; governor calibration may lower it at runtime.

Core creates the postprocess chain after Custom pipeline and renderer initialization, injects the decoded-frame source and WebGPU device, and gives the render loop a `frameAt(clock.mediaTime, clock.epoch)` dependency. Seek, pause, source replacement, EOS, and close reset or close the chain before releasing decoder-owned resources. Renderer receives only the final frame. Existing custom frame access remains available when AI is disabled; native frame access remains rejected.

The public types add AI runtime state/stats and keep `aiPostProcess` as the sole configuration entry. `qualitychange` remains the public notification. AI errors use the existing `RENDERER_AI_*` namespace and never expose raw frames, textures, model URLs, or platform exception objects.

## Error and Fallback Rules

- No WebGPU or fallback adapter: strategy does not select an AI plan. If a verified WebCodecs custom path exists, the load continues with a passthrough chain and emits a recoverable `RENDERER_AI_UNSUPPORTED` notification; if no custom path exists, an explicit `ai-enhance` request fails with that recoverable error. Native HTMLVideo is never selected as an AI fallback.
- Model fetch, schema, license gate, or hash failure: emit `RENDERER_AI_MODEL_LOAD_FAILED` or `RENDERER_AI_MODEL_HASH_MISMATCH`, then use passthrough.
- Shader/graph/command failure: emit `RENDERER_AI_PIPELINE_FAILED`, then use passthrough.
- Budget or device loss: emit the stable AI reason, set tier to `off`, preserve playback, and continue with decoded frames.
- Stale epoch or close: release the result and suppress all late events.

## Verification

Unit tests cover manifest validation, MXAI parsing, SHA-256/cache/abort behavior, governor thresholds and hysteresis, texture-pool exact release, WGSL graph validation, RIFE phase/seek/EOS semantics, RT4KSR x2 dimensions, chain fallback, and device loss. Core and SDK integration tests cover strategy gating, event payloads, render-loop pull semantics, and lifecycle cleanup. The phase exit gate runs `pnpm typecheck`, `pnpm test`, `pnpm build`, and `git diff --check`; real Chrome/Firefox/Safari WebGPU smoke remains explicitly recorded per environment.
