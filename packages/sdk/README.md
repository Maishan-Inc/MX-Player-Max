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

本阶段只覆盖普通本地 File 与支持 CORS/HTTP Range 的远程 MP4 H.264/AAC、WebM VP8/VP9/Opus。字幕和控制层保持独立，NativeMediaPipeline 不提供 UI。
