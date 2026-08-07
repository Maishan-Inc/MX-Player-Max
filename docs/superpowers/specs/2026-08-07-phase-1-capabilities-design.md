# Phase 1: Public Types and Capability Detection

Status: approved design
Date: 2026-08-07

## 1. Goal and scope

Phase 1 establishes the public media contract and browser capability snapshots used by later strategy and pipeline packages. It must produce useful results without loading a real decoder, downloading WASM, creating a decoder instance, or requesting media data.

In scope:

- Versioned public media, codec configuration, capability, event, error, and scoring types.
- A static environment snapshot for browser family/version, normalized operating system, API availability, renderer capability, and WASM runtime primitives.
- A media-specific report that validates a concrete `MediaDescriptor` with `HTMLVideoElement.canPlayType`, `navigator.mediaCapabilities.decodingInfo`, `VideoDecoder.isConfigSupported`, and `AudioDecoder.isConfigSupported` when those APIs exist.
- Capability caching isolated by SDK/schema version and normalized environment/query data.
- A deterministic strategy scorer and a platform policy contract that can change scores only for existing candidates.
- Unit tests, public API documentation, architecture updates, a change record, and a Phase 1 acceptance record.

Out of scope:

- Container parsing, Range loading, media requests, MSE/HLS/DASH pipelines, or real decoder initialization.
- WASM decoder manifests or binaries. Phase 1 may consume an explicit future decoder-availability declaration for scoring, but never infers codec support from the presence of WebAssembly alone.
- Native, WebCodecs, WASM, renderer, audio, subtitle, or UI pipeline implementations.

## 2. Package boundaries and data flow

`@mx-player-max/types` is the only source of public contracts. It contains no browser calls or platform branches.

`@mx-player-max/capabilities` owns environment probing, media configuration validation, cache access, result normalization, and stable reason/error identifiers. Browser APIs are hidden behind injectable adapters so the production implementation and tests share the same orchestration.

`@mx-player-max/strategy` consumes an environment snapshot, a media capability report, and optional explicit WASM decoder declarations. It generates only candidates whose required capability is confirmed or whose decoder declaration was supplied, scores them, applies platform score deltas, and returns a stable selection.

`@mx-player-max/platform` detects optional browser enhancements and implements the score-delta policy contract. It cannot add candidates, remove required capabilities, or claim codec support.

The runtime flow is:

```text
MediaDescriptor
      |
      v
normalize concrete video/audio codec configs
      |
      +--> HTMLVideo.canPlayType
      +--> MediaCapabilities.decodingInfo
      +--> VideoDecoder.isConfigSupported
      +--> AudioDecoder.isConfigSupported
      |
      v
MediaCapabilityReport
      |
      v
candidate factory -> deterministic scorer -> platform score deltas -> stable sort
```

`BackendKind` reserves `mse` for a later phase, but Phase 1 does not generate an MSE candidate.

## 3. Public type design

### 3.1 Time, track, and codec configuration

The existing microsecond timestamp alias remains the public unit. Track metadata is extended with the fields needed to build concrete WebCodecs and MediaCapabilities configurations without depending on demuxer internals: bitrate, profile/level where available, coded dimensions, frame rate, sample rate, channel count, codec private data, and structured color/HDR information. Existing deprecated color fields remain readable for compatibility.

Video and audio configuration types are SDK-owned structural types. They map to browser dictionaries internally and do not expose an unbounded `any` or require consumers to import DOM implementation types. Optional fields are omitted when the demuxer did not provide enough information to validate them.

### 3.2 Static capability snapshot

`CapabilitySnapshot` is versioned and contains only serializable environment data:

- capability schema and SDK version;
- browser family (`chromium`, `webkit`, `gecko`, or `unknown`) and normalized major version;
- normalized operating system/platform rather than the raw User-Agent string;
- `crossOriginIsolated`, `SharedArrayBuffer`, WASM SIMD, and isolation-gated WASM thread eligibility;
- coarse presence of HTML video, WebCodecs video/audio, MediaCapabilities, WebGPU, WebGL2, Canvas2D, and worker MediaSource;
- serializable WebGPU adapter limits, vendor/architecture, fallback-adapter status, and feature flags;
- sorted quirk identifiers.

The snapshot does not contain a timestamp, random value, raw User-Agent, GPU device name, or media-specific support conclusion. The existing fields remain source-compatible unless a field must be narrowed to a documented normalized value.

### 3.3 Media capability report

`MediaCapabilityReport` is separate from the static snapshot and is keyed to one normalized media query. Each API result uses:

```ts
type CapabilitySupport = 'supported' | 'unsupported' | 'unknown'
```

The report records independent native video/audio results, combined native-playability, MediaCapabilities `smooth` and `powerEfficient` hints when returned, and independent WebCodecs video/audio configuration results. A missing audio track does not make video-only media invalid; a present track must be supported for a combined backend to be viable.

An absent API yields a stable `unsupported`/unavailable reason. A thrown API call, incomplete configuration, or malformed response yields `unknown` and a stable probe-failure reason. No result is upgraded to `supported` because another API or browser family commonly supports the same codec.

### 3.4 Scoring and errors

Public scoring types include a candidate capability requirement list, immutable score/reason data, and:

```ts
interface PlatformScoreAdjustment {
  candidateId: string
  scoreDelta: number
  reasons: readonly string[]
}
```

Platform policies return adjustments, not replacement candidate arrays. Public error codes are expanded under stable capability and strategy namespaces (API unavailable, invalid configuration, probe failure, cache failure, no viable backend, and invalid platform adjustment) while preserving the existing AI renderer codes. `EngineError.code` continues to be a string-compatible public field, with the exported code constants providing the supported literal values.

## 4. Capability probing behavior

`detectCapabilities(options?)` performs only local feature checks. It may create a throwaway video element and 2D/WebGL2 contexts, validate small inline WASM feature modules, and request a WebGPU adapter. It never creates a `VideoDecoder`/`AudioDecoder`, requests a WebGPU device, assigns a media source, fetches a URL, or loads a WASM asset.

`probeMediaCapabilities(media, snapshot?, options?)` normalizes the media descriptor into browser-specific dictionaries and invokes available APIs. `canPlayType` receives the descriptor MIME/codec string; `decodingInfo` receives width, height, bitrate, and frame rate only when known; WebCodecs checks use the concrete codec and supplied description/private data. Calls that cannot be formed are reported as `unknown`, not guessed.

Browser identification is an optimization/diagnostic field only. It cannot select a backend or skip a capability call. Browser version parsing is deterministic and limited to a normalized major version. WebGPU probing uses adapter information and limits; external-texture support remains an optional later platform enhancement unless the runtime can prove it through the adapter/device contract without changing the zero-decoder boundary.

WASM SIMD and thread fields describe runtime primitives only. Threads are true only when the inline feature probe succeeds and both `crossOriginIsolated` and `SharedArrayBuffer` are available. This does not assert that any codec decoder exists.

## 5. Caching and determinism

The capabilities package exposes a small cache interface. The default is an in-memory cache with a browser `sessionStorage` adapter when available; storage errors and malformed entries are ignored. Snapshot and media-report entries use separate keys.

Keys include SDK version, capability schema version, normalized browser/version/platform, serializable GPU identity/limits, and a canonicalized media probe query for reports. `forceRefresh` bypasses and replaces the matching entry. Cache metadata such as write time is kept outside the returned snapshot/report so observable probe data stays deterministic.

All reason/error arrays are sorted. Candidate input arrays are copied before scoring. Final ordering is `score` descending, fixed backend priority, then candidate ID ascending. Ties therefore produce the same result for the same report and intent, independent of browser API completion order.

## 6. Strategy and platform invariants

The strategy engine receives a capability context containing the static snapshot, the media report, and optional explicit WASM availability declarations. Native candidates are generated only when the combined native result is supported. WebCodecs candidates require every present track's concrete configuration to be supported and a compatible renderer. WASM candidates require an explicit codec declaration; runtime WASM primitives only affect variant notes/score and never create decoder support.

The scorer applies the documented intent weights: normal/low-power playback favors native hardware/power efficiency; frame access, filters, editing, and AI favor custom frame access and an available renderer; HDR normal playback favors native color management. Unsupported candidates are omitted rather than assigned a low score.

Before applying a platform policy, the engine validates candidate IDs and finite score deltas. Unknown IDs and invalid deltas cannot change the candidate set. Platform reasons are appended in sorted order. The policy may improve or reduce a score but may not turn an unsupported candidate into a supported one.

## 7. Test matrix and acceptance

Vitest unit tests cover:

- strict public type compilation and stable exports;
- complete fallback snapshots with no DOM or navigator;
- browser/version/OS normalization and WebGPU adapter/no-adapter branches;
- WebGL2/Canvas2D absence, inline WASM SIMD/thread probes, and non-isolated thread gating;
- `canPlayType`, `decodingInfo`, `VideoDecoder.isConfigSupported`, and `AudioDecoder.isConfigSupported` supported/unsupported/unknown/throwing responses;
- missing track fields, video-only media, HDR metadata, and codec description normalization;
- cache hits, SDK/schema key isolation, malformed storage, concurrent requests, and force refresh;
- deterministic strategy ordering, no input mutation, no WebCodecs/WASM fabrication, and platform policy invariants;
- spies proving no fetch, media request, decoder construction, GPU device request, or WASM asset load.

The Phase 1 acceptance record documents `pnpm typecheck`, `pnpm test`, the generated snapshot shape in a DOM-less environment, and browser smoke coverage for current Chrome/Chromium, Firefox, and Safari desktop. It also records that real decoder, demuxer, MSE, and remote-media behavior are intentionally deferred to later phases.

## 8. Delivery artifacts

The implementation must update the public type and capability READMEs, the browser-strategy architecture document, a Phase 1 acceptance record, a change record, and any browser compatibility notes required by the new probes. Changes remain limited to public types, capabilities, strategy/platform contracts, tests, and these documents.
