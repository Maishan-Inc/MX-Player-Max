# @mx-player-max/core

媒体引擎生命周期、后端组合和统一事件边界。核心包不包含 UI，不直接绑定 React/Vue，也不内置具体 Codec。

## Phase 3 NativeMediaPipeline

`createMediaEngine()` 先复用 `@mx-player-max/demux` 的 RangeLoader 与 ContainerAdapter 读取有限 Probe，再调用 `@mx-player-max/capabilities` 和既有 `@mx-player-max/strategy`。Strategy 一次返回完整排序，Core 为每个候选创建独立 attempt scope；只有完成初始化的候选才提交 selection、事件和公共统计。

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

远程源必须是 HTTP(S)，并由源站提供 CORS 与 Range。远程 URL 直接赋给 `<video>`，默认 `crossOrigin="anonymous"`、`preload="metadata"`、`playsInline=true`；`SourceDescriptor.headers` 无法由 HTMLVideo 发送，因此 Native attempt 记录 `NATIVE_CUSTOM_HEADERS_UNSUPPORTED`，有 Custom 候选时继续原子回退。所有候选用尽后返回 `STRATEGY_ALL_CANDIDATES_FAILED`，具体稳定错误码位于去敏 `failures[]`。MIME/Codec 来自容器 Probe 与已验证的 `MediaCapabilityReport.native.*.contentType`，绝不从扩展名猜测。

NativeMediaPipeline 只消费和管理 HTMLVideoElement 及其原生音频，不输出 `VideoFrame`，也不实现 WebCodecs、WASM、MSE、HLS、DASH、AudioWorklet 或自定义 Renderer。`requestVideoFrameCallback` 仅用于呈现/丢帧/媒体时间统计。

`close()` 会移除事件监听、取消帧回调、停止播放、撤销引擎拥有的 File Object URL，并移除引擎创建的 video；调用方提供的 video 节点不会被删除。所有异步回调都带 load epoch 检查，旧源不会继续发事件。

## Phase 12 atomic candidate initialization

每个 attempt 使用唯一 token，并缓冲 pipeline/renderer/AI 事件。成功 commit 后先发布冻结的
`PlaybackDecisionTrace` selected 快照，再激活 `backendchange`、ready 和运行事件。失败 attempt
按相反所有权顺序关闭 pipeline、renderer、preview、canvas/video surface 和订阅，然后从零创建
下一候选。source/Range/container/target、显式取消、epoch 失效和 close 不进入下一候选；autoplay
用户手势限制发生在候选已成功提交之后，也不会触发后端切换。

当前 Core 真实初始化 Native 与 WebCodecs Custom。尚未接入 Core adapter 的 WASM/MSE 候选只
记录稳定 unavailable 失败，不下载二进制或伪装为可播放。Decision Trace 不包含 URL、header、
Codec private data、Frame、PCM、字幕正文或原始异常。

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

## Phase 8 subtitles

Core 只组合字幕生命周期：为 Native 注入 `HTMLVideo.currentTime`，为 Custom 注入现有 AudioContext 主时钟或无音频墙钟；为内嵌字幕创建独立、受限的 Demux 会话；将轨道、cue、状态、样式和诊断事件转发到公共引擎边界。字幕不会进入 VideoDecoder、Renderer、AI stage、`VideoFrame` 或 `GPUTexture`。

```ts
const track = await engine.addSubtitleTrack(
  { kind: 'url', url: 'https://media.example.com/subtitles/zh.ass' },
  { id: 'zh-ass', language: 'zh', name: 'Chinese' },
)
await engine.selectSubtitleTrack(track.id)
engine.setSubtitleStyle({ fontSize: 42, color: '#FFFFFF', outlineWidth: 3 })
```

选择轨道、seek、换源、remove 和 close 会提升或检查字幕 operation/epoch，旧异步加载和迟到 cue 不再更新 Overlay。`closeSubtitles()` 关闭本次媒体的字幕内核；重新启用需要重新 `load()`。菜单、字体选择器、拖拽位置编辑器和控制条属于 Phase 9。

## Phase 9 playback and preview

Core 将 Native video state 与 Custom AudioContext/MediaWallClock、queue horizon 和 presentation observer 投影为相同的 `PlaybackSnapshot`。所有时间是安全整数微秒，played/buffered 范围排序、裁剪、合并相邻/重叠段并受数量上限保护。`buffering` 与主 state 正交，error 只发布 code/recoverable 摘要。

Native preview 使用隔离 muted media element 和有界 canvas，不 seek/pause/read 活动 video。Custom 通过可选 provider 生成安全 Blob；没有 provider 时 capability 为 false。共享 manager 校验尺寸、像素、MIME、字节、timeout、AbortSignal、latest-wins 与 load epoch，失败返回 `null`。fullscreen 以共享 target container 为边界，Custom PiP 明确不支持。

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
