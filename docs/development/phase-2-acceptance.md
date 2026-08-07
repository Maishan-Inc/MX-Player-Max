# Phase 2 验收记录

日期：2026-08-07

## 实现状态

File/HTTP Range Loader、严格 206 校验、重试、FIFO 并发、LRU 缓存、MP4/Matroska/WebM adapter、统一 Probe/packet、关键帧 seek 与 Worker 生命周期已实现。

当前状态：代码与本机自动化验收通过；Chrome、Firefox、macOS Safari 最新两个稳定大版本的真实 Worker、CORS、Blob stream 与模块 Worker smoke matrix 尚待浏览器 CI/设备环境执行。因此 Phase 2 的真实浏览器退出门禁尚未完全关闭。

## 公共契约

- `ByteRange` 使用字节半开区间。
- `RangeReadResult` 同时返回精确数据、nullable 源长度、Content-Range 和 ETag。
- `DemuxPacket` 返回压缩数据、轨道、微秒 PTS、nullable 微秒 duration 和关键帧标记。
- `ContainerAdapter`、`ContainerProbeResult` 与 `Demuxer` 从 `@mx-player-max/demux` 公共入口导出。
- Range/Container 错误使用稳定 `RANGE_*` 与 `CONTAINER_*` 错误码。

Phase 1 的能力快照、具体媒体能力报告和策略评分契约未重新设计。

## 本机自动化覆盖

`@mx-player-max/demux` 当前覆盖 42 项单元测试：

- File 范围边界、越界、stream 取消、close 后拒绝和缓存复制隔离。
- HTTP 精确 206、200、Content-Range、Content-Length、无 Content-Length、总长度 `*`、重定向、CORS、网络重试、5xx、重试耗尽与取消后停止。
- FIFO 并发窗口、ETag 固定、源变化、缓存命中和 LRU 淘汰。
- Matroska Cues、无 Cues 前向 seek、未知长度 Segment/Cluster、SimpleBlock、BlockGroup、fixed/Xiph/EBML lacing、未知 CodecID、截断、非法 varint、深度和轨道预算。
- WebM DocType 与 VP8、VP9、AV1、Opus、Vorbis 基础映射。
- MP4 faststart、尾部 moov、32/64 位 box、size=0、stts/ctts/stsc/stsz/stco/co64/stss、fMP4 识别、截断、错误 size、64 位溢出和 packet 预算。
- 同一 MP4 fixture 经 File 与 mocked HTTP Range 得到相同 Probe 和 packet。
- Worker start/read/seek/close、旧 epoch 丢弃、pending start/read 关闭和 close 后零 packet。

所有媒体 fixture 由测试代码手工构造；所有 HTTP 测试 mock fetch，不访问真实站点。

## 本机验收命令

以下命令均于 2026-08-07 在当前工作区通过：

```text
pnpm typecheck
pnpm test
pnpm build
git diff --check
```

`pnpm typecheck` 包含全工作区构建与声明检查；`pnpm test` 保持 Phase 1 capability/strategy/platform 和既有 postprocess 测试全部通过。

## 资源预算

默认限制为：8 MiB 单次 Range、16 MiB 元数据缓冲、1 TiB 声明 span、16 层嵌套、64 轨、32 MiB packet、250,000 关键帧、64 MiB 无索引扫描和 32 MiB Worker packet 消息。

大型 `mdat`、Segment 和 Cluster 不整体读取。超过预算、父边界、已知源长度或安全整数范围时返回结构化错误，不进入死循环。

## 零解码副作用

demux 源码不构造 `VideoDecoder`、`AudioDecoder`、HTMLVideo、MediaSource、Renderer 或 AudioWorklet，不加载 WASM，不包含解码器二进制。fMP4 只做基础识别，不实现 MSE 播放。

## 浏览器 smoke matrix

| 环境 | 状态 | 要验证的结果 |
|---|---|---|
| Chrome/Chromium 最新两个稳定大版本 | 待执行 | File stream cancel、HTTP CORS/Range、模块 Worker transferable 与 close |
| Firefox 最新两个稳定大版本 | 待执行 | 严格 206、Worker epoch、Blob stream 与 ArrayBuffer transfer |
| macOS Safari 最新两个稳定大版本 | 待执行 | File/HTTP Probe、模块 Worker、CORS 错误映射与 close 清理 |

浏览器 smoke 只记录实际服务器与浏览器 API 结果，不用预期兼容表替代执行证据。

## 延后范围

- Phase 3：HTMLVideo NativeMediaPipeline。
- Phase 4：WebCodecs decoder、frame queue 与 decoder epoch/reset。
- 后续流媒体阶段：完整 fMP4 fragment、MSE、HLS、DASH 和直播。
- Phase 10：WASM decoder manager 与任何真实解码器二进制。
