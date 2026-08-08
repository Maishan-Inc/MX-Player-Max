# @mx-player-max/core

媒体引擎生命周期、后端组合和统一事件边界。核心包不包含 UI，不直接绑定 React/Vue，也不内置具体 Codec。

## Phase 3 NativeMediaPipeline

`createMediaEngine()` 先复用 `@mx-player-max/demux` 的 RangeLoader 与 ContainerAdapter 读取有限 Probe，再调用 `@mx-player-max/capabilities` 和既有 `@mx-player-max/strategy`。只有最终候选为 `html-video` 且意图为 `normal`/`low-power` 时，才创建 NativeMediaPipeline。

```ts
const engine = createMediaEngine()
await engine.load({
  target: '#player',
  source: { kind: 'file', file },
  native: { preload: 'metadata', playsInline: true },
})
await engine.play()
await engine.seek(30_000_000) // Micros: 30 seconds
```

远程源必须是 HTTP(S)，并由源站提供 CORS 与 Range。远程 URL 直接赋给 `<video>`，默认 `crossOrigin="anonymous"`、`preload="metadata"`、`playsInline=true`；`SourceDescriptor.headers` 无法由 HTMLVideo 发送，因此会显式返回 `NATIVE_CUSTOM_HEADERS_UNSUPPORTED`。MIME/Codec 来自容器 Probe 与已验证的 `MediaCapabilityReport.native.*.contentType`，绝不从扩展名猜测。

NativeMediaPipeline 只消费和管理 HTMLVideoElement 及其原生音频，不输出 `VideoFrame`，也不实现 WebCodecs、WASM、MSE、HLS、DASH、AudioWorklet 或自定义 Renderer。`requestVideoFrameCallback` 仅用于呈现/丢帧/媒体时间统计。

`close()` 会移除事件监听、取消帧回调、停止播放、撤销引擎拥有的 File Object URL，并移除引擎创建的 video；调用方提供的 video 节点不会被删除。所有异步回调都带 load epoch 检查，旧源不会继续发事件。

## Phase 4/5 CustomMediaPipeline

策略最终选择 `webcodecs`，具体视频 capability 为 `supported`，且意图为 `frame-access`、`filters`、`editing` 或 `ai-enhance` 时，core 初始化 CustomMediaPipeline。Phase 5 在存在音轨时再次验证具体 AudioDecoder capability，并在同一个 Demux Worker response 内将音视频 packet 分别送入两个有界路径；缺失或不支持音频能力不会静默无声成功。`normal`/`low-power` 仍受 Phase 6 Renderer 门禁，不宣称完整 Custom 播放。

```ts
const engine = createMediaEngine()
await engine.load({
  target: '#player',
  source: { kind: 'file', file },
  intent: 'frame-access',
  customVideo: { maxDecodedFrames: 8, lowWaterMark: 3 },
})
await engine.play() // 只启动解码泵，不显示画面

const decoded = await engine.readVideoFrame()
if (decoded) {
  try {
    consumeFrame(decoded.frame)
  } finally {
    decoded.frame.close()
  }
}
```

CustomMediaPipeline 通过 Phase 2 `DemuxWorkerController` 和既有 start/read/seek/close 协议获取压缩 packet。Probe 的 MIME、Codec、codecPrivate、轨道尺寸决定配置；不复制 Range Loader 或容器 parser，也不从扩展名判断格式。

默认高水位同时限制 decoded/reserved frame 数量 8、`decodeQueueSize` 8 和缓冲 duration 1 秒。达到任一上限后不再请求 Demux packet；queue 降到低水位 3 且 decoder dequeue 后恢复。packet response 仍受 Phase 2 32 MiB Worker 消息预算约束，pending reader 上限为 64。

seek 提升 epoch，停止旧 pump，关闭 queue Frame，拒绝旧 reader，reset/reconfigure decoder，再调用 Phase 2 关键帧 seek。新 epoch 从 key packet 开始，target 之前的 preroll Frame 会 close；连续 seek 只有最后 epoch 可以完成。Demux EOS 后必须等待 `flush()` 产生的 Frame，queue 耗尽后才返回 `null` 并进入 ended。

音频输出链使用 AudioDecoder → Float32 PCM → 有界 ring/MessagePort/SAB → AudioWorklet → GainNode。AudioContext 实际消费采样数是主时钟；无音轨使用墙钟。seek 提升统一 epoch，跨越 target 的 audio block 按 sample 精确裁剪，EOS 只有视频 queue 与音频 PCM 都 drain 后才 ended。当前不实现 time-stretch 保音调。Phase 5 不创建 Renderer；`readVideoFrame()` 仍保持 Phase 4 即时 pull 和调用方所有权。

`close()` 终止 Demux Worker、关闭 VideoDecoder、清空并 close 未交付 Frame、拒绝 reader/seek/Worker Promise、清除 operation timer 和监听器。已经由 `readVideoFrame()` 交付的 Frame 不会被 pipeline 再关闭。
