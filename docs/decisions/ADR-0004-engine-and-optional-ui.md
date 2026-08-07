# ADR-0004：引擎与可选 UI 包分离

## 状态

已接受。

## 背景

`@mx-player-max/sdk` 只提供引擎 API：`load`、`play`、`seek`、事件、诊断。开发者拿到它之后屏幕上没有任何控件——没有播放按钮、没有进度条、没有字幕菜单。

Web 播放器生态有两种成熟形态：

| 形态 | 代表 | 开发者拿到什么 |
|---|---|---|
| 纯引擎 | hls.js、Shaka Player、dash.js | 只有 `<video>` 加数据管线，控件自己写 |
| 引擎 + UI | Video.js、Plyr、Vidstack | `import` 之后即有完整外观 |

纯引擎形态在自定义解码路径下不成立。`hls.js` 能只做引擎，是因为它最终把数据喂给 `<video>` 元素，浏览器自带的 `controls` 属性就能提供一套可用控件。MX-Player-Max 的 WebCodecs 与 WASM 路径把画面渲染到 `<canvas>`，`controls` 属性对 canvas 无效——**开发者不写 UI 就完全没有 UI**。

同时字幕能力也无处安放。SRT/ASS 解析属于引擎，但轨道菜单、字体选择器、拖拽调节字幕位置属于 UI。若不设 UI 包，这些能力要么塞进 SDK（违反 `AGENTS.md` 第 57 行"禁止在 core 内写 UI 组件"的分层意图），要么只存在于演示站（不可复用，开发者要重写）。

## 决策

发布两个可独立使用的层：

```
@mx-player-max/sdk      引擎，零 DOM 控件，无 CSS      ← 必需
@mx-player-max/ui       控制条、菜单、字幕层、主题      ← 可选
```

**引擎不依赖 UI，UI 依赖引擎。** 依赖方向单向，`packages/ui/package.json` 声明 `@mx-player-max/sdk` 为 dependency，反向禁止。

三种接入姿势并存：

```js
// 1. 纯引擎——自己画控件（hls.js 式）
import { createPlayer } from '@mx-player-max/sdk'
const player = createPlayer({ container })

// 2. 引擎 + 官方 UI（Video.js 式）
import { createPlayer } from '@mx-player-max/sdk'
import { attachUi } from '@mx-player-max/ui'
import '@mx-player-max/ui/style.css'
attachUi(player, { theme: 'dark' })

// 3. UMD 一行接入（无构建工具）
<script src="https://cdn.jsdelivr.net/npm/@mx-player-max/ui/dist/mx-player.min.js"></script>
<script>MXPlayerMax.mount('#player', { src: '...' })</script>
```

UI 包用**框架无关的原生 DOM** 实现，不用 React。`@mx-player-max/react` 与 `@mx-player-max/vue` 是对 SDK + UI 的薄封装，不是 UI 的实现载体。原因：UI 若用 React 写，则 UMD 产物必须内联整个 React 运行时（约 45 KB gzip），而 UMD 的目标用户恰恰是无构建工具、不用 React 的页面。

CSS 通过独立文件分发，不用 CSS-in-JS，不注入 `<style>`。开发者可以只引入 `style.css` 的一部分，或完全替换。所有类名带 `mxp-` 前缀，所有可调值走 CSS 自定义属性。

## 外观参考与边界

外观参考 `MX-Player-Pro` 的**交互模式**，不复制其实现文件与演示站视觉。

可以借鉴的（交互决策，经过实际使用验证）：

- 控制条分左右两组：左组是高频操作（播放、下一集、音量），右组是模式切换（字幕、画中画、剧场、设置、全屏）。
- 字幕菜单分"轨道"与"字体"两页，而非一个长列表。
- 字幕样式按播放域名分作用域持久化，而不是全局——为 A 站调好的字号不该跟到 B 站。
- 字幕支持拖拽调整位置和大小，句柄在字幕上下边缘。
- 字幕菜单/编辑器打开时暂停播放，避免边调边跑。
- 设置面板、统计面板、关于面板作为浮层，不挤占控制条。

不可复制的（`AGENTS.md` 第 13 行约束）：

- 演示站的页面结构、配色、GSAP 动画编排、信息架构。
- Pro 的源文件本身——UI 包是重新实现，不是拷贝。

Pro 的 UI 与 MKV/WebCodecs 单一路径耦合；Max 的 UI 必须同时服务 NativeMediaPipeline（`<video>`）与 CustomMediaPipeline（`<canvas>`），控制层不能假设承载元素类型。这是重写而非移植的技术原因。

## 后果

正面：

- 开发者可以像 Video.js 一样"装上即用"，这是项目的既定目标。
- 字幕 UI 能力有了明确归属，可复用而非困在演示站。
- 纯引擎用户不为 UI 付出体积——`@mx-player-max/sdk` 不含任何 UI 代码。
- 演示站改为消费 `@mx-player-max/ui`，等于让官方 UI 持续接受真实使用检验。

负面：

- 多一个包要维护、发版、写文档、做无障碍。
- UI 与引擎的版本兼容需要约定（UI 的 peerDependency 锁 SDK 的 minor 范围）。
- 原生 DOM 实现比 React 实现啰嗦，但这是 UMD 目标换来的必要代价。

## 相关

- `docs/architecture/ui-package.md`——UI 包的组件结构、CSS 契约与主题变量。
- `docs/architecture/distribution-and-embedding.md`——三种接入方式与 UMD 产物。
- `ADR-0001`——双渲染路径，是 UI 不能假设承载元素类型的根因。
