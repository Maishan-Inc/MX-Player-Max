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
| `locale` | `en | zh-CN | zh-TW | ja | auto`，默认 `en` | 选择内置文案包；`auto` 依次读取宿主 `<html lang>`、`navigator.languages`、`navigator.language` |
| `features` | `PlayerUiFeatureOptions` | 分别启用下一集、音量、字幕、PiP、剧场、设置、统计、关于、全屏、预览、右键菜单、循环、迷你播放器、复制分享项、排查项和控制栏锁定 |
| `labels` | `Partial<PlayerUiLabels>` | 在所选 locale 之上逐条覆盖可见文本、tooltip 与 ARIA label |
| `share` | `PlayerUiShareOptions` | 右键菜单复制项使用的地址；UI 不从引擎内部推导媒体地址 |
| `autoHideDelayMs` | `5000` | 允许范围 500-30000 ms；与 MXAnime-CMS 内置播放器一致 |
| `nextEpisode` | callback + unavailable behavior | 只把命令交给宿主，不管理播放列表 |
| `theaterMode` | `TheaterModeAdapter` | 宿主拥有的 get/set/subscribe 状态 |
| `onError` | `(summary) => void` | 只返回 `UI_*` code 与 recoverable，不泄露原始异常 |

默认开启下一集、音量、字幕、PiP、设置、统计、关于、全屏、预览、右键菜单、循环、迷你播放器、复制分享项、排查项和控制栏锁定；剧场模式默认关闭。下一集没有 callback 时可选择 disabled 或 hidden。

### 语言包

`en`、`zh-CN`、`zh-TW`、`ja` 四个包由类型强制完整：缺少任何一个 key 是编译错误，不会出现英文串漏进本地化界面。包与协商函数从公共入口导出：

```ts
import {
  PLAYER_UI_LOCALES,
  PLAYER_UI_LOCALE_CODES,
  playerUiLabels,
  matchPlayerUiLocale,
  resolvePlayerUiLocale,
  detectPlayerUiLocale,
} from '@mx-player-max/ui'
```

`matchPlayerUiLocale()` 对无法匹配的标签返回 `null`；`resolvePlayerUiLocale()` 回退 `en`；`detectPlayerUiLocale()` 按偏好顺序取第一个命中项。`zh`、`zh-Hans-CN` 归到 `zh-CN`，`zh-Hant`、`zh-TW`、`zh-HK`、`zh-MO` 归到 `zh-TW`。挂载后的根节点带 `data-mxp-locale`。

### PlayerUiShareOptions

| 字段 | 默认 | 说明 |
|---|---|---|
| `videoUrl` | `pageUrl`，再回退宿主 `location.href` | 复制视频网址使用的地址 |
| `pageUrl` | 宿主 `location.href` | 复制嵌入代码与调试信息中的页面地址 |
| `embedUrl` | `pageUrl` | iframe `src` |
| `timeParam` | `t` | 复制当前时间时写入的查询参数，单位为整秒 |
| `embedWidth` / `embedHeight` | `560` / `315` | iframe 尺寸 |
| `title` | `MX Player Max` | iframe `title` |

嵌入代码对 URL 与标题做 HTML 属性转义，无法解析的地址原样返回而不是被改写。

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

字幕入口不是模态浮层，而是贴在控制栏右上方的弹窗（`.mxp-subtitle-menu`），形态与 MX-Player-Pro 一致：

| 页 | 内容 |
|---|---|
| 字幕 | 关闭字幕 + 轨道列表，每行附来源与轨道状态 |
| 选择字体 | 六个 CJK 优先字体栈，选中项打勾，每行用该字体渲染 `ABCabc123` 样张 |
| 字幕样式 | 字号、水平/垂直位置、描边宽度、文字与描边颜色、粗体/斜体/下划线、对齐方式、恢复默认 |

弹窗打开期间画面保持静止：这是一次比较任务，动画会干扰判断。挂起由弹窗与编辑模式共同持有，两者都关闭后才恢复；打开前用户自己按下的暂停不会被覆盖，播放按钮在挂起期间禁用并给出提示。列表高度由轨道数决定，切页不会在指针下改变弹窗尺寸。

弹窗标题栏的齿轮进入编辑模式：画面上出现一条虚线参考框（`[data-mxp-guide="true"]`），底部细条（`.mxp-subtitle-edit-bar`）给出操作提示、当前数值、恢复默认与完成。编辑模式叠在弹窗之上，字体列表始终只差一次点击。

拖拽行为与 MX-Player-Pro 一致：

- 参考框只上下移动，横向位置由样式页的水平位置决定，拖拽不会改写它；
- 上下句柄按指针到参考框中心的距离比例缩放字号（拉到两倍距离即两倍字号），两条边因此对称，句柄正好落在中心时忽略本次拖拽而不是除零；
- 字号仍受引擎的 6-256 px 约束，写入按 80 ms 限频并在结束时 flush。

UI 不解析 SRT/ASS，不读取 cue 正文，不建立自己的 localStorage key。默认 `SubtitleStyleStore` 仍由 subtitles 包按 URL origin 或 `local-file` 作用域管理。参考框和句柄只把受限的 x/y/fontSize 写回公共样式 API。

## 8. 控件、浮层与键盘

- 进度支持 click、pointer capture drag、80 ms 连续 seek、release flush、Home/End、Arrow 与 Page 键。
- 已播放填充是连续的一条，跟随播放头；缓冲仍按真实区间分段，不合并 gap。
- 拖拽期间填充跟随指针：本地拖拽位置只是视觉反馈，快照确认到目标位置（或 1.2 s 无人应答）后交回快照。
- 预览在 fine pointer 悬停 100 ms 后请求；移动会 abort 旧请求，触摸布局只保留正常 seek。
- 设置、关于、排查播放问题共用一个主浮层状态机；任何时刻最多一个。字幕弹窗与编辑条不属于该状态机，可与设置以外的表面共存。
- 详细统计信息是独立的非模态浮层，可以与浮层、菜单和正常播放同时存在。
- Escape、外部 pointerdown 关闭；打开后焦点进入面板，关闭后恢复到 trigger。
- 播放中自动隐藏，默认 5 s；指针离开播放器立即收起。`playbackchange` 每秒到达数次但不会重置倒计时，只有真实交互才重新计时。
- pointer、menu、drag、overlay 和键盘 focus 期间保持显示；点击留下的 focus 不算交互，鼠标点完播放后控制栏仍会收起。焦点进入播放器区域本身会重新显示控制栏，随后的 Tab 才能落到控件上。
- 全屏且控制栏收起时隐藏光标，锁定且锁图标收起时同样隐藏。
- 快捷键为 Space、方向键、F、M、C；表单、range、button、menu/dialog/contenteditable 内抑制。任一被处理的按键都会重新显示控制栏。
- Escape 的优先级为：右键菜单 → 字幕弹窗 → 浮层 → 迷你播放器。

### 8.0 控制栏锁定

全屏或剧场模式下，播放器左侧中部出现锁定按钮（`features.lockControls`，默认开启）。锁定后控制栏、状态层与所有浮层收起，指针与键盘对播放不再生效，只有锁图标本身可点；锁图标 5 s 无操作后淡出并隐藏光标，指针移动重新唤出。窗口模式不显示该按钮。根节点用 `data-mxp-locked` 与 `data-mxp-lock-chrome` 公开这两个状态，宿主可据此调整自己的 chrome。

## 8.1 右键菜单

菜单监听共享宿主而不是 UI 根节点：播放 surface 是根节点的兄弟元素，根节点中心对指针透明，只有挂在宿主上才能接住 video/canvas 区域的右键。`features.contextMenu: false` 时恢复浏览器原生菜单。

分三组，空组连同分隔线一起消失。每一项都带一个 Lucide 图标，可勾选项额外保留左侧勾选位，使标签始终对齐：

| 组 | 条目 | 行为 |
|---|---|---|
| 播放 | 循环播放、迷你播放器 | 循环是 `menuitemcheckbox`，切换后菜单保持打开 |
| 复制 | 复制视频网址、复制当前时间的视频网址、复制嵌入代码 | 走 `share` 配置，写入剪贴板后提示 toast |
| 诊断 | 复制调试信息、排查播放问题、详细统计信息 | 调试信息是 JSON，排查项打开浮层，统计信息切换非模态浮层 |

再次右键把菜单移动到新位置而不是留下旧副本。菜单支持 ArrowUp/ArrowDown/Home/End/Tab 循环移动焦点，Escape 关闭并把焦点交回根节点。

循环通过公共 SDK 契约实现：`ended` 快照到达时 `seek(0)` 再 `play()`，Native 与 Custom 两条管线行为一致；重入保护确保一次结束只触发一次重启。迷你播放器不开新窗口，只在宿主与根节点上写 `data-mxp-mini`，由样式表把宿主停靠到视口角落。宿主祖先不得留下 `transform`、`filter` 或 `will-change`，否则会成为 fixed 定位的包含块。

## 8.2 详细统计信息

浮层每秒刷新，并跟随 `playbackchange` 重绘，11 行全部来自公共 API：

| 行 | 来源 |
|---|---|
| 视频 ID / sCPN | `share.videoUrl` 或 `media` 身份的 11 位派生 ID，加每个 session 生成的 16 位客户端 nonce |
| 视口 / 帧数 | 根节点 client 尺寸；帧数取 `nativeStats` 或 `customVideoStats` + `rendererStats` |
| 当前 / 最佳分辨率 | 视频轨尺寸与帧率；最佳值按视口 × devicePixelRatio |
| 音量 / 归一化 | 快照音量与静音，附采样率、声道与自定义音频 transport |
| 编解码器 | 视频与音频轨的 codec 与 track id |
| 色彩 | 视频轨 `color.primaries / transfer`，附位深与 HDR 格式 |
| 连接速度 | 采样窗口内的峰值吞吐；无采样时回退 `navigator.connection.downlink` |
| 网络活动 | 缓冲前沿推进量 × 声明码率的估算值，附最近 40 个采样的柱状图 |
| 缓冲健康度 | `bufferedAhead`，以 30 s 为满刻度，低于 2 s 且正在播放时转为警告色 |
| 调试串 | backend、state、时间、缓冲区间、renderer、时钟源、解码队列、epoch、速率的单行 token |
| 日期 | 按所选 locale 的 `Intl.DateTimeFormat` |

SDK 不暴露字节计数器，所以网络活动与连接速度是派生估算而不是实测流量。停靠为迷你播放器时该浮层隐藏。排查播放问题在同一批数据上给出 findings：丢帧比例、缓冲饥饿、引擎错误码、音频时钟缺失、WASM 软解，并提供可复制的环境报告。

## 9. CSS 契约

```ts
import '@mx-player-max/ui/style.css'
```

包不会运行时注入 `<style>`。所有 UI 类名以 `mxp-` 开头，公开视觉参数以 `--mxp-*` 开头。默认视觉为单色 chrome：`--mxp-accent` 在 dark 主题为白、light 主题为黑，`--mxp-scrim` 提供控制栏底部遮罩，`--mxp-control-size` 基线 36 px 按钮。图标按钮没有悬停或开启态的圆形底色：悬停只提高不透明度，开启态在图标下画一条 `--mxp-accent` 细线。`<=760px` 隐藏音量 slider 与剧场按钮，`<=420px` 重排控制行；focus-visible 与 `prefers-reduced-motion` 由样式表实现。覆盖任一 token 即可换色，不需要 fork 样式表。

诊断浮层是唯一离开单色语言的表面，它自带 `--mxp-stats-bg`、`--mxp-stats-meter`、`--mxp-stats-graph`、`--mxp-stats-warn` 四个 token，其余表面仍然只用单色 token。停靠状态由 `.mxp-player-host[data-mxp-mini="true"]` 提供，宿主可以覆盖 inset 与宽度改变停靠角。

SDK/UI/React/Vue 入口是 ESM + declarations；Browser 另外发布 `./iife`、`./iife.min` 和 `./style.css`。IIFE 全局名为 `MXPlayerMax`，固定版本 URL 和 SRI 从 release manifest 取得。

## 10. React 与 Vue

`@mx-player-max/react` 和 `@mx-player-max/vue` 都导出一个 `MXPlayer` 组件以及 typed handle。组件创建一个共享宿主，挂载 SDK 后挂载 UI；配置对象 identity 改变分别触发 `player.load()` 或 `ui.update()`；卸载时 UI 优先销毁。

适配器不会自动导入 CSS，也不实现控制 DOM。完整示例见各包 README。

## 11. 错误与范围

UI 稳定错误码：`UI_DESTROYED`、`UI_INVALID_CONTAINER`、`UI_INVALID_OPTIONS`、`UI_OPERATION_FAILED`。公共 UI/播放错误不包含 URL query、字幕全文、DOMException、内部 stack 或宿主异常 message。

当前明确不包含真实 Codec WASM/Core 接入、PGS/VobSub、完整 libass、字幕内容编辑器、播放列表业务、Custom 内建预览解码或 Document PiP。迷你播放器是页内停靠，不是 Document Picture-in-Picture。IIFE 只代表 Browser 的 SDK + UI 组合，不代表所有 Codec 已支持。
