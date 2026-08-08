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

策略最终选择 `webcodecs`，具体视频 capability 为 `supported`，且意图为 `frame-access`、`filters`、`editing` 或 `ai-enhance` 时，core 初始化 CustomMediaPipeline。存在音轨时再次验证具体 AudioDecoder capability，并在同一个 Demux Worker response 内将音视频 packet 分别送入两个有界路径；缺失或不支持音频能力不会静默无声成功。Phase 6 还要求 Renderer 和输出 canvas 成功初始化后才发布 Custom `ready`。

```ts
const engine = createMediaEngine()
await engine.load({
  target: '#player',
  source: { kind: 'file', file },
  intent: 'frame-access',
  customVideo: { maxDecodedFrames: 8, lowWaterMark: 3 },
})
await engine.play() // 启动解码泵、音频输出和 rAF render loop

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

音频输出链使用 AudioDecoder → Float32 PCM → 有界 ring/MessagePort/SAB → AudioWorklet → GainNode。AudioContext 实际消费采样数是主时钟；无音轨使用墙钟。seek 提升统一 epoch，跨越 target 的 audio block 按 sample 精确裁剪，EOS 只有视频 queue 与音频 PCM 都 drain 后才 ended。当前不实现 time-stretch 保音调。`readVideoFrame()` 仍保持 Phase 4 即时 pull 和调用方所有权；只有调用方把返回 frame 传给 Renderer 后，Renderer 才接管并 close。

`close()` 终止 Demux Worker、关闭 VideoDecoder、清空并 close 未交付 Frame、拒绝 reader/seek/Worker Promise、清除 operation timer 和监听器。已经由 `readVideoFrame()` 交付的 Frame 不会被 pipeline 再关闭。

## Phase 6 presentation

```text
Demux Worker -> VideoDecoder -> bounded VideoFrame queue
             -> CustomRenderLoop -> VideoFrameScheduler -> Managed Renderer -> canvas
AudioDecoder -> AudioWorklet -> AudioContext sample clock -----------^
no audio     -> MediaWallClock --------------------------------------^
```

`auto` renderer selection is WebGPU -> WebGL2 -> Canvas2D. A caller canvas is reused. A container receives one engine-owned canvas without clearing existing children. A caller video is replaced by the Custom canvas and restored on teardown; no hidden HTMLVideo drives Custom rendering. Native playback continues to reuse/create only the Native video element.

The rAF loop has at most one in-flight `readVideoFrame()` and one retained frame. The Phase 5 scheduler waits early frames, presents on-time frames and closes late/stale frames as drops. AudioContext consumed sample frames remain the master clock when audio exists; `MediaWallClock` is used otherwise. Pause stops new feed/read/render, resume cannot create a second loop, rate changes remain clock mappings, and seek stops the old generation before the shared epoch advances. Old pending reads may settle but are immediately closed and cannot be consumed by the new generation. EOS still comes only from the Custom pipeline after video decoder/queue and audio PCM drain.

`setVideoFilter()` and `setVideoTransform()` update an active Custom renderer. A non-`none` load-time filter converts `normal`/`low-power` intent to `filters`, excluding Native during strategy ranking. Runtime Native <-> Custom migration is intentionally not implemented in Phase 6: use a new `load()` to switch atomically; source, track/time/rate/volume/mute preservation across such an application-managed reload is the caller's responsibility. This limitation avoids altering existing Native autoplay and HTMLVideo semantics.

Renderer `device.lost` first attempts in-place WebGPU rebuild; failed rebuild or unrecoverable WebGL2 context loss triggers Managed fallback. Core exposes renderer kind/state/stats and stable events only. `close()` cancels rAF, invalidates pending reads, closes the renderer, releases GPU/GL resources and listeners, removes/restores only engine-owned canvas nodes, then closes decoder/audio/worker resources. After close no renderer, frame, state, error or clock callback is forwarded.
