# Changelog

## Unreleased

### Added

- Phase 11 `@mx-player-max/platform`：可注入 Chromium/WebKit/Gecko 增强探测，覆盖 Worker MediaSource、WebGPU external texture、原生 HLS/HEVC、HDR display、ManagedMediaSource、AirPlay/PiP、fastSeek、标准播放质量和仅诊断使用的 Firefox 帧计数。
- 可审计 `PlatformIssueRule`：浏览器/半开版本范围、HTTPS Issue、失效日期、回归样本、负向评分和候选匹配；内建 Firefox Bugzilla #1918769 H.264 WebCodecs configure 风险规则，不改写能力支持状态。
- `PlatformDiagnostics` 显式记录 WebCodecs 硬件偏好/实际选择，并在标准 API 无法确认时保留 `unknown`，不从 `powerEfficient` 或配置支持结果推断硬解。
- Phase 10 `@mx-player-max/decoder-wasm` Manager 契约：严格且不可变的 manifest/review 校验、Codec/轨道受限的插件 Registry、审核后的策略声明、能力驱动的 threaded/SIMD/single 变体选择、HTTP(S) URL 边界、内存/Cache Storage、SHA-256 验证、并发去重、Abort 和原子回退；本阶段不包含真实 WASM 二进制或 Core 解码接入。
- Phase 9 独立可选的 `@mx-player-max/ui`：原生 DOM + TypeScript 控制条、进度/缓冲/连续 seek、160x90 可取消预览、状态层、单一浮层状态机、自动隐藏、快捷键、ARIA、字幕轨道与样式编辑，以及独立 `style.css`。
- Native/Custom 共用的 `PlaybackSnapshot`、播放范围、能力、展示模式、安全错误摘要、`playbackchange` 事件和受预算/epoch/AbortSignal 保护的公共预览契约。
- React/Vue SDK + UI 薄组件、播放器 workbench Demo，以及 Chromium desktop/mobile、Firefox 和 Playwright WebKit 的交互与截图自动化。
- UI 生命周期支持创建、重复 attach、重新挂载、全量配置更新和幂等销毁；所有异步 UI 操作检查生命周期与媒体 session epoch。
- Phase 8 SRT/ASS/SSA 字幕内核：有界纯文本解析、内嵌 packet 与 File/HTTPS 来源、稳定轨道生命周期/epoch、Native/Custom 媒体时钟调度、安全 DOM Overlay 和按 origin/local-file 作用域的样式存储。
- `SubtitleCue`/style/source/track/clock/store 公共契约、稳定 `SUBTITLE_*` 错误码、字幕事件，以及 Core/SDK 轨道、选择、外挂字幕、样式与 Overlay API。
- ASS Script Info、V4/V4+ Styles、Events Format/Dialogue 映射、白名单基础样式/位置和未支持 libass 特效的显式降级诊断；新增解析、安全、来源、轨道、时钟、Overlay、Core 和 SDK 自动化测试。

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

- `MXPlayer.ready` 现在始终返回当前 load promise，并新增可重复 `load()`、`playback` 与 `requestPreview()` SDK 代理。
- Native 与 Custom 都从同一公共快照驱动 UI；Custom 仅在宿主提供预览 provider 时报告 preview capability，Native 预览使用与活动播放元素隔离的有界媒体元素和 canvas。
- 原生能力探测在 MediaCapabilities 配置不完整但 `canPlayType()` 明确返回 `probably` 时保留 Native 支持；`maybe` 仍为 `unknown`。
- `HttpRangeLoader` 只把强 ETag 写入 `If-Range`，弱 ETag 仍可用于响应一致性比较。
- A non-`none` load-time filter promotes normal/low-power playback to the Custom `filters` intent; strategy reasons now record renderer selection/fallback chain, and WebGPU candidates require a usable texture limit.
- Custom readiness now waits for decoder/audio and Renderer/output target initialization. Caller canvas/container/video ownership is preserved, and renderer teardown is included in source replacement/seek/close lifecycle.
- `readVideoFrame()` remains an immediate pull ownership boundary; only a frame explicitly passed to `render(frame)` transfers ownership to the Renderer.

- H.264 capability query 可从兼容 Matroska avcC 安全规范化真实 RFC6381 Codec，不生成 SPS/PPS，也不从扩展名或 MIME 猜测。
- Container probing now uses source bytes and bounded Range reads rather than extensions; unknown Codec IDs remain explicit instead of being guessed.
- Strategy selection now requires a capability context and only creates verified or explicitly declared candidates.
- WASM runtime support no longer implies that a WASM Codec decoder exists.
