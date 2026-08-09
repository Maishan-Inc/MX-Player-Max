# Phase 9 验收记录

日期：2026-08-09

## 实现状态

Phase 9 已交付独立、可选、框架无关的 `@mx-player-max/ui`。同一套原生 DOM + TypeScript 控制器只消费 SDK 公共播放快照、命令、字幕 API 和安全预览 API，可挂载到 Native `<video>` 或 Custom WebGPU/WebGL2/Canvas2D 共用的播放器容器。React 与 Vue 包只负责 SDK/UI 创建、属性更新和 UI-first 销毁，Demo 只展示集成。

本阶段同时补齐了 UI 所需的最小公共播放契约：完整 `PlaybackSnapshot`、标准化 played/buffered ranges、能力与 presentation 状态、可取消预览请求、重复 `load()` 和当前 `ready` promise。UI 不访问 Core、Renderer、Audio、Subtitles、Demux 或 Decoder 内部文件，也不读取活动 video/canvas、`VideoFrame`、GPU 资源、AudioContext、字幕正文或持久化存储。

## UI 交付

- 生命周期：`createPlayerUi()`、`attachPlayerUi()`、重复 attach、重新挂载、完整 options 更新和幂等 `destroy()`。
- 控制条：播放/暂停/重播、可选下一集 callback、静音、音量、字幕、PiP、剧场模式适配器、设置和全屏。
- 时间轴：未知 duration 降级、played/buffered 多段显示、指针/拖动/键盘/连续 seek，以及按实际宿主宽度防溢出的桌面 `160x90` 可取消预览。
- 字幕：关闭、轨道枚举/选择/外挂状态、Phase 8 全部已确认样式字段、位置拖拽和上下字号句柄；解析、验证和 `SubtitleStyleStore` 仍由 Phase 8 公共 API 负责。
- 浮层与状态：设置、统计、关于、字幕单一主浮层，Escape/外部关闭、焦点进入/围困/恢复，以及 loading/buffering/ready/playing/paused/seeking/ended/error 映射。
- 样式与无障碍：独立 `@mx-player-max/ui/style.css`、`mxp-` 类名、`--mxp-*` token、ARIA、tooltip、`focus-visible`、reduced motion，以及 container query + viewport fallback 的 `<=760px` 隐藏规则。
- 宿主：同一 UI 不判断浏览器、Decoder 或 Renderer；支持换源、resize、DPR、fullscreen、PiP 能力变化和可选剧场模式宿主适配器。

## 自动化验证

最终命令结果：

| 命令 | 结果 |
|---|---|
| `pnpm typecheck` | passed；17 个工作区项目依赖构建与严格类型检查通过 |
| `pnpm test` | passed；395 个 Vitest 测试 |
| `pnpm build` | passed；Demo 仅有已知的 618.01 kB 非阻断 chunk warning |
| `pnpm test:browser` | passed；12 个 Playwright 测试 |
| `git diff --check` | passed；仅有 Windows LF/CRLF 提示，无 whitespace error |

Phase 8 基线为 356 个测试，Phase 9 增加 39 个。关键包计数如下：

| 包 | 测试数 | 状态 |
|---|---:|---|
| `@mx-player-max/types` | 20 | passed |
| `@mx-player-max/core` | 109 | passed |
| `@mx-player-max/sdk` | 4 | passed |
| `@mx-player-max/ui` | 18 | passed |
| `@mx-player-max/react` | 1 | passed |
| `@mx-player-max/vue` | 1 | passed |
| 全工作区 | 395 | passed |

UI 测试覆盖播放状态同步、EOS、未知 duration、played/buffered、音量/静音、指针/连续/键盘 seek、拖拽中销毁 cleanup、预览取消/边界/降级、浮层互斥、Escape、外部关闭、重叠指针/焦点交互、自动隐藏、快捷键抑制、字幕关闭/选择/样式/拖拽边界、重复 attach、换源、destroy、迟到事件、Native/Custom 公共状态一致性，以及不支持 PiP/fullscreen/preview 时的禁用状态。Core/SDK 测试覆盖预览预算、timeout 后 provider abort、caller abort/latest-wins/session epoch、Native 隔离预览的 media load reset、Custom provider 能力和公共代理。

## Playwright 与截图

| Playwright 项目 | 测试数 | 证据范围 | 结果 |
|---|---:|---|---|
| `chromium-desktop`，1440x900 | 3 | 自动化 Chromium 布局、700px 窄宿主 container query、交互、截图、Range 回归 | passed |
| `chromium-mobile`，390x844 | 3 | 自动化 Chromium 移动视口响应式布局 | passed |
| `firefox-simulated`，1280x800 | 3 | Playwright Firefox 行为与布局 | passed |
| `webkit-simulated`，1280x800 | 3 | Playwright WebKit 布局与安全降级 | passed |

Playwright 还验证 `/flower.webm` 的 `Range: bytes=0-0` 返回 `206`、`Content-Range: bytes 0-0/554058` 和恰好 1 byte。WebKit 对该 WebM 样本允许返回安全的 `NATIVE_NOT_SUPPORTED`；这只证明错误降级不会破坏 UI，不表示真实 Safari 已支持该媒体。

已逐张目视检查提交的 Chromium 基线：

| 截图 | 结论 |
|---|---|
| `desktop-workbench-chromium-desktop-win32.png` | 实际花朵媒体帧非空，`0:00 / 0:05` 正常，左右控制组无重叠、截断或溢出 |
| `desktop-settings-chromium-desktop-win32.png` | 设置浮层完整位于播放器内，焦点轮廓、标签和按钮文字完整，无控件遮挡 |
| `mobile-workbench-chromium-mobile-win32.png` | 390x844 下媒体非空，音量滑块和剧场按钮隐藏，其余控件完整，无横向溢出 |

## 证据分层

| 层级 | 状态 | 可以证明 | 不能证明 |
|---|---|---|---|
| Vitest + fake DOM/video/canvas/clock | passed | 契约、状态机、epoch、资源清理和确定性逻辑 | 真实浏览器媒体、GPU、系统 PiP/fullscreen 或字体行为 |
| Playwright Chromium | passed | Playwright Chromium 二进制中的布局、交互、截图和 Demo 媒体加载 | Chrome/Chromium 最新两个稳定大版本完整回归 |
| Playwright Firefox | passed | Playwright Firefox 二进制中的布局和交互 | Firefox 最新两个稳定大版本完整回归 |
| Playwright WebKit | passed | WebKit 自动化布局和 `NATIVE_NOT_SUPPORTED` 安全降级 | macOS Safari、系统 PiP、Safari fullscreen 或真实 WebM 支持 |
| 真实 Chrome/Chromium 最新两个稳定大版本 | pending | 待执行 | 当前自动化不得冒充该结果 |
| 真实 Firefox 最新两个稳定大版本 | pending | 待执行 | 当前自动化不得冒充该结果 |
| 真实 macOS Safari 最新两个稳定大版本 | pending | 待执行 | Playwright WebKit 不等价于 Safari |

真实浏览器后续需覆盖 Native/Custom 媒体加载、CORS/Range、连续 seek、buffering/EOS、预览 CORS/timeout、PiP/fullscreen、resize/DPR、字幕拖拽、焦点/快捷键、reduced motion，以及销毁/换源后的资源回收。

## 发布产物

SDK 单独构建后记录产物，再执行全仓 `pnpm build`；两次结果逐文件字节数与 SHA-256 完全一致：

| SDK 文件 | Phase 9 bytes | SHA-256 |
|---|---:|---|
| `dist/index.js` | 3,252 | `EB0C0983A0C234F1DA1D033690D496B97A5D38643E5DF4445C30EEA7EF1A2F81` |
| `dist/index.d.ts` | 2,979 | `683201F4456C8961760AC1AA79B63C8F432A0FA49C111E4A63A3AE1326F357A1` |
| `dist/index.js.map` | 3,836 | `C255800B65B33708A1F8C986E4A1C945272C5960A5A9C8108DBCE8367FB338BE` |
| `dist/index.d.ts.map` | 2,646 | `AE1A2DFB82177268BA7725AB48BC8BDD3616C58F54BFC56A262D0DE6D6BE3DDC` |
| 合计 | 12,713 | n/a |

Phase 8 SDK `dist` 为 11,612 bytes，`index.js` 为 2,956 bytes，SHA-256 为 `A718DBD83729335FFA88AE8943B5E1DA5CB4074F71C148EC458BCD1CEF5567B2`。Phase 9 分别增加 1,101 bytes 和 296 bytes，来自已批准的播放快照、重复 load 和 preview 公共代理；SDK 产物不含 `lucide` 或 `mxp-` UI 代码，全仓构建也不会把 UI 合并进 SDK。

`@mx-player-max/ui@0.1.0` pack 审计：

| 项目 | 结果 |
|---|---|
| tarball | 33,736 bytes |
| 文件 | 27 个；仅 `dist/`、`README.md`、`package.json` |
| 解包文件总量 | 171,269 bytes |
| 主入口 | `dist/index.js`，475 bytes |
| 类型入口 | `dist/index.d.ts`，687 bytes |
| 样式入口 | `dist/style.css`，11,511 bytes |
| exports | `.` 的 ESM/declarations 与独立 `./style.css` |
| tree-shaking | ESM；`sideEffects` 只标记 `./dist/style.css` |
| 运行时依赖 | `@mx-player-max/sdk`、`@mx-player-max/types`、按名导入的 `lucide` |
| 排除项 | 无 tests、Demo、React/Vue/Svelte runtime |

## 边界审计

- 只有 Demo、React 和 Vue 的 package manifest 依赖 `@mx-player-max/ui`；SDK、Core、Decoder、Demux、Renderer、Audio、Subtitles 和 Capabilities 均无反向依赖。
- UI 只导入 `@mx-player-max/sdk` 与 `@mx-player-max/types` 公共入口，没有跨包子路径或内部文件引用。
- UI 生产 TypeScript 扫描无 `any`，无活动 video/canvas、`VideoFrame`、GPUTexture、AudioContext、renderer、字幕内部对象、`localStorage` 或 `innerHTML` 访问。
- CSS 由 `@mx-player-max/ui/style.css` 独立发布；生产代码不创建 `<style>`、不使用 CSS-in-JS。
- React/Vue 适配器只创建 SDK/UI、转发 options/load、暴露 handle，并按 UI-first 顺序销毁；没有复制控制状态机、快捷键、时间轴或字幕逻辑。
- Demo 从公开 React/UI 入口集成，Demo DOM、Vite middleware 和媒体样本都不是 UI 包运行时依赖。

## Demo 验收入口

本地 Demo 已在 `http://127.0.0.1:4173/` 启动，HTTP 状态为 `200`。该进程保持运行供人工检查。

## 明确范围外

Phase 9 不包含 Phase 10 WASM Codec、PGS/VobSub、完整 libass、字幕内容编辑器、播放列表或下一集业务、Custom 内建预览解码、Document Picture-in-Picture、UMD/IIFE/CJS 分发、HLS/DASH/直播实现、移动端兼容阶段或无关架构重构。
