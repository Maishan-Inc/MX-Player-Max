# 音频管线

## 1. 两种音频模式

`NativeMediaPipeline` 让 HTMLVideo/HTMLAudio 负责解码、输出和音画同步。`CustomMediaPipeline` 才启动自建音频管线。Phase 5 只实现 AAC、Opus、MP3 WebCodecs 路径；Vorbis/FLAC/PCM 和 WASM 留作扩展，不在本阶段宣称支持。

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

AAC 使用完整 `mp4a.40.*` + ASC；Opus 使用探测得到的 Codec 与 OpusHead/dOps；MP3 使用 `mp3` 且无 description。AC-3、E-AC-3、DTS、TrueHD、Vorbis、FLAC、PCM 和对象音频不扩大到 Phase 5。

WebCodecs `AudioDecoder` 必须对具体配置调用 `isConfigSupported`，不能只判断接口存在。WASM 解码器输出标准化 PCM，不能把浏览器音频设备操作塞进 WASM。

## 3. AudioWorklet 与缓冲

主线程不为每个压缩包创建独立播放节点。解码线程将 PCM 写入有界 ring buffer，AudioWorklet 按音频设备时钟消费。跨源隔离时优先使用 SharedArrayBuffer；未隔离时使用 MessagePort 分块缓冲。

统一 PCM 为明确声道顺序的 interleaved Float32；mono/stereo 正确转换，未知布局拒绝。流式重采样保留 fractional phase，禁止逐块独立取整。SAB 只在 `crossOriginIsolated && SharedArrayBuffer` 能力确认后启用，其他环境使用有界 transferable MessagePort + sequence/epoch/ack。`process()` 不网络、不 Promise、不日志、不无界分配。

## 4. 音画同步

有音频时 `AudioContext.currentTime` 是主时钟；无音频时使用媒体墙钟。视频渲染器根据音频时钟等待、显示或丢弃帧。每次 seek、轨道切换和 decoder reset 都递增 epoch，旧音频块和旧视频帧不得继续输出。

`play()` 遵守 AudioContext resume 和启动缓冲；pause 停止新 feed 但保留有界缓存；倍速原子更新消费率和时钟映射，当前明确不保音调。seek 提升统一 epoch、清空 Worklet/ring、reset/reconfigure decoder，target 前完整 block 丢弃、跨越 block sample 裁剪。Demux EOS 后双 flush，实际 PCM drain 与视频 queue drain 后才 ended。close 关闭 decoder、AudioData、Context、Worklet、Gain、Port、Worker、timer 和 pending Promise；已交付 VideoFrame 不回收。
