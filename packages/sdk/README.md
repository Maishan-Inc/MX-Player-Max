# @mx-player-max/sdk

对外的原生 JavaScript/TypeScript SDK 入口。React 和 Vue 适配层只包装这个入口，不复制媒体引擎逻辑。

```ts
import { MXPlayer } from '@mx-player-max/sdk'

const player = new MXPlayer({
  target: '#player',
  source: { kind: 'url', url: 'https://media.example.com/video.mp4' },
  native: { preload: 'metadata', crossOrigin: 'anonymous' },
})

await player.ready
await player.play()
```

## Phase 9 playback and UI contract

`playback` 是 Native 与 Custom 共用的只读 `PlaybackSnapshot`，时间统一为整数微秒。它包含 state、paused、current/duration、played/buffered 范围、bufferedAhead、音量/静音/倍速、seeking/buffering、展示模式、控制能力和已脱敏错误摘要。

```ts
player.on('playbackchange', ({ snapshot, reason }) => {
  renderControls(snapshot, reason)
})

await player.load({ ...nextOptions, target: '#player' })
await player.ready // 始终指向当前 load

const image = await player.requestPreview({
  time: 30_000_000,
  width: 160,
  height: 90,
  signal: abortController.signal,
})
```

`requestPreview()` 返回安全的编码图片 `Blob` 或 `null`，不返回 source、媒体私有数据、`VideoFrame`、canvas 或 GPU 资源。Native 预览与活动元素隔离；Custom 只有在 `MXPlayerOptions.preview.provider` 存在时才报告能力。请求受尺寸、字节、超时、latest-wins、AbortSignal 和 session epoch 限制。

可选播放器界面位于独立的 `@mx-player-max/ui`，SDK 不依赖它。完整契约见 `docs/api/player-ui.md`。

## Phase 12 playback decision trace

`decisionTrace` 是 Core 当前 load epoch 的冻结、去敏决策快照；`decisionchange` 在评估、候选
初始化、失败、选择和 close 时发布新快照。它记录调整前/后分数、平台 adjustment、稳定
candidate ID、attempt 顺序和错误码，但不包含 URL、header、Codec private data、原始异常、
Frame、PCM 或字幕正文。

```ts
player.on('decisionchange', ({ trace }) => {
  console.table(trace.candidates)
  console.table(trace.attempts)
})
```

Trace 用于解释 SDK 已经执行的决策，不能作为跳过 capability probe 或后端初始化验证的输入。
所有候选失败时 load 返回 `STRATEGY_ALL_CANDIDATES_FAILED`，具体去敏失败位于错误的
`failures[]` 和 trace attempts。

`MXPlayer` 同步代理 core 的 `state`、`media`、`selection`、`nativeFeatures`、事件 `on/off/once`、seek/倍速/音量/静音、全屏和原生 Picture-in-Picture。NativeMediaPipeline 的错误使用稳定 `ENGINE_*`/`NATIVE_*` 码；autoplay 仍受用户手势策略限制。

Phase 5 还代理只读 `customAudioStats` 与 `audioClock`，以及 `audiostatechange`、`audiounderrun`、`clockupdate`。这些事件只含统计/状态/微秒时间，不含 `AudioData`、PCM 或压缩数据。`customAudio` 选项沿 `MXPlayerOptions` 传入 core。

Phase 4 同时代理 `customVideoStats` 与 `readVideoFrame()`：

```ts
const player = new MXPlayer({
  target: '#player',
  source: { kind: 'url', url: 'https://media.example.com/video.webm' },
  intent: 'frame-access',
  customVideo: { maxDecodedFrames: 8, maxBufferedDuration: 1_000_000 },
})

await player.ready
await player.play() // 启动解码泵，不代表画面已显示
const decoded = await player.readVideoFrame()
decoded?.frame.close()
```

`readVideoFrame()` 是唯一转移 Frame 所有权的 API；普通事件不会广播 Frame。NativeMediaPipeline 调用该 API 会得到 `CUSTOM_FRAME_ACCESS_UNAVAILABLE`。Phase 5 custom 路径增加 AudioContext/AudioWorklet sample clock；Phase 6 在 Custom 路径创建 Renderer 和 canvas，并通过 rAF scheduler 呈现。

## Phase 6 renderer API

```ts
const player = new MXPlayer({
  target: '#surface',
  source: { kind: 'file', file },
  customVideo: {
    renderer: 'auto',
    render: { fit: 'contain', rotation: 0, devicePixelRatio: 2 },
    filter: { kind: 'contrast', amount: 1.1 },
    preserveHdr: true,
  },
})

await player.ready
console.log(player.rendererKind, player.rendererStats)
await player.setVideoFilter({ kind: 'grayscale', amount: 1 })
player.setVideoTransform({ rotation: 90 })
```

`rendererKind`、`rendererState`、`rendererStats` are read-only proxies. `rendererchange`, `rendererstatechange` and `rendererstats` contain only backend/state, dimensions, color range, HDR result, filter and bounded counters. No frame, texture, pixel array, PCM or raw browser error is sent in an SDK event.

`auto` tries WebGPU, then WebGL2, then Canvas2D. An explicit renderer fails with a stable `RENDERER_*` code when unavailable. WebGPU device loss is rebuilt in place; failed rebuild and unrecoverable WebGL2 context loss fall back and emit `rendererchange`. Canvas2D remains watchable without WebGPU. Canvas output supports crop, 0/90/180/270 rotation, contain/cover/fill, DPR and the five bounded filters. A 16,384 backing-dimension limit and backend texture limits are enforced. Phase 6 Custom backends all report `hdrPreserved=false` because end-to-end display HDR cannot be confirmed; unknown color metadata remains unknown.

`readVideoFrame()` ownership is unchanged: a resolved frame belongs to the caller and must be closed by the caller. The internal renderer loop consumes its own pull results and closes presented, dropped, stale and late frames exactly once. Runtime Native <-> Custom migration is load-time in Phase 6; `setVideoFilter()` on Native returns `RENDERER_BACKEND_UNAVAILABLE`, so reload with `customVideo.filter` to request a path change. `pause`, `resume`, playback rate, seek epoch and EOS continue to use the Phase 5 AudioContext/wall-clock contract; close removes rAF, canvas, renderer listeners, GPU/GL resources and pending work.

## Phase 8 subtitle API

```ts
const track = await player.addSubtitleTrack(
  { kind: 'file', file: subtitleFile, format: 'srt' },
  { id: 'external-en', language: 'en' },
)
await player.selectSubtitleTrack(track.id)
player.setSubtitleStyle({ fontSize: 40, y: 86, outlineWidth: 3 })

player.on('subtitlecuechange', ({ cues, currentTime, epoch }) => {
  // 事件只含 cue metadata，不含字幕全文。
})
```

`subtitleTracks`、`selectedSubtitleTrack`、`subtitleState` 和 `subtitleStyle` 是只读代理。SDK 同时代理 `listSubtitleTracks()`、`addSubtitleTrack()`、`selectSubtitleTrack()`、`removeSubtitleTrack()`、`closeSubtitles()`、样式 API 和 Overlay attach/detach。Native 与 Custom 使用同一 API/事件语义；SDK 本身不创建菜单或控制条，Phase 9 的可选 UI 通过这些公共代理提供字幕界面。
