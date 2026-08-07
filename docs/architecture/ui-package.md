# UI 包架构

## 1. 定位

`@mx-player-max/ui` 是引擎层 `@mx-player-max/sdk` 的可选伴生包，提供开箱即用的播放器外观。

架构定位（见 `ADR-0004`）：

- **引擎不依赖 UI**，`packages/sdk` 可独立发布，零 UI 代码。
- **UI 依赖引擎**，`packages/ui` 的 `package.json` 声明 `@mx-player-max/sdk` 为 dependency。
- **反向依赖禁止**：`sdk`、`core`、`decoder-*`、`demux`、`renderers` 不得 import UI 包的任何内容。

## 2. 为什么需要 UI 包

自定义解码路径渲染到 `<canvas>`，浏览器的 `controls` 属性对 canvas 无效——**不提供 UI 包，开发者就完全没有 UI**。

`hls.js` 能只做引擎，是因为它最终把数据喂给 `<video>`，浏览器自带的 `controls` 就能提供一套可用控件。MX-Player-Max 的 WebCodecs 与 WASM 路径无此便利。

同时字幕能力也无处安放。SRT/ASS 解析属于引擎（`packages/subtitles`），但轨道菜单、字体选择器、拖拽调节字幕位置属于 UI——若不设 UI 包，这些能力要么塞进 SDK（违反 `AGENTS.md` 分层），要么只存在于演示站（不可复用）。

## 3. 实现技术栈

### 3.1 框架无关的原生 DOM

**不用 React、Vue、Svelte**。用原生 DOM + Web Components（可选）+ TypeScript 实现。

理由：UI 包必须支持 UMD 一行接入。若用 React 写 UI，UMD 产物必须内联整个 React 运行时（约 45 KB gzip），而 UMD 的目标用户恰恰是无构建工具、不用 React 的页面——这是自相矛盾的成本。

原生 DOM 实现比 React 啰嗦，但这是 UMD 目标换来的必要代价。`@mx-player-max/react` 与 `@mx-player-max/vue` 是对 SDK + UI 的薄封装（HOC 或组合式函数），不是 UI 的实现载体。

### 3.2 CSS 独立分发

- **独立文件**：`packages/ui/dist/style.css`，不注入 `<style>`，不用 CSS-in-JS。
- **可裁剪**：开发者可以只引入一部分，或完全替换。
- **类名前缀**：所有类名带 `mxp-` 前缀，避免与宿主页面冲突。
- **主题变量**：所有可调值走 CSS 自定义属性，支持浅色/深色两套 token。

```css
/* 设计 token（OKLCH 色彩空间，保证感知一致） */
:root {
  --mxp-fg: oklch(98% 0 0);
  --mxp-muted: oklch(72% 0 0);
  --mxp-line: oklch(32% 0 0 / 0.16);
  --mxp-panel: oklch(12% 0 0 / 0.96);
  --mxp-track: oklch(64% 0 0 / 0.25);
  --mxp-track-fill: oklch(98% 0 0);
  --mxp-accent: oklch(68% 0.14 270);  /* 中性紫蓝，WCAG AA */
}

[data-mxp-theme="dark"] {
  --mxp-fg: oklch(98% 0 0);
  --mxp-muted: oklch(68% 0 0);
  --mxp-panel: oklch(16% 0 0 / 0.94);
  /* ... */
}
```

## 4. 组件结构

### 4.1 核心层级

```
PlayerContainer (容器，定义作用域)
  └─ PlayerFrame (16:9 容器，container query 宿主)
       ├─ VideoSurface (<canvas> 或 <video>)
       ├─ SubtitleOverlay (字幕层)
       ├─ LoadingSpinner / ErrorMessage
       ├─ BufferingIndicator
       ├─ ControlBar (控制条)
       │    ├─ ProgressRail (进度条 + 悬停预览)
       │    ├─ ControlRow
       │    │    ├─ LeftGroup (播放/下一集/音量)
       │    │    └─ RightGroup (字幕/画中画/剧场/设置/全屏)
       │    └─ TimeReadout
       ├─ SubtitleMenu (字幕菜单：轨道页 + 字体页)
       ├─ SubtitleEditBar (编辑条：拖拽调节 + 确认按钮)
       ├─ SettingsPanel (设置面板)
       ├─ StatsPanel (统计面板)
       ├─ AboutPanel (关于面板)
       └─ ContextMenu (右键菜单)
```

### 4.2 控制条布局（参考 Pro 的交互模式）

**左右分组，高频在左，模式在右：**

```
[播放] [下一集] [音量] [音量滑块] ────────── [字幕] [画中画] [剧场] [设置] [全屏]
   ↑                                                                       ↑
  左组（高频操作）                                                      右组（模式切换）
```

移动端（≤760px）：音量滑块隐藏，剧场按钮隐藏，控制条底部间距收窄。

### 4.3 字幕菜单

两页式（不是长列表）：

- **轨道页**：列出全部字幕轨，当前选中的高亮。关闭按钮在顶部。
- **字体页**：系统默认、黑体、宋体、楷体、圆体、等宽六种字体栈，每个显示真实字体样本。

字幕样式编辑器作为独立浮层，含：

- **字号滑块**：0.6× ~ 2.4×，步进 0.1。
- **垂直偏移滑块**：-11% ~ +74%（底部 12% 基准 + 偏移），显示实时预览。
- **拖拽调节**：字幕上下边缘出现句柄，拖动改变大小或位置，松手后数值同步回滑块。

### 4.4 进度条与悬停预览

- **3 像素轨道**，悬停时增至 5 像素。
- **两层填充**：buffered（半透明）与 played（实色）。
- **悬停预览**：160×90 视频缩略图 + 时间戳，预览帧取自当前帧队列的最近关键帧（WebCodecs 路径）或 `<video>` 快照（原生路径）。移动端与触摸设备禁用预览。

## 5. 外观参考边界

### 5.1 可借鉴（交互决策）

- 控制条左右分组、高频在左。
- 字幕菜单分页而非长列表。
- 字幕样式按域名分作用域持久化（为 A 站调好的字号不跟到 B 站）。
- 字幕支持拖拽调整，句柄在上下边缘。
- 字幕菜单/编辑器打开时暂停播放（避免边调边跑）。
- 设置/统计/关于作为浮层，不挤占控制条。

### 5.2 不可复制（`AGENTS.md` 第 13 行约束）

- MX-Player-Pro 的源文件本身——UI 包是重新实现，不是拷贝。
- Pro 演示站的页面结构、配色、GSAP 动画编排、信息架构。

Pro 的 UI 与 MKV/WebCodecs 单一路径耦合；Max 的 UI 必须同时服务 NativeMediaPipeline（`<video>`）与 CustomMediaPipeline（`<canvas>`），控制层不能假设承载元素类型。这是重写而非移植的技术原因。

## 6. 适配双路径

UI 层通过 SDK 暴露的**统一事件与方法 API** 工作，不直接操作底层 `<video>` 或 `<canvas>`：

```ts
// 引擎抽象
interface MediaEngine {
  play(): void
  pause(): void
  seek(time: number): void
  on(event: string, handler: Function): void
  off(event: string, handler: Function): void
  readonly currentTime: number
  readonly duration: number
  readonly paused: boolean
  readonly volume: number
  set volume(v: number)
  // ...
}
```

UI 包调用 `engine.play()` / `engine.on('timeupdate', ...)` 而非直接操作 DOM 元素。SDK 内部根据路径选择（`NativeMediaPipeline` 操作 `<video>.play()`，`CustomMediaPipeline` 操作内部播放状态）分发实现。

画面挂载点由 SDK 控制：

- **原生路径**：SDK 在容器内创建 `<video>`，UI 叠加控制层。
- **自定义路径**：SDK 在容器内创建 `<canvas>`，UI 叠加控制层。

UI 包不关心底层是哪种元素，只看 `container` 参数和引擎 API。

## 7. 字幕持久化作用域

借鉴 Pro 的设计：**按播放源的域名分作用域**，而非全局单一配置。

```ts
function subtitleStyleScope(source: SourceDescriptor): string {
  if (source.kind === 'file') return 'local-file'
  try {
    return new URL(source.url).hostname || 'unknown-host'
  } catch {
    return 'unknown-host'
  }
}

// localStorage key: `mxp-subtitle-style:${scope}`
```

为 `cdn.example.com` 调好的 1.5× 字号和 +20% 偏移，不会跟到 `another.site` 的播放。本地文件共享一个 `local-file` 作用域。

存储不可用时静默回退默认值（系统字体、1.0× 倍数、0% 偏移），不报错、不阻塞播放。

## 8. 接入方式

### 8.1 ESM（构建工具）

```js
import { createPlayer } from '@mx-player-max/sdk'
import { attachUi } from '@mx-player-max/ui'
import '@mx-player-max/ui/style.css'

const player = createPlayer({ container: document.querySelector('#player') })
attachUi(player, { theme: 'dark' })
player.load({ kind: 'url', url: 'https://...' })
```

### 8.2 React 封装

```jsx
import { MXPlayer } from '@mx-player-max/react'

<MXPlayer src="https://..." theme="dark" />
```

`@mx-player-max/react` 内部调用 SDK + UI。

### 8.3 UMD 一行接入（无构建工具）

```html
<script src="https://cdn.jsdelivr.net/npm/@mx-player-max/ui/dist/mx-player.min.js"></script>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@mx-player-max/ui/dist/style.css">
<div id="player"></div>
<script>
  MXPlayerMax.mount('#player', { src: 'https://...' })
</script>
```

全局名 `MXPlayerMax`（SDK 单独的全局名是 `MXPlayer`，UI 包的 UMD 产物内联 SDK）。

## 9. 无障碍要求

- **键盘可完整操作**：Space 播放/暂停，←/→ seek ±5s，↑/↓ 音量 ±10%，F 全屏，M 静音，C 字幕。
- **焦点顺序稳定**：进度条 → 播放 → 音量 → 字幕 → 设置 → 全屏。
- **所有控件有 `aria-label`**：`aria-label="播放"`，`aria-pressed="true"` 标记激活态。
- **焦点可见**：`focus-visible` 时显示明显的焦点环（2px 实色轮廓，`outline-offset: 2px`）。
- **字幕可读性**：默认描边 `text-shadow: 0 1px 3px #000, 1px 0 #000, -1px 0 #000`，确保在任何背景下可读。
- **尊重 `prefers-reduced-motion`**：禁用控制条淡入动画，spinner 减速至 1.4s。

文本对比度：WCAG AA，主文本 4.5:1，大文本（≥18pt）3:1。

## 10. 构建产物

```
packages/ui/dist/
  ├── index.js          # ESM，tree-shakable
  ├── index.d.ts        # TypeScript 类型定义
  ├── mx-player.min.js  # UMD，全局名 MXPlayerMax，内联 SDK
  └── style.css         # 独立样式文件，两套主题 token
```

`package.json` 导出：

```json
{
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./style.css": "./dist/style.css"
  },
  "unpkg": "./dist/mx-player.min.js",
  "jsdelivr": "./dist/mx-player.min.js"
}
```

## 11. 验收标准（Phase 9 退出条件）

- 同一套 UI 在 NativeMediaPipeline（`<video>`）与 CustomMediaPipeline（`<canvas>`）下行为一致。
- 键盘可完整操作，焦点顺序稳定，控件有 `aria-label`。
- 不引入 UI 包时 SDK 产物体积不变（引擎与 UI 零耦合）。
- 字幕样式按域名分作用域持久化，存储不可用时静默回退。
- 外观参考 MX-Player-Pro 的交互模式，不复制其源文件与演示站视觉。
