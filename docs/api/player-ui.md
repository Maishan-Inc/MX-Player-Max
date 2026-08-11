# 播放状态、预览与可选 UI API

本文记录当前 SDK、UI、Browser 和框架适配器的公共契约。所有示例只使用 `@mx-player-max/sdk`、`@mx-player-max/types`、`@mx-player-max/ui`、`@mx-player-max/browser`、`@mx-player-max/react` 或 `@mx-player-max/vue` 的公共入口。

## 1. 原生 DOM 接入

```ts
import { MXPlayer } from '@mx-player-max/sdk'
import { attachPlayerUi } from '@mx-player-max/ui'
import '@mx-player-max/ui/style.css'

const host = document.querySelector<HTMLElement>('#player')!
const player = new MXPlayer({
  target: host,
  source: { kind: 'url', url: 'https://media.example.com/video.mp4' },
  subtitles: { enabled: true },
})

const ui = attachPlayerUi(player, host, {
  theme: 'system',
  features: { theater: true },
  theaterMode,
  nextEpisode: {
    unavailableBehavior: 'disabled',
    onRequest: async () => loadNextEpisode(),
  },
})

await player.ready
```

同一个 `host` 同时交给 SDK 与 UI。SDK 管理媒体 surface 与字幕 overlay，UI 只追加自己的控制层。这样 Native video、Custom canvas、字幕和控制条能作为一个容器进入全屏。

## 2. UI 生命周期

`createPlayerUi(player, options)` 创建但不挂载。`attachPlayerUi(player, container, options)` 创建并立即挂载。两者都返回：

```ts
interface PlayerUiController {
  readonly attached: boolean
  attach(container: HTMLElement): void
  update(options: PlayerUiOptions): void
  destroy(): void
}
```

- 对同一容器重复 `attach()` 会重新同步 SDK 当前状态。
- 对新容器 `attach()` 会清除旧容器的 DOM、监听、timer、pointer 和焦点资源后重新挂载。
- `update()` 是全量配置替换，不是递归 merge；省略的字段恢复默认值。
- `destroy()` 幂等，但销毁后的 `attach()`/`update()` 返回 `UI_DESTROYED`。
- UI 不拥有播放器。宿主卸载顺序是 `ui.destroy()` 后 `player.destroy()`。
- 每次挂载、配置更新、媒体换源与销毁都会使旧生命周期或 session epoch 的异步结果失效。

## 3. PlayerUiOptions

| 字段 | 类型/默认 | 说明 |
|---|---|---|
| `theme` | `dark | light | system`，默认 `dark` | 设置 `data-mxp-theme` 并选择 CSS token |
| `features` | `PlayerUiFeatureOptions` | 分别启用下一集、音量、字幕、PiP、剧场、设置、统计、关于、全屏和预览 |
| `labels` | `Partial<PlayerUiLabels>` | 替换可见文本、tooltip 与 ARIA label |
| `autoHideDelayMs` | `2500` | 允许范围 500-30000 ms |
| `nextEpisode` | callback + unavailable behavior | 只把命令交给宿主，不管理播放列表 |
| `theaterMode` | `TheaterModeAdapter` | 宿主拥有的 get/set/subscribe 状态 |
| `onError` | `(summary) => void` | 只返回 `UI_*` code 与 recoverable，不泄露原始异常 |

默认开启下一集、音量、字幕、PiP、设置、统计、关于、全屏和预览；剧场模式默认关闭。下一集没有 callback 时可选择 disabled 或 hidden。

## 4. PlaybackSnapshot

`MXPlayer.playback` 和 `playbackchange` 是 UI 的唯一已提交播放状态来源：

```ts
player.on('playbackchange', ({ snapshot, reason }) => {
  console.log(snapshot.state, snapshot.currentTime, reason)
})
```

`PlaybackSnapshot` 包含：

- `sessionEpoch`：每次 load/replace source 的代际。
- `state`：`idle | loading | ready | playing | paused | seeking | ended | error | closed`。
- `paused`、`seeking`、`buffering`：意图与正交状态。
- `currentTime`、`duration`：整数微秒或 `null`。
- `played`、`buffered`：归一化、只读的微秒半开范围集合。
- `bufferedAhead`、`volume`、`muted`、`playbackRate`。
- `presentationMode`：`inline | fullscreen | picture-in-picture`。
- `capabilities`：seek、volume、playbackRate、fullscreen、PiP、preview。
- `lastError`：只有安全的 `code` 与 `recoverable`。

未知或非有限媒体时间转换为 `null`，不会把 `NaN`/`Infinity` 传播给 UI。控制器可以显示临时拖拽位置，但播放/音量/展示模式的已提交值只能由后续快照确认。

`PlaybackChangeReason` 用于限频或诊断：`load | state | time | buffer | volume | rate | presentation | capabilities | error`。

### Playback Decision Trace

`player.decisionTrace` 与 `decisionchange` 提供当前 load epoch 的只读决策链：候选排序、初始与
最终分数、平台 adjustment、初始化 attempt、最终选择或稳定失败码。快照不会暴露 source
URL/header、Codec private data、原始异常、Frame、PCM 或字幕正文。UI 和 Demo 可以显示该
快照，但不得据此绕过 SDK 的实际能力检测或自行强制不存在的后端。

## 5. 换源与 ready

```ts
await player.load({
  target: host,
  source: { kind: 'file', file },
  intent: 'normal',
})

await player.ready
```

`load()` 可重复调用，并在开始新会话前提升 epoch、原子清理旧管线。`ready` getter 始终返回最近一次 load promise，而不是只指向构造时的请求。旧 load、seek、preview 或事件不能覆盖新会话。

## 6. 预览契约

```ts
const controller = new AbortController()
const preview = await player.requestPreview({
  time: 12_000_000,
  width: 160,
  height: 90,
  signal: controller.signal,
})
```

默认尺寸为 160x90；当前上限为 320x180、57,600 像素、512 KiB 编码 Blob 和 2,500 ms。MIME 只允许 PNG、JPEG、WebP。非法时间或尺寸以 `PREVIEW_INPUT_INVALID` 拒绝；不支持、abort、超时、解码/CORS/编码失败和 provider 异常都安静返回 `null`。

Native 路径使用与活动 video 隔离的 muted preview element 和有界 canvas，不 seek 或暂停活动播放。Custom 路径不内建第二套 decoder，只有传入 provider 时才报告能力：

```ts
const player = new MXPlayer({
  target: host,
  source,
  intent: 'frame-access',
  preview: {
    provider: async ({ time, width, height, sessionEpoch, signal }) => {
      const blob = await thumbnailService.get({ time, width, height, signal })
      return blob ? { blob, time, width, height } : null
    },
  },
})
```

provider 只收到 time、duration、dimensions、sessionEpoch 与 AbortSignal。它不会收到 source、URL、codec private、Frame、PCM、canvas、renderer 或 GPU 对象。Core 执行 latest-wins、abort、预算、结果校验和 session epoch 检查。

## 7. 字幕 UI

字幕控件只调用 Phase 8 API：`subtitleTracks`、`selectedSubtitleTrack`、`subtitleState`、`subtitleStyle`、`selectSubtitleTrack()`、`setSubtitleStyle()` 和 `resetSubtitleStyle()`。关闭字幕等价于选择 `null`。

UI 不解析 SRT/ASS，不读取 cue 正文，不建立自己的 localStorage key。默认 `SubtitleStyleStore` 仍由 subtitles 包按 URL origin 或 `local-file` 作用域管理。位置和上下句柄只把受限的 x/y/fontSize 写回公共样式 API。

## 8. 控件、浮层与键盘

- 进度支持 click、pointer capture drag、80 ms 连续 seek、release flush、Home/End、Arrow 与 Page 键。
- 预览在 fine pointer 悬停 100 ms 后请求；移动会 abort 旧请求，触摸布局只保留正常 seek。
- 字幕、设置、统计、关于共用一个主浮层状态机；任何时刻最多一个。
- Escape、外部 pointerdown 关闭；打开后焦点进入面板，关闭后恢复到 trigger。
- 播放中自动隐藏；pointer、keyboard、focus、menu、drag 期间保持显示。
- 快捷键为 Space、方向键、F、M、C；表单、range、button、menu/dialog/contenteditable 内抑制。

## 9. CSS 契约

```ts
import '@mx-player-max/ui/style.css'
```

包不会运行时注入 `<style>`。所有 UI 类名以 `mxp-` 开头，公开视觉参数以 `--mxp-*` 开头。`<=760px` 隐藏音量 slider 与剧场按钮，`<=420px` 重排控制行；focus-visible 与 `prefers-reduced-motion` 由样式表实现。

SDK/UI/React/Vue 入口是 ESM + declarations；Browser 另外发布 `./iife`、`./iife.min` 和 `./style.css`。IIFE 全局名为 `MXPlayerMax`，固定版本 URL 和 SRI 从 release manifest 取得。

## 10. React 与 Vue

`@mx-player-max/react` 和 `@mx-player-max/vue` 都导出一个 `MXPlayer` 组件以及 typed handle。组件创建一个共享宿主，挂载 SDK 后挂载 UI；配置对象 identity 改变分别触发 `player.load()` 或 `ui.update()`；卸载时 UI 优先销毁。

适配器不会自动导入 CSS，也不实现控制 DOM。完整示例见各包 README。

## 11. 错误与范围

UI 稳定错误码：`UI_DESTROYED`、`UI_INVALID_CONTAINER`、`UI_INVALID_OPTIONS`、`UI_OPERATION_FAILED`。公共 UI/播放错误不包含 URL query、字幕全文、DOMException、内部 stack 或宿主异常 message。

当前明确不包含真实 Codec WASM/Core 接入、PGS/VobSub、完整 libass、字幕内容编辑器、播放列表业务、Custom 内建预览解码或 Document PiP。IIFE 只代表 Browser 的 SDK + UI 组合，不代表所有 Codec 已支持。
