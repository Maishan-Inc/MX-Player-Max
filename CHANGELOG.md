# Changelog

## Unreleased

### Added

- Phase 7 AI post-processing：pull-based `AiPipeline`、RIFE temporal stage、RT4KSR x2 packed full-channel graph、bounded WebGPU texture/tensor pools、WGSL warp/convolution/layernorm/pixel-unshuffle/pixel-shuffle kernels、frame-budget governor、MXAI manifest/Cache Storage/SHA-256 loader，以及真实 Practical-RIFE 4.25 和 RT4KSR x2 上游权重与 MXAI 派生产物。
- Core render loop now accepts CPU or GPU-resident frames with exact-release ownership; `ai-enhance` strategy excludes Native/WASM AI candidates and reports passthrough when WebGPU is unavailable.

- Phase 6 WebGPU/WebGL2/Canvas2D Renderer：能力驱动的自动选择与 runtime fallback、固定 shader/filter 资源、crop/rotation/fit/DPR/尺寸校验、保守 SDR/HDR 状态、device/context loss recovery 和确定性资源清理。
- Custom rAF presentation loop：单 in-flight frame read、Phase 5 VideoFrameScheduler wait/present/drop、AudioContext sample clock/MediaWallClock 同步，以及 pause/resume/rate/seek/epoch/EOS 生命周期。
- `VideoRendererPreference`、`VideoFilterOptions`、`VideoTransformOptions`、Renderer capabilities/state/stats/events、稳定 `RENDERER_*` 错误码，以及 Core/SDK `rendererKind`/`rendererState`/`rendererStats`/`setVideoFilter`/`setVideoTransform` API。
- Phase 6 fake GPU/WebGL2/Canvas2D/VideoFrame/rAF/clock/factory 测试和 renderer target ownership 集成测试。

- Phase 5 `AudioDecoder`/`AudioWorklet` 管线：AAC/Opus/MP3 配置、AudioData 所有权、Float32 PCM、流式重采样、有界 ring、SAB/MessagePort、AudioContext/墙钟、underrun、seek sample 裁剪、双 decoder EOS drain、音频统计与时钟 API。
- `CustomAudioOptions`、`CustomAudioStats`、`AudioClockSnapshot`、`customAudioStats`/`audioClock` 代理和稳定 `AUDIO_*`/`WEBCODECS_AUDIO_*` 错误码；新增 Phase 5 单元与集成测试。

- Phase 4 `CustomMediaPipeline`：复用 Phase 2 Demux Worker，提供 H.264/VP8/VP9/AV1 VideoDecoder adapter、有界 FrameQueue、三重背压、pull-based `readVideoFrame()`、seek epoch/preroll、EOS flush 和完整 close 清理。
- `CustomVideoOptions`、`DecodedVideoFrame`、`CustomVideoStats`、`frameavailable` 事件，以及稳定 `CUSTOM_*`/`WEBCODECS_*` 错误码。
- Dedicated Worker/MessagePort 可选 VideoDecoder 协议，VideoFrame 使用 transferable 返回且旧 epoch Frame 立即关闭。
- `MediaEngine`/`MXPlayer` 的 `customVideoStats` 与 `readVideoFrame()` 代理；Native 路径明确返回 `CUSTOM_FRAME_ACCESS_UNAVAILABLE`。
- Phase 3 `NativeMediaPipeline`：基于 Phase 2 Probe、能力报告和既有策略的 HTMLVideo 原生文件播放路径，支持 File、CORS/Range 远程 MP4/WebM、统一事件/状态、播放控制、全屏/PiP、Object URL 和 requestVideoFrameCallback 统计。
- `MediaEngine`/`MXPlayer` 原生播放公共 API 与稳定 `ENGINE_*`/`NATIVE_*` 错误码。

- Phase 2 byte-range, retry, cache, compressed packet, container adapter, and demux worker contracts.
- Abortable File range reads and strict HTTP 206 loading with Content-Range, length, ETag, retry, concurrency, and LRU validation.
- Bounded Matroska/WebM EBML parsing with tracks, Codec private data, blocks, lacing, Cues, and controlled no-Cues seek fallback.
- MP4/ISO BMFF probing and sample demux for faststart/tail-moov files, 32/64-bit boxes, sample tables, sync samples, and basic fMP4 recognition.
- Session/epoch-aware demux Worker lifecycle with transferable packet buffers and stale-message suppression.
- Versioned static `CapabilitySnapshot` and media-specific `MediaCapabilityReport` contracts.
- Concrete HTMLVideo, MediaCapabilities, WebCodecs, WebGPU, WebGL2, Canvas2D, WASM SIMD, and WASM Threads probes.
- SDK/schema-isolated capability caching with force refresh and injectable adapters.
- Deterministic backend ranking and score-only Chromium/WebKit/Gecko platform policies.
- Typed engine event map and Phase 1 capability/strategy error codes.

### Changed

- A non-`none` load-time filter promotes normal/low-power playback to the Custom `filters` intent; strategy reasons now record renderer selection/fallback chain, and WebGPU candidates require a usable texture limit.
- Custom readiness now waits for decoder/audio and Renderer/output target initialization. Caller canvas/container/video ownership is preserved, and renderer teardown is included in source replacement/seek/close lifecycle.
- `readVideoFrame()` remains an immediate pull ownership boundary; only a frame explicitly passed to `render(frame)` transfers ownership to the Renderer.

- H.264 capability query 可从兼容 Matroska avcC 安全规范化真实 RFC6381 Codec，不生成 SPS/PPS，也不从扩展名或 MIME 猜测。
- Container probing now uses source bytes and bounded Range reads rather than extensions; unknown Codec IDs remain explicit instead of being guessed.
- Strategy selection now requires a capability context and only creates verified or explicitly declared candidates.
- WASM runtime support no longer implies that a WASM Codec decoder exists.
