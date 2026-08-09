# Phase 8 验收记录

日期：2026-08-09

## 实现状态

Phase 8 已实现独立的 `@mx-player-max/subtitles` 内核、公共 types、Core 生命周期组合和 SDK 代理。字幕支持内嵌 UTF-8/ASS/SSA packet，以及外挂 File 和直接 HTTPS/CORS URL；显示由 Native HTMLVideo 时间或 Custom AudioContext/MediaWallClock 查询驱动，不由 packet 到达时间驱动。

本阶段明确不包含 PGS、VobSub、位图字幕、完整 libass、字幕菜单、字体选择器、拖拽句柄、样式编辑器和控制条。

## 公共 API

- `SubtitleCue`、`SubtitleCueStyle`、source/track/state/diagnostic/clock/store/options/limits 契约，时间统一为整数微秒。
- 稳定 `SUBTITLE_*` 错误码和五类字幕事件；cue 事件只发布 metadata，不发布正文。
- `MediaEngine`/`MXPlayer`：轨道枚举、外挂轨添加、选择/关闭、移除、样式设置/重置和 Overlay attach/detach。
- Native 与 Custom 使用相同 API、状态与事件语义。

## 解析与安全

SRT 覆盖 BOM、CRLF/LF、可选序号、短/长时间格式、多行文本、边界时间、畸形 block、过长行、超限输入和纯文本注入。ASS/SSA 覆盖 Script Info、V4/V4+ Styles Format、Events Format、Dialogue 逗号、换行、字体/字号/颜色/粗斜体/下划线/描边/alignment/基础 position、Matroska packet 形式和稳定降级诊断。

ASS 白名单之外的动画、drawing、karaoke、move/fade/transform、复杂排版不执行。Overlay 使用 `textContent`，无 `innerHTML`。远程字幕仅 HTTPS/CORS、无凭据、拒绝 redirect，并限制响应字节数、流块数、单次读取超时和解析预算。公共错误不包含原始字幕、完整 URL、查询参数、响应正文或 DOM 异常。

## 生命周期与资源

- 添加、选择、seek、remove、换源和 close 提升或检查 operation/epoch，并 abort 旧加载。
- seek 完成同步按新媒体时间重算 cue；连续 seek 丢弃旧 epoch。
- 多 cue 按 start、end、layer、cue ID 的跨 locale 稳定顺序输出。
- Overlay 适配 video/WebGPU/WebGL2/Canvas2D 宿主，处理换行、layer、resize、DPR、fullscreen 和 close cleanup。
- 默认样式存储按 URL origin 或 `local-file` 作用域；schema/JSON/Storage 损坏回退默认中日韩字体栈。

## 自动化验证

字幕专项覆盖解析器、恶意/超限输入、内嵌 packet、File/HTTPS 来源、CORS/响应大小、轨道操作/重复 ID/迟到结果、pause/rate/seek/epoch/EOS、样式作用域/损坏存储、Overlay 多 cue/resize/DPR/close，以及 Core Native/Custom 和 SDK 公共 API 集成。

本次 `pnpm test` 共通过 356 个工作区测试。其中 `@mx-player-max/subtitles` 通过 46 个测试，`@mx-player-max/core` 通过 95 个测试，`@mx-player-max/types` 通过 18 个公共契约测试，`@mx-player-max/sdk` 通过 3 个集成测试。

最终要求命令：

| 命令 | 结果 |
|---|---|
| `pnpm typecheck` | passed |
| `pnpm test` | passed |
| `pnpm build` | passed |
| `git diff --check` | passed；Windows 工作树可能报告 LF 到 CRLF 提示，不是 whitespace error |

## 真实浏览器矩阵

| 环境 | 状态 | 待验证内容 |
|---|---|---|
| Chrome/Chromium 最新两个稳定大版本 | pending | File/HTTPS CORS、video/canvas Overlay、font fallback、ResizeObserver、DPR/fullscreen、Native/AudioContext 时钟、pause/rate/连续 seek/EOS/close |
| Firefox 最新两个稳定大版本 | pending | 同上，另验证 WebGL2/Canvas2D 宿主和跨 locale 排序一致性 |
| macOS Safari 最新两个稳定大版本 | pending | 同上，另验证 WebKit fullscreen host、字体 fallback 和实际 AudioDecoder/AudioContext 可用路径 |

当前自动化使用 Node/Vitest、fake DOM/video/canvas/clock。它们不等价于真实 Chrome、Firefox 或 Safari，不能作为三浏览器 smoke 已通过的证据。
