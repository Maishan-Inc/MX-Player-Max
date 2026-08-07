# 总体技术架构

## 1. 目标与边界

MX-Player-Max 的核心是一个与 UI 解耦的媒体能力引擎。它接收本地文件或远程文件，识别容器与轨道，选择最优播放后端，最后把视频帧、音频数据和字幕事件交给渲染层。

首阶段只处理文件型媒体：本地 `File`、支持 CORS/Range 的远程 URL。HLS、DASH、直播和 DRM 只建立接口，不在第一轮实现。这样可以先把容器解析、Decoder Strategy、音画同步和跨浏览器回退做正确。

## 2. 双播放路径

### NativeMediaPipeline

适用于普通观看。HTMLVideo 直接负责容器、解码、硬件加速、音频输出、HDR、DRM 和音画同步。播放器 UI、字幕覆盖层和控制层叠加在视频元素外部。

```text
Source → HTMLVideo → Native Video Renderer
                    ├─ Native Audio
                    └─ Subtitle Overlay
```

Phase 3 的 NativeMediaPipeline 只负责 HTMLVideoElement、原生音频和播放生命周期。它先使用 Phase 2 的 RangeLoader/ContainerAdapter 完成有限 Probe，再消费 CapabilitySnapshot、MediaCapabilityReport 和 StrategyEngine 的最终 `native-html-video` 选择。File 源只通过 `URL.createObjectURL()` 设置；远程 HTTP(S) 源直接设置给 video，默认 `crossOrigin=anonymous`、`preload=metadata`、`playsInline=true`。自定义 headers 会明确失败。MIME/Codec 来自 Probe 和能力报告，不从扩展名推导。

Pipeline 的事件统一映射为微秒时间、nullable duration 与有限 bufferedAhead。`requestVideoFrameCallback` 只更新统计，不产生或转交 `VideoFrame`。关闭或替换源会提升 epoch、移除监听、取消待处理帧回调、撤销 Object URL；字幕覆盖层和控制层不属于该模块。

### CustomMediaPipeline

适用于 MKV 自定义轨道、逐帧处理、滤镜、AI、编辑器和 WebGPU。Demuxer 在 Worker 中运行，视频进入 WebCodecs 或 WASM，音频进入 AudioWorklet，时钟由 AudioContext 管理。

```text
Source → Range Loader → Demux Worker
                         ├─ Video Decoder → VideoFrame → Renderer
                         ├─ Audio Decoder → AudioData/PCM → AudioWorklet
                         └─ Subtitle Parser → Subtitle Overlay
```

HTMLVideo 不强制进入 `VideoFrame → WebGPU`。只有启用高级帧处理时才通过可选 Frame Adapter 切换到自定义渲染路径。

Phase 4 只落地该路径的视频前半段：`SourceDescriptor → Phase 2 Demux Worker → DemuxPacket → EncodedVideoChunk → VideoDecoder → bounded VideoFrame queue → readVideoFrame()`。它不创建 AudioDecoder、AudioContext、Renderer、canvas 或隐藏 HTMLVideo，因此 `play()` 只允许解码泵继续运行，不代表画面已显示或已具备完整播放。

Demux Worker 直接复用 Phase 2 的 Range Loader、ContainerAdapter、Demuxer 和 start/read/seek/close 协议。MIME、RFC6381 Codec、codecPrivate 和 dimensions 全部来自有限 Probe，不从扩展名推导。每次响应必须同时匹配 sessionId、epoch 与 requestId；Worker 不可用时明确返回 `WEBCODECS_WORKER_FAILED`，不退回主线程完整下载。

Frame queue 默认最多持有 8 个 queued/reserved Frame、1 秒 duration，并将 VideoDecoder `decodeQueueSize=8` 作为独立高水位；queue 降至 3 后恢复。`readVideoFrame()` 是拉取式所有权边界：queue 中 Frame 归 pipeline，返回后归调用方并必须由调用方 close。seek、换源、错误和 close 关闭全部未交付 Frame。

## 3. 核心生命周期

```text
create
  → probe source
  → parse container metadata
  → select strategy
  → initialize backend
  → ready
  → play / pause / seek / select track
  → close
```

所有异步 Worker、Decoder 和 Renderer 消息带 `sessionId` 与 `epoch`。每次 seek、音频轨切换或解码器 reset 都递增 epoch，旧消息必须丢弃。

## 4. 策略分层

```text
MediaIntent
  ├─ normal playback
  ├─ frame access
  ├─ filters
  ├─ hdr preservation
  └─ low power

MediaDescriptor
  ├─ container
  ├─ video codec/config
  ├─ audio codec/config
  ├─ duration/size
  └─ tracks

CapabilitySnapshot
  ├─ HTMLVideo / MSE
  ├─ VideoDecoder / AudioDecoder
  ├─ WebGPU / WebGL2 / Canvas2D
  └─ WASM SIMD / Threads / SharedArrayBuffer
```

策略引擎先用媒体描述生成候选，再用能力快照淘汰候选，最后按照硬件加速、功耗、额外拷贝、启动时间和高级处理需求评分。浏览器品牌只加载可选平台策略，不直接映射到后端。

## 5. 统一数据模型

- 视频统一输出 `VideoFrame` 或内部等价的 GPU 纹理句柄。
- 音频统一输出 `AudioData` 或标准化 PCM block。
- 字幕统一输出带 `start`、`end`、`text`、`style` 的 `SubtitleCue`。
- 轨道统一使用 `TrackInfo`，包含语言、名称、Codec、分辨率、采样率和声道数。
- 所有时间戳使用微秒整数或明确的秒浮点边界，禁止在模块之间混用单位。

## 6. Worker 边界

- Demux Worker 负责 Range 读取、容器解析和压缩包切片。
- Decoder Worker 负责 WASM 实例、重型转换和可选 WebCodecs 调用。
- AudioWorklet 只负责实时 PCM 消费，不能等待网络或执行大块解析。
- 主线程负责生命周期、用户输入、策略选择和 UI 状态。

Phase 4 的 VideoDecoder runtime 既可直接运行，也提供 Dedicated Worker/MessagePort 协议。两种形式共享 configure/decode/flush/reset/close 语义；Worker 形式以 transferable 返回 `VideoFrame`，不转换为 ImageBitmap 或像素数组。Core 默认 adapter 仍通过明确的 runtime 能力创建，不使用 UA 分支。

## 7. 错误与回退

错误分为 `SOURCE_*`、`CONTAINER_*`、`DECODER_*`、`RENDERER_*`、`AUDIO_*`、`SUBTITLE_*` 和 `SECURITY_*`。每个候选后端都有可回退等级；回退必须保留当前 source、轨道选择和用户可见错误上下文。

不可回退的情况只有：源不可读、CORS/Range 被阻止、容器损坏且没有可用索引、所有候选解码器都失败。

## 8. 性能预算

- 首次策略计算不加载大型 WASM。
- 只加载最终 Codec 所需的解码器。
- 帧队列和音频 ring buffer 使用有界内存。
- Phase 4 在请求下一批压缩 packet 前同时检查 frame 数量、reserved duration 与 decoder queue；普通 Frame 溢出是 `WEBCODECS_QUEUE_OVERFLOW` 致命错误，不静默丢帧。
- 渲染器优先使用 GPU 纹理、转换和合成，避免主线程像素拷贝。
- 定时器只用于监控和补泵，播放时钟不依赖 React 状态刷新。
