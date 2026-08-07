# @mx-player-max/decoder-webcodecs

Phase 4 的视频 WebCodecs 边界。本包只负责具体 `VideoDecoderConfig`、`EncodedVideoChunk`、`VideoDecoder` 生命周期和统一 Frame 回调；它不依赖 core，不读取容器，不管理 seek/frame queue，也不包含音频、Renderer 或 WASM。

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
