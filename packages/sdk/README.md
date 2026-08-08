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

`readVideoFrame()` 是唯一转移 Frame 所有权的 API；普通事件不会广播 Frame。NativeMediaPipeline 调用该 API 会得到 `CUSTOM_FRAME_ACCESS_UNAVAILABLE`。Phase 4 custom 路径只解码视频，不创建音频、时钟或 Renderer；音量/静音设置留待 Phase 5 生效，全屏/PiP 留待 Phase 6 Renderer。
