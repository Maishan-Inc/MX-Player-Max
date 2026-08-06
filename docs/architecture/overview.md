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

### CustomMediaPipeline

适用于 MKV 自定义轨道、逐帧处理、滤镜、AI、编辑器和 WebGPU。Demuxer 在 Worker 中运行，视频进入 WebCodecs 或 WASM，音频进入 AudioWorklet，时钟由 AudioContext 管理。

```text
Source → Range Loader → Demux Worker
                         ├─ Video Decoder → VideoFrame → Renderer
                         ├─ Audio Decoder → AudioData/PCM → AudioWorklet
                         └─ Subtitle Parser → Subtitle Overlay
```

HTMLVideo 不强制进入 `VideoFrame → WebGPU`。只有启用高级帧处理时才通过可选 Frame Adapter 切换到自定义渲染路径。

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

## 7. 错误与回退

错误分为 `SOURCE_*`、`CONTAINER_*`、`DECODER_*`、`RENDERER_*`、`AUDIO_*`、`SUBTITLE_*` 和 `SECURITY_*`。每个候选后端都有可回退等级；回退必须保留当前 source、轨道选择和用户可见错误上下文。

不可回退的情况只有：源不可读、CORS/Range 被阻止、容器损坏且没有可用索引、所有候选解码器都失败。

## 8. 性能预算

- 首次策略计算不加载大型 WASM。
- 只加载最终 Codec 所需的解码器。
- 帧队列和音频 ring buffer 使用有界内存。
- 渲染器优先使用 GPU 纹理、转换和合成，避免主线程像素拷贝。
- 定时器只用于监控和补泵，播放时钟不依赖 React 状态刷新。

