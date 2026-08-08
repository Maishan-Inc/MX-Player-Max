# Phase 6 Renderer Design

## Scope

Phase 6 connects the existing Demux Worker and WebCodecs video decoder to a bounded presentation loop backed by WebGPU, WebGL2, or Canvas2D. It preserves the Phase 4 pull API, epoch rules, and VideoFrame ownership contract, and it continues to use the Phase 5 audio sample clock or media wall clock. AI processing, subtitles, WASM decoding, streaming, recording, DRM, and player controls remain out of scope.

## Public Contract

The types package gains additive renderer preferences, filter and transform options, renderer capabilities, state, statistics, safe renderer events, and stable `RENDERER_*` error codes. `CustomVideoOptions` accepts renderer, render, filter, and HDR preferences. `MediaEngine` and `MXPlayer` expose read-only renderer state and statistics plus runtime filter and transform setters. Existing properties and methods retain their meaning.

`readVideoFrame()` remains an immediate pull and transfers ownership to its caller. During rendered playback, an external pull and the internal render loop intentionally compete for the next decoded frame through the existing FIFO reader boundary; frames are never cloned, broadcast, or consumed twice. This is documented as explicit frame interception.

## Renderer Package

`packages/renderers` depends only on public types. Shared validation normalizes dimensions, DPR, crop, rotation, filters, and color metadata. Backends use fixed shader programs and bounded resources:

- WebGPU imports a VideoFrame as an external texture, uses a fixed WGSL pipeline, and performs no GPU-to-CPU readback.
- WebGL2 uploads a VideoFrame into one reusable texture and draws through a fixed GLSL program without `readPixels`.
- Canvas2D uses `drawImage` plus standard transforms and filters without `getImageData`.

The managed renderer factory uses WebGPU, WebGL2, then Canvas2D for `auto`. An explicitly requested backend fails with a stable error if initialization is unavailable. A runtime device or context loss first attempts one rebuild; failure emits a safe fallback event and atomically replaces the backend. WebGL2 and Canvas2D never claim HDR preservation. WebGPU reports HDR preservation only when frame metadata, canvas format, and device support jointly prove it.

## Core Integration

Core receives a renderer through a public factory boundary and does not contain graphics API code. A separately testable requestAnimationFrame loop allows one pending decoded frame and one in-flight frame read. The Phase 5 scheduler decides wait, present, or drop against the audio sample clock when audio exists and the wall clock otherwise. Wait retains the frame, present transfers it to the renderer for exactly-once close, and drop or stale cleanup closes it in Core.

Pause cancels the animation frame and stops new reads. Resume creates one loop. Seek cancels the old loop, invalidates its generation, closes retained or late frames, lets the custom pipeline advance its epoch, and resumes only after the new epoch is ready. Playback rate changes only clock mapping. Renderer drain never emits ended; the decoder and audio pipeline remain the EOS authority. Close invalidates pending callbacks before releasing retained frames, renderer resources, canvas/listeners, decoder, audio, and demux state.

Canvas targets are reused. Container targets receive one owned canvas without clearing existing children. Native playback continues to use the resolved video element. When a supplied video target must enter Custom playback, Core replaces it in place with an owned canvas without creating a hidden video and restores the original node when Native playback is selected again.

## Filters And Pipeline Switching

Supported filters are passthrough, grayscale, brightness, contrast, and saturation. Parameters are validated and clamped; shader source is never generated per value. Enabling a filter requires a Custom candidate. Disabling it may reselect Native only after capability and media checks; the replacement pipeline becomes ready before the old pipeline is closed, preserving source, time, rate, volume, mute, and playing state.

## Testing And Acceptance

Unit tests use fake GPU, WebGL2, Canvas2D, VideoFrame, animation frame, clock, and factory APIs. They cover backend selection, strict preferences, loss/rebuild/fallback, validation, filters, ownership, scheduling, lifecycle, Core synchronization, Native regression, and SDK proxies. The final acceptance runs typecheck, all tests, build, and diff checking, followed by static forbidden-pattern and resource-lifecycle audits. Real-browser smoke results are recorded honestly as passed or pending.
