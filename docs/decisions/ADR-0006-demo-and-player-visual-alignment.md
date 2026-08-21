# ADR-0006：演示站视觉对齐 MX-Player-Pro，播放器 chrome 对齐 MXAnime-CMS

## 状态

已接受。取代 `ADR-0004` 的「不复制演示站视觉」条款，以及 `AGENTS.md` 原第 13 条。

## 背景

`ADR-0004` 只允许借鉴 `MX-Player-Pro` 的交互模式，明确禁止复制它的页面结构与视觉。这条边界当时
的目的是避免 Max 变成 Pro 的复制品、避免把 Pro 的实现文件搬进 Max。

实际运行一段时间后出现两个问题：

1. Maishan 同时对外发布 Pro（`player.freeanime.org`）与 Max（GitHub Pages）两个站点。Pro 是一个
   落地页：顶栏、播放区、URL 表单、能力条、为什么选择、接入示例、工作原理、FAQ、页脚。Max 是一个
   四宫格 workbench。两者放在一起不像同一个产品线，用户要重新认一次信息位置。
2. Max 的播放器 chrome 使用青绿强调色（`#68c5b4`）、40 px 方形按钮和无遮罩控制栏，而 Maishan 自己
   的产品里已经跑了很久的 MXAnime-CMS 内置 MX-Player 是另一套：黑白单色、底部渐变遮罩、圆形按钮、
   全宽细进度轨。同一家的播放器有两种视觉语言。

原条款要防的是「抄实现」，不是「统一视觉」。把这两件事分开之后，禁止的部分应该收窄。

## 决策

### 演示站

`apps/demo` 的布局、排版尺度、间距节奏、卡片与折叠组件的形态对齐 MX-Player-Pro 的落地页结构，
仍然使用 GSAP 做 reveal。以下内容不复制，由 Max 自己提供：

- 品牌：Max 的 brand block、`runtime-status`、Repository 链接与 PolyForm 页脚，不使用
  FREEANIME.ORG × Maishan 联合 logo，不引入 Pro 的 `brands/*` 资源。
- 文案：按 Max 的能力重写（原生优先、双渲染路径、策略评分、WASM 兜底），不使用 Pro 的 MKV-only 叙述。
- 代码示例：`@mx-player-max/*` 的真实 API 与本站 `sdk/` 产物，不出现 `mx-player-pro` 包名。
- 实现文件：不从 Pro 复制源文件。Pro 的播放内核（`PlayerSurface`、`sdk/MXPlayer.ts`）不进入 Max，
  播放始终由 `@mx-player-max/react` 驱动。图标为本仓库手写 SVG，不新增图标依赖。

演示站保留 workbench 的职责：播放区下方仍有 URL 表单、本地文件、字幕挂载、`playback-intent`
选择器与 `DiagnosticsPanel`，Pages 与 UI 回归测试继续在首页断言这些节点。

### 播放器 chrome

`packages/ui/src/style.css` 的视觉语言对齐 MXAnime-CMS 的 `.mx-player-*`：

- 单色：强调色为纯白（light 主题为纯黑），不再有青绿色；`data-mxp-active` 用背景高亮而非彩色文字。
- 控制栏：`--mxp-scrim` 一层底部渐变遮罩，保证白色控件在明亮画面上仍可读。
- 按钮：36 px 圆形，hover/active 为 `rgba(255,255,255,.18)`。
- 进度轨：3 px 全宽细轨，hover/focus 变 5 px，不显示独立 thumb，位置由已播放填充表达。
- 浮层：9 px 圆角、`rgba(10,10,10,.96)`、`blur(14px)` 毛玻璃、`0 18px 48px` 阴影。
- 时间码：126 px 预留宽度、12 px、tabular-nums。

不移植 MXAnime-CMS 的弹幕组件（`MxPlayerDanmu*`）、锁定按钮与 Video.js 相关规则；Max 没有这些功能。
类名仍为 `mxp-`，公开 token 仍为 `--mxp-*`，DOM 结构与 `controller.ts` 不变——这次改动只是样式。

### 样式契约

`packages/ui/tests/style-contract.test.ts` 原本禁止任何 `gradient(`。该断言改为：允许且仅允许
`--mxp-scrim` 这一处渐变，其他位置出现 `gradient(` 仍然失败。禁止负 letter-spacing 的断言保留。
`--mxp-control-size` 基线从 40 px 改为 36 px。

## 后果

正面：

- 两个对外站点视觉同族，Maishan 的播放器只有一套视觉语言。
- 单色 chrome 去掉了彩色强调色对画面的干扰，白色控件在遮罩上的对比度高于原来的青绿色。
- 边界比原条款更清晰：禁止的是复制实现文件与品牌，不是统一视觉。

负面：

- Pro 的落地页改版后，两个站点会重新分叉；同步需要人工判断，没有自动检查。
- UI 像素 baseline 需要在每个平台重新生成一次（本次已重新生成 win32 的三张 chromium PNG）。
- 允许一处渐变之后，样式契约从「零渐变」变成「只允许一处」，规则本身更复杂。

## 相关

- `ADR-0004`（外观参考与边界一节被本 ADR 取代）
- `docs/architecture/ui-package.md`
- `docs/development/execution-plan.md`
- `docs/superpowers/specs/2026-08-16-github-pages-demo-deployment-design.md`（其「不复制 Pro 视觉」约束由本 ADR 取代）
- `docs/superpowers/plans/2026-08-09-phase-9-ui-plan.md`（其「无装饰渐变」验收项由本 ADR 收窄为「仅 scrim」）
