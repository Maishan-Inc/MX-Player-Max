# Changelog

## Unreleased

### Added

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

- H.264 capability query 可从兼容 Matroska avcC 安全规范化真实 RFC6381 Codec，不生成 SPS/PPS，也不从扩展名或 MIME 猜测。
- Container probing now uses source bytes and bounded Range reads rather than extensions; unknown Codec IDs remain explicit instead of being guessed.
- Strategy selection now requires a capability context and only creates verified or explicitly declared candidates.
- WASM runtime support no longer implies that a WASM Codec decoder exists.
