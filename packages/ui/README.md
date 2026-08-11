# @mx-player-max/ui

可选、框架无关的播放器控制界面。实现使用原生 DOM + TypeScript，只消费 SDK 公共 API，适配 Native `<video>` 与 Custom `<canvas>` 两条输出路径。

## 安装与挂载

```bash
pnpm add @mx-player-max/sdk @mx-player-max/ui
```

```ts
import { MXPlayer } from '@mx-player-max/sdk'
import { attachPlayerUi } from '@mx-player-max/ui'
import '@mx-player-max/ui/style.css'

const host = document.querySelector<HTMLElement>('#player')!
const player = new MXPlayer({ target: host, source })
const ui = attachPlayerUi(player, host, {
  theme: 'system',
  autoHideDelayMs: 2500,
  features: { theater: true, nextEpisode: true },
  nextEpisode: { onRequest: () => openNextEpisode() },
  theaterMode,
})

await player.ready
```

播放器输出与 UI 必须挂载到同一个定位容器，才能让全屏同时包含媒体、字幕和控制层。UI 不移动、查询或控制容器中的 video/canvas 节点。

## 生命周期

```ts
import { createPlayerUi } from '@mx-player-max/ui'

const ui = createPlayerUi(player, options)
ui.attach(firstHost)
ui.attach(firstHost)       // 重复 attach：同步当前状态
ui.attach(secondHost)      // 重新挂载并清理旧监听
ui.update(nextOptions)     // 全量替换配置
ui.destroy()
ui.destroy()               // 幂等
```

销毁后的 `attach()`/`update()` 抛出 `UI_DESTROYED`。UI 不拥有传入的 `MXPlayer`，宿主应先 `ui.destroy()`，再 `player.destroy()`。换源、重新挂载和销毁都会使旧的 seek、预览、菜单、字幕拖拽与焦点任务失效。

## 控件与能力

- 左侧：播放/暂停、可选下一集、静音、音量与音量滑块。
- 右侧：字幕、PiP、可选剧场模式、设置和全屏。
- 进度条：played/buffered 多段范围、未知 duration、指针/拖拽/键盘连续 seek。
- 浮层：互斥的字幕、设置、统计与关于面板，支持 Escape、外部点击和焦点恢复。
- 状态：loading、buffering、ready、playing、paused、seeking、ended 和安全 error 摘要。

按钮是否激活或可用完全取自 `player.playback`。无 PiP、全屏或预览能力时安静降级；下一集只调用宿主回调，不实现播放列表业务。

Custom 预览由宿主通过 `MXPlayerOptions.preview.provider` 提供。Native 使用 Core 的隔离预览服务。UI 从不读取活动媒体元素、`VideoFrame`、canvas 像素或 GPU 资源。

## 字幕与快捷键

字幕面板复用 Phase 8 的轨道、事件、样式校验和 `SubtitleStyleStore`。UI 不解析字幕，也不访问 localStorage。轨道关闭/选择、字体栈、字号、alignment、x/y、文字/描边颜色、描边宽度和粗斜体/下划线均通过 SDK API 更新；位置/上下句柄拖拽受安全显示区限制。

快捷键：Space 播放/暂停，左右方向键 seek，上下方向键调音量，`F` 全屏，`M` 静音，`C` 字幕。输入框、滑块、按钮、菜单和对话框不会触发全局快捷键。

## CSS 与主题

样式只从 `@mx-player-max/ui/style.css` 发布，不在运行时注入。所有类名使用 `mxp-` 前缀，可调 token 使用 `--mxp-*`，例如：

```css
.player-host {
  --mxp-accent: #2f9f8f;
  --mxp-focus: #8bd9ff;
  --mxp-panel-radius: 4px;
  --mxp-control-size: 40px;
}
```

`theme` 支持 `dark | light | system`。在 `<=760px` 隐藏音量滑块和剧场按钮，在 `<=420px` 重排控制行；`prefers-reduced-motion` 会移除状态过渡。

完整 API 与集成说明见 `docs/api/player-ui.md`。Browser 包会把本 UI 与 SDK 组合为 ESM/IIFE，但 UI 包自身仍不包含 WASM Codec、PGS/VobSub、完整 libass、字幕内容编辑器、播放列表业务或 Custom 内建预览解码。许可证为 `PolyForm-Noncommercial-1.0.0`。
