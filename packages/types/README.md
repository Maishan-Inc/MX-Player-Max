# @mx-player-max/types

所有公共媒体、轨道、能力、策略和错误类型的单一来源。

## 公共契约

- `Micros`：所有媒体时间戳与时长的微秒单位。
- `TrackInfo` / `MediaDescriptor`：容器、轨道、Codec、码率、色彩与 HDR 元数据。
- `VideoCodecConfig` / `AudioCodecConfig`：不依赖具体浏览器实现的 Codec 配置。
- `CapabilitySnapshot`：版本化、可序列化的运行环境快照，不包含具体媒体支持结论。
- `MediaCapabilityReport`：针对一个媒体配置的 HTMLVideo、MediaCapabilities 与 WebCodecs 结果。
- `CapabilityContext`：策略层消费的环境快照、媒体报告与可选 WASM 声明。
- `EngineEventMap` / `EngineEventSource`：core、SDK 和 UI 适配层共用的强类型事件契约。
- `PlatformScoreAdjustment`：平台策略唯一允许返回的候选调分结构。
- `ByteRange`：以字节为单位的半开区间 `[start, endExclusive)`。
- `RangeReadResult`：精确范围数据及源总长度、`Content-Range`、ETag；未知总长度使用 `null`。
- `RetryPolicy` / `RangeCache` / `RangeLoaderOptions`：Range 读取的重试、缓存与取消契约。
- `DemuxPacket`：未解码的压缩 packet，时间单位统一为整数微秒；未知 duration 使用 `null`。
- `NativeMediaOptions` / `NativeMediaFeatures` / `NativePlaybackStats`：HTMLVideo 原生路径的配置、特性检测和 `requestVideoFrameCallback` 统计契约。统计只包含计数与微秒时间，不输出 `VideoFrame`。
- `CustomVideoOptions` / `CustomVideoStats`：Phase 4 视频解码队列、背压上限和分类丢帧统计。默认上限为 8 个 decoded/reserved frame、8 个 decoder queue item、1,000,000 微秒缓冲，低水位为 3。
- `CustomAudioOptions` / `CustomAudioStats`：Phase 5 音频解码、PCM 缓冲、Worklet transport、underrun 和 drain 统计。默认 `maxDecodeQueueSize=16`、`maxBufferedDuration=2_000_000`、`lowWaterMark=500_000`、`startBufferDuration=150_000`、`maxMessagePortPendingBlocks=8`、`operationTimeoutMs=10_000`、`latencyHint='interactive'`；所有配置都有硬上限，非法值返回 `AUDIO_INVALID_QUEUE_CONFIG`。
- `AudioClockSnapshot`：音频存在时以实际消费的 PCM sample frame 锚定 AudioContext 主时钟；无音频时 `source='wall-clock'`，基于 `performance.now()`，支持 pause/resume/seek/rate。
- `DecodedVideoFrame`：`readVideoFrame()` 的拉取结果，携带整数微秒 timestamp、nullable duration 和 epoch。
- `MediaEngine`：core 与 SDK 共用的播放生命周期、控制方法、稳定事件监听和 `EngineError` 边界。
- `SubtitleCue` / `SubtitleCueStyle` / `SubtitleTrack` / `SubtitleSourceDescriptor`：Phase 8 文本字幕、样式、来源和轨道公共契约；所有时间为整数微秒。
- `SubtitleParserLimits` / `SubtitleSourceLimits` / `SubtitleClockSnapshot` / `SubtitleStyleStore`：解析预算、来源字节/流块/packet batch/超时预算、媒体时钟和可替换持久化边界。
- `subtitletrackchange` / `subtitlecuechange` / `subtitlestatechange` / `subtitlestylechange` / `subtitlewarning`：不携带字幕全文、完整 URL 或 DOM 异常的字幕事件。

`CapabilitySupport` 有三种状态：`supported` 表示 API 明确支持，`unsupported` 表示 API 明确拒绝或不存在，`unknown` 表示配置不足或探测失败。调用方不得把 `unknown` 当成支持。

`BackendKind` 已预留 `mse`，但 Phase 1 不生成 MSE 候选。

Phase 2 错误码使用 `RANGE_*` 与 `CONTAINER_*` 命名空间。公共类型不实现 fetch、File 读取、容器解析、解码或平台分支；这些行为由 `@mx-player-max/demux` 提供。

Phase 3 增加 `ENGINE_*` 与 `NATIVE_*` 稳定错误码。`Micros` 始终为整数微秒；未知 duration、当前媒体时间和统计时间使用 `null`，不会用 `NaN`、`Infinity` 或负数伪造数据。

Phase 4 增加 `CUSTOM_*` 与 `WEBCODECS_*` 稳定错误码、`customVideoStats`、`readVideoFrame()` 和不携带帧本体的 `frameavailable` 事件。NativeMediaPipeline 调用 `readVideoFrame()` 返回 `CUSTOM_FRAME_ACCESS_UNAVAILABLE`，不会从 HTMLVideo 合成帧。

Phase 5 增加 `customAudioStats`、`audioClock`、`audiostatechange`、`audiounderrun` 和 `clockupdate`。事件只发送统计、状态和整数微秒，不发送 `AudioData`、PCM、压缩 packet 或 URL。`AudioData` 在 `copyTo()` 后立即 close；PCM 仅由有界 ring/MessagePort/AudioWorklet 持有。

Phase 8 增加稳定 `SUBTITLE_*` 错误码以及轨道枚举、外挂字幕、选择/关闭/移除、样式和 Overlay API；等价外挂来源返回 `SUBTITLE_SOURCE_CONFLICT`。`subtitlecuechange` 只发送 cue ID、时间、layer、媒体时间和 epoch，不发送字幕正文。`subtitlewarning` 只包含稳定 code、安全 message 和可选行号/cue ID，不暴露 File、完整 URL、查询参数、响应正文或原始 DOMException。

## VideoFrame 所有权

- Frame 位于 custom queue 时归 `CustomMediaPipeline` 所有。
- `readVideoFrame()` resolve 后所有权转移给调用方；调用方必须且只能调用一次 `frame.close()`。
- seek、换源、错误或 close 会关闭所有尚未交付的 Frame。
- 旧 epoch、preroll、非法或 close 后迟到的 Frame 会立即关闭并计入对应统计。
- 普通事件只发布 queue 数量和 duration，不广播 `VideoFrame`，因此不会产生多个隐含所有者。

Renderer 的 `render(frame)` 是第二个明确所有权边界：一旦接受 frame，Renderer 在上传、绘制、非法参数、device/context lost 或 closed 路径都恰好 close 一次。Scheduler 的 drop/stale 决策由消费方 close；已经通过 `readVideoFrame()` 交给外部但没有传给 Renderer 的 frame 仍只归外部调用方。重复提交同一个对象返回 `RENDERER_FRAME_INVALID`，不会重复 close。

## Phase 6 Renderer contract

`CustomVideoOptions.renderer` 接受 `auto | webgpu | webgl2 | canvas2d`；auto 使用能力验证后的 WebGPU -> WebGL2 -> Canvas2D 链。`render` 提供 crop/rotation/fit/output-size/DPR，`filter` 提供固定的 `none | grayscale | brightness | contrast | saturate` 集合，`preserveHdr` 只是请求而不是保真承诺。滤镜参数由 Renderer 校验和限幅，非法输入返回 `RENDERER_FILTER_UNSUPPORTED`。

`MediaEngine.rendererKind`、`rendererState` 和 `rendererStats` 是只读状态。`rendererchange`、`rendererstatechange`、`rendererstats` 事件只包含 backend/state、尺寸、颜色模式/range、HDR 结果、filter 和有界计数，不包含 `VideoFrame`、`GPUTexture`、像素、`AudioData`、PCM 或浏览器原始异常文本。`setVideoFilter()` 和 `setVideoTransform()` 可更新已激活的 Custom renderer。Phase 6 的 Native -> Custom 切换是 load-time：Native 活跃时调用这些方法返回 `RENDERER_BACKEND_UNAVAILABLE`，应用需要用 `customVideo.filter`/`customVideo.render` 重新 load。

Renderer 尺寸必须是正安全整数，crop 必须位于 frame bounds，rotation 只允许 0/90/180/270，DPR 为有限 `(0, 8]`，canvas backing dimension 硬上限为 16,384 并同时受 backend texture limit 限制。SDR BT.709/sRGB 与 full/limited/unknown range 会显式记录；未知元数据不猜测 HDR。Phase 6 缺少标准的端到端 display-HDR 确认信号，因此 WebGPU/WebGL2/Canvas2D 都保守返回 `hdrPreserved=false`；Native HTMLVideo 仍是当前可声明平台 HDR 色彩管理的路径。
