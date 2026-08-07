# Phase 4 验收记录

日期：2026-08-08

## 实现状态

WebCodecs 视频-only CustomMediaPipeline 已实现。加载顺序为：Phase 2 Range Loader/ContainerAdapter 有限 Probe → 关闭 Probe 资源 → CapabilitySnapshot/MediaCapabilityReport → 既有 PlatformPolicy/StrategyEngine → `webcodecs` 与高级帧意图门禁 → Demux Worker session → 视频轨选择 → 已验证 VideoDecoderConfig → configure → ready。

当前状态：代码、本机自动化测试、类型检查和构建验收通过。Chrome/Chromium、Firefox、macOS Safari 最新两个稳定大版本的真实 File/CORS Range、Dedicated Worker VideoDecoder、transferable VideoFrame 和硬件配置 smoke matrix 尚未执行，因此跨浏览器退出门禁仍为 pending。

## 公共 API

- `CustomVideoOptions`：默认 `maxDecodedFrames=8`、`maxDecodeQueueSize=8`、`lowWaterMark=3`、`maxBufferedDuration=1_000_000` 微秒、`operationTimeoutMs=10_000` 毫秒。
- `DecodedVideoFrame`：VideoFrame、整数微秒 timestamp、nullable duration、epoch。
- `CustomVideoStats`：decoded/delivered/dropped 分类、queue/decodeQueueSize、buffered duration、EOS。
- `MediaEngine`/`MXPlayer`：`customVideoStats` 与 pull-based `readVideoFrame()`。
- `frameavailable` 只携带 queue 数量与 duration，不携带 VideoFrame。
- 新增稳定 `CUSTOM_*` 与 `WEBCODECS_*` 错误码；DOMException name 和浏览器原始 message 不作为错误码。

## Decoder 与 Codec

`@mx-player-max/decoder-webcodecs` 提供可注入 `VideoDecoderRuntime`、浏览器 runtime、fake-friendly EncodedVideoChunk factory、主线程 adapter、可选 Dedicated Worker/MessagePort adapter 与 Worker controller。

| Codec | 状态 | 配置要求 |
|---|---|---|
| MP4 H.264/AVC | 已实现 | 真实 `avc1.xxxxxx` + 兼容 avcC，length-prefixed AVC format |
| Matroska H.264/AVC | 已实现（元数据完整时） | 通用 avc1 可从 avcC profile/compatibility/level 安全规范化，不生成 SPS/PPS |
| WebM VP8 | 已实现 | Probe 的 vp8/vp08，不伪造 description |
| WebM/Matroska/MP4 VP9 | 已实现（元数据完整时） | 完整 `vp09.profile.level.bitDepth...`；通用 vp09 拒绝 |
| WebM/Matroska/MP4 AV1 | 已实现（元数据完整时） | 完整 `av01...`；description 仅接受兼容 av1C/sequence-header OBU |
| HEVC/VVC/MPEG-2/MPEG-4 Part 2/VC-1/ProRes | 不在 Phase 4 | 稳定 `WEBCODECS_NOT_SUPPORTED` |

## Queue、背压与所有权

FrameQueue 按 PTS、同 PTS FIFO 稳定排序。解码泵在请求 Demux packet 和提交 decode 前同时检查：queued + reserved frame 数、queued + reserved duration、`VideoDecoder.decodeQueueSize`。高水位停止 read/decode，降至 lowWaterMark 且收到消费/dequeue 信号后恢复；没有 timer polling、无界 Promise chain 或无界 pending read。

Queue 中 Frame 归 pipeline；`readVideoFrame()` 返回后归调用方，调用方负责一次 `frame.close()`。seek/换源/error/close 关闭未交付 Frame；stale/preroll/非法/迟到 Frame 立即关闭并分类计数。已经交付的 Frame 不会被 pipeline 再关闭。

## Seek、Epoch 与 EOS

seek 提升 epoch，停止旧 pump，拒绝旧 reader/seek/Worker Promise，关闭旧 queue，reset/reconfigure VideoDecoder，再调用 Phase 2 Demux Worker 关键帧 seek。新 epoch 首个提交 packet 必须为 key；target 前 Frame 作为 preroll close。连续 seek 只允许最后 epoch 完成，旧 packet/Frame/error/EOS 不改变新 session。

Demux EOS 后停止 read，调用 `flush()` 并接收 flush 输出 Frame。decoder EOS 只在 flush 完成后标记；queue 未空时继续交付，耗尽后 read 才返回 null，ended 只发一次。

## 本机自动化覆盖

测试使用 fake VideoDecoder、EncodedVideoChunk、VideoFrame、Worker、MessagePort、Demux Worker response、能力报告、策略选择和可控 Promise；所有 HTTP/媒体输入均为 mock 或代码构造，不访问真实站点。

覆盖 Codec allowlist/config、configure/decode/flush/reset/close、Worker identity/transfer、FIFO/PTS、frame/duration/decodeQueue 高低水位、reader 上限、所有权、pause/resume、关键帧 seek、preroll、连续 epoch、旧消息、EOS flush、Core/SDK 双路径、换源和 close 泄漏。

`pnpm test` 实际通过 194 个测试：types 10、capabilities 15、decoder-webcodecs 35、demux 42、platform 3、postprocess 6、strategy 9、core 72、SDK 2。

## 阶段边界审计

- 未新增 AudioDecoder、AudioData、PCM、AudioContext 或 AudioWorklet。
- 未新增 WebGPU/WebGL2/Canvas2D Renderer、ImageBitmap 或像素转换。
- 未新增 WASM、FFmpeg、OpenH264/libvpx/dav1d 二进制。
- 未新增 MSE、HLS、DASH、直播、编码、转码或隐藏 HTMLVideo 解码。
- 未复制 Range Loader/ContainerAdapter/Demuxer；Custom worker entry 直接实例化 Phase 2 `DemuxWorkerController`。
- 未改变 StrategyEngine/PlatformPolicy 评分语义和 Phase 2 公共契约。
- 远程响应正文、完整 URL、查询参数和 CodecPrivate 不进入日志或公开错误 message。

## 本机验收命令

以下命令于 2026-08-08 在当前工作区实际执行并通过：

```text
pnpm typecheck
pnpm test
pnpm build
git diff --check
```

## 浏览器 smoke matrix

| 环境 | 状态 | 待验证内容 |
|---|---|---|
| Chrome/Chromium 最新两个稳定大版本 | pending | File/HTTP Range、MP4 avcC、WebM VP8/VP9/AV1、Worker VideoDecoder/transferable Frame、连续 seek、close |
| Firefox 最新两个稳定大版本 | pending | VP8/VP9/AV1、H.264 isConfigSupported/configure 差异、Worker epoch、flush、close |
| macOS Safari 最新两个稳定大版本 | pending | VideoDecoder Worker 可用性、MP4 H.264、WebM 能力拒绝/支持结果、transferable Frame、close |

本机 Vitest 结果不替代真实浏览器 API、硬件解码器、CORS 服务器和 macOS Safari 执行证据。

## 未完成或外部验证项

- 三浏览器真实 smoke matrix 与最近两个稳定大版本覆盖。
- 真实 CORS/206/Content-Range 服务器、超大 File 与 Worker module 部署路径验证。
- VP9/AV1 缺失 profile/level/bit depth 的媒体需要 Phase 2 后续元数据增强；Phase 4 不猜默认值。
- Phase 5 音频/主时钟、Phase 6 Renderer/呈现、Phase 10 WASM 均未实现，不能宣称 custom 完整播放。
