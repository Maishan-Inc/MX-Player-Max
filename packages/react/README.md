# @mx-player-max/react

React 18+ 的 SDK + UI 薄适配器。组件只创建共享宿主、挂载 `MXPlayer` 和 `@mx-player-max/ui`，不复制控制状态机、快捷键或字幕逻辑。

许可证：`PolyForm-Noncommercial-1.0.0`。React 与 Vue peer dependency 不会被打入 SDK；应用仍需显式导入 UI CSS。

```tsx
import { useMemo, useRef } from 'react'
import {
  MXPlayer,
  type MXPlayerComponentHandle,
} from '@mx-player-max/react'
import '@mx-player-max/ui/style.css'

export function VideoView() {
  const handle = useRef<MXPlayerComponentHandle>(null)
  const playerOptions = useMemo(() => ({
    source: { kind: 'url' as const, url: 'https://media.example.com/video.mp4' },
    subtitles: { enabled: true },
  }), [])
  const uiOptions = useMemo(() => ({
    theme: 'dark' as const,
    features: { theater: false },
  }), [])

  return (
    <MXPlayer
      ref={handle}
      className="video-host"
      playerOptions={playerOptions}
      uiOptions={uiOptions}
    />
  )
}
```

`playerOptions` 不包含 `target`；组件把自身宿主传给 SDK。对象 identity 改变时调用 `player.load()` 换源，`uiOptions` identity 改变时调用 `ui.update()`。卸载顺序固定为 UI destroy 后 player destroy，并支持 SSR 导入时不访问 DOM。

ref 暴露 `{ player, ui }` 只读句柄。样式必须由应用显式导入 `@mx-player-max/ui/style.css`。
