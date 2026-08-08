# @mx-player-max/decoder-webcodecs

Phase 4/5 的 WebCodecs 边界。本包只负责具体 `VideoDecoder`/`AudioDecoder` 配置、encoded chunk、flush/reset/close 和统一输出回调；它不依赖 core/audio，不读取容器，不管理 queue/时钟/Renderer，也不包含 WASM。

## Phase 5 AudioDecoder

Audio 配置只能来自 capability report 的 `query.audio`、对应 `TrackInfo`、`codecPrivate`、采样率和声道，禁止从扩展名或 MIME 猜测。AAC 需要完整 `mp4a.40.*` 与兼容 ASC；Opus 只接受探测得到的 `OpusHead` 或规范转换的 MP4 `dOps`；MP3 使用 `mp3` 且不设置 description。未知 codec、缺失 sampleRate/channels、未知声道布局和不兼容 private data 稳定拒绝。

`AudioDecoderRuntime` 可注入测试 fake。`AudioDecoderAdapter` 保证 epoch/generation：reset 后旧 `AudioData` 立即 close/忽略，必须重新 configure；同步 configure/decode、error/dequeue、nullable duration、flush/reset/close 都映射稳定错误码。encoded chunk 直接使用 DemuxPacket 的 Uint8Array view，不持有已 detach backing buffer。

## 配置规则

配置只能来自 `MediaCapabilityReport.query.video`、`TrackInfo` 与 `codecPrivate`，且 capability report 的具体视频结果必须为 `supported`。文件名、扩展名和容器 MIME 不参与 Codec 构造。

| Codec | Phase 4 规则 |
|---|---|
| H.264/AVC | 接受真实 `avc1.xxxxxx`/`avc3.xxxxxx` 与兼容 avcC；Matroska 的通用 `avc1` 仅在 avcC 可导出真实 profile/compatibility/level 时规范化。配置声明 `avc` length-prefixed format。未知 Annex-B 不猜测转换。 |
| VP8 | 使用 Probe 得到的 `vp8`/`vp08...`；不伪造 description。 |
| VP9 | 要求完整 `vp09.profile.level.bitDepth...`；缺失 profile/level/bit depth 时拒绝。 |
| AV1 | 要求完整 `av01...`；只有兼容 av1C 或 sequence-header OBU 才传 description。 |
| HEVC/VVC/其他 | Phase 4 返回 `WEBCODECS_NOT_SUPPORTED`。 |

`createEncodedVideoChunk()` 保留 DemuxPacket 的 key/delta、整数微秒 timestamp 和 nullable duration；数据直接以现有 `Uint8Array` view 传给构造器。主线程 adapter 不 transfer/detach packet buffer。可选 Worker adapter 通过结构化克隆保护可能共享的 packet backing buffer，并将 `VideoFrame` 作为 transferable 返回。

## Adapter 与 Worker

`VideoDecoderRuntime` 是可注入的最小运行时抽象，测试不需要真实浏览器 `VideoDecoder`。`VideoDecoderAdapter` 映射 configure/decode/flush/reset/close 的同步与异步失败；reset 后必须重新 configure，close 幂等，close 后操作返回 `WEBCODECS_ABORTED`。

`VideoDecoderWorkerController` / `WorkerVideoDecoderAdapter` 提供可选 Dedicated Worker/MessagePort 协议。configure、decode、flush、reset、close 及 frame/dequeue/error 响应都携带 `sessionId`、`epoch`、`requestId`；旧 epoch Frame 在边界立即 close。Worker 不可创建时返回 `WEBCODECS_WORKER_FAILED`，不会切换到 HTMLVideo、WASM 或隐藏 video。
