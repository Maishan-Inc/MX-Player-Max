# 音频管线

## 1. 两种音频模式

`NativeMediaPipeline` 让 HTMLVideo/HTMLAudio 负责解码、输出和音画同步。`CustomMediaPipeline` 才启动自建音频管线。

```text
EncodedAudioChunk
        ↓
AudioDecoder / WASM Audio Decoder
        ↓
AudioData 或 Float32 PCM
        ↓
Audio Frame Adapter
        ↓
PCM Ring Buffer
        ↓
AudioWorkletProcessor
        ↓
AudioContext 输出
```

## 2. 首阶段 Codec

优先支持 AAC、Opus、Vorbis、MP3、FLAC 和 PCM/WAV。AC-3、E-AC-3、DTS、TrueHD、WMA、RealAudio 和其他冷门格式通过专用插件或 FFmpeg 兜底。

WebCodecs `AudioDecoder` 必须对具体配置调用 `isConfigSupported`，不能只判断接口存在。WASM 解码器输出标准化 PCM，不能把浏览器音频设备操作塞进 WASM。

## 3. AudioWorklet 与缓冲

主线程不为每个压缩包创建独立播放节点。解码线程将 PCM 写入有界 ring buffer，AudioWorklet 按音频设备时钟消费。跨源隔离时优先使用 SharedArrayBuffer；未隔离时使用 MessagePort 分块缓冲。

必须处理采样率转换、声道布局、静音、增益、播放速度、缓冲欠载、缓冲过量和 seek 后清空。

## 4. 音画同步

有音频时 `AudioContext.currentTime` 是主时钟；无音频时使用媒体墙钟。视频渲染器根据音频时钟等待、显示或丢弃帧。每次 seek、轨道切换和 decoder reset 都递增 epoch，旧音频块和旧视频帧不得继续输出。

首阶段不混用“原生 HTMLVideo 音频 + 自定义 WebCodecs 视频”，除非未来实现明确的外部时钟桥接。这样可以避免双重播放和同步漂移。

