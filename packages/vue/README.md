# @mx-player-max/vue

Vue 3.3+ 的 SDK + UI 薄适配器。组件只管理共享宿主与生命周期，所有控制、快捷键和字幕行为仍由 `@mx-player-max/ui` 实现。

```vue
<script setup lang="ts">
import { shallowRef } from 'vue'
import {
  MXPlayer,
  type MXPlayerComponentHandle,
} from '@mx-player-max/vue'
import '@mx-player-max/ui/style.css'

const handle = shallowRef<MXPlayerComponentHandle | null>(null)
const playerOptions = shallowRef({
  source: { kind: 'url' as const, url: 'https://media.example.com/video.mp4' },
  subtitles: { enabled: true },
})
const uiOptions = shallowRef({ theme: 'dark' as const })
</script>

<template>
  <MXPlayer
    ref="handle"
    class="video-host"
    :player-options="playerOptions"
    :ui-options="uiOptions"
  />
</template>
```

`playerOptions` 不包含 `target`。顶层对象 identity 改变时组件调用 `player.load()`，`uiOptions` identity 改变时调用 `ui.update()`。卸载时先销毁 UI，再销毁播放器；模块导入阶段不访问 DOM。

组件通过 `expose()` 提供 `{ player, ui }` 只读句柄。样式必须由应用显式导入 `@mx-player-max/ui/style.css`。
