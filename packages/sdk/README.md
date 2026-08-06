# @mx-player-max/sdk

对外的原生 JavaScript/TypeScript SDK 入口。React 和 Vue 适配层只包装这个入口，不复制媒体引擎逻辑。

```ts
import { MXPlayer } from '@mx-player-max/sdk'

const player = new MXPlayer({
  target: '#player',
  source: { kind: 'url', url: 'https://media.example.com/video.mkv' },
  wasmBaseUrl: 'https://cdn.example.com/mx-player/wasm/',
})

await player.ready
await player.play()
```

