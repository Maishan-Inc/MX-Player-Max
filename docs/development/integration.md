# SDK 与可选 UI 接入

## 1. 原生 DOM

```bash
pnpm add @mx-player-max/sdk @mx-player-max/ui
```

```ts
import { MXPlayer } from '@mx-player-max/sdk'
import { attachPlayerUi } from '@mx-player-max/ui'
import '@mx-player-max/ui/style.css'

const host = document.querySelector<HTMLElement>('#player')!
const player = new MXPlayer({
  target: host,
  source: { kind: 'url', url: 'https://media.example.com/movie.mp4' },
  native: { crossOrigin: 'anonymous', preload: 'metadata' },
  subtitles: { enabled: true },
})
const ui = attachPlayerUi(player, host, { theme: 'system' })

await player.ready
```

宿主需要给容器稳定尺寸和定位上下文，例如 `position: relative; aspect-ratio: 16 / 9`。SDK 和 UI 必须共享该容器；UI 不固定到 Demo DOM。

卸载：

```ts
ui.destroy()
player.destroy()
```

## 2. 换源

```ts
await player.load({
  target: host,
  source: { kind: 'file', file },
  intent: 'normal',
  subtitles: { enabled: true },
})

await player.ready
```

`ready` 始终指向当前 load。UI 继续挂载在原容器并从新的 `sessionEpoch` 自动重置 preview、seek、菜单和字幕编辑交互。

## 3. Custom 预览 provider

Custom 路径没有内建缩略图 decoder。应用可提供已有 thumbnail service：

```ts
const player = new MXPlayer({
  target: host,
  source,
  intent: 'filters',
  preview: {
    provider: async ({ time, width, height, signal }) => {
      const blob = await thumbnails.fetch({ time, width, height, signal })
      return blob ? { blob, time, width, height } : null
    },
  },
})
```

provider 不应读取 SDK/Core 私有 Frame、renderer 或 canvas。没有 provider 时 UI 隐藏预览图片，但 seek 正常工作。

## 4. React

```tsx
import { MXPlayer } from '@mx-player-max/react'
import '@mx-player-max/ui/style.css'

<MXPlayer
  className="player-host"
  playerOptions={{ source, subtitles: { enabled: true } }}
  uiOptions={{ theme: 'dark' }}
/>
```

生产组件应 memoize `playerOptions`/`uiOptions`。顶层 identity 改变会分别触发 `load()` 与 `update()`。

## 5. Vue

```vue
<script setup lang="ts">
import { MXPlayer } from '@mx-player-max/vue'
import '@mx-player-max/ui/style.css'
</script>

<template>
  <MXPlayer
    class="player-host"
    :player-options="playerOptions"
    :ui-options="uiOptions"
  />
</template>
```

React/Vue 适配器自动按 UI -> SDK 顺序清理，但不会自动导入 CSS。

## 6. 远程媒体

Custom Range 路径要求服务器允许宿主 origin 的 CORS、GET Range 和 `206 Partial Content`，并暴露：

```http
Access-Control-Allow-Origin: https://app.example.com
Access-Control-Allow-Headers: Range
Access-Control-Expose-Headers: Content-Range, Content-Length, Accept-Ranges, ETag
Accept-Ranges: bytes
```

Native HTMLVideo 无法发送自定义 headers。带 `SourceDescriptor.headers` 的源若最终选择 Native，会返回 `NATIVE_CUSTOM_HEADERS_UNSUPPORTED`。

外挂字幕和 Native preview 也需要源站 CORS。preview 画布被污染或编码失败会静默降级，不会阻止播放。

## 7. HTTPS 与跨源隔离

生产宿主使用 HTTPS。WebCodecs/WebGPU 的实际可用性由 runtime probe 决定。多线程 WASM 后续还需要宿主设置 COOP/COEP；SDK 不能从 JS 设置响应头，Phase 9 也未进入 Phase 10 Codec 实现。

完整 API 见 `docs/api/player-ui.md`，分发约束见 `docs/architecture/distribution-and-embedding.md`。
