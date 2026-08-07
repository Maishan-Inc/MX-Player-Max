# Phase 3 验收记录

日期：2026-08-07

## 实现状态

NativeMediaPipeline 已实现为 `@mx-player-max/core` 内部模块，并由 `@mx-player-max/sdk` 直接代理公共能力。加载顺序固定为：目标解析 → Phase 2 RangeLoader/ContainerAdapter Probe → 关闭 Probe 资源 → 能力快照 → 媒体能力报告 → 既有 PlatformPolicy/StrategyEngine → 仅初始化 `native-html-video` → HTMLVideo 元素配置与源设置 → `loadedmetadata` → ready。

本阶段支持本地 File Object URL，以及需要 CORS、HTTP Range、206 和稳定长度/可处理未知长度的 HTTP(S) 远程文件。MP4 H.264/AAC 与 WebM VP8/VP9/Opus 的 MIME/Codec 候选来自 Probe 和 `MediaCapabilityReport.native.*.contentType`，不从扩展名猜测。

## 公共 API

- `NativeMediaOptions`、`NativeMediaFeatures`、`NativePlaybackStats`。
- `MXPlayerOptions.native`。
- `MediaEngine` 的 state/media/selection/nativeFeatures、事件 on/off/once、播放控制、全屏/PiP 和 close。
- `ENGINE_*` 与 `NATIVE_*` 稳定错误码，所有异步 DOM 错误转换为 `EngineError` 结构。

## 资源与安全验收

- File 只调用 `URL.createObjectURL(file)`，替换源或 close 时撤销引擎拥有的 URL。
- 远程 URL 直接设置给 video；`crossOrigin` 在 `src` 前配置，默认 anonymous；默认 preload metadata、playsInline true。
- 自定义 headers 明确返回 `NATIVE_CUSTOM_HEADERS_UNSUPPORTED`，不静默丢弃。
- 目标为 video 时复用；容器目标只追加引擎拥有的 video，不清空其他子节点；close 不删除调用方 video。
- HTMLVideo 事件映射为统一状态、微秒时间、nullable duration 和有限 bufferedAhead。
- requestVideoFrameCallback 只产生统计，不输出 VideoFrame；close/替换源取消回调并丢弃旧 epoch 事件。
- 未实现 WebCodecs、WASM、FFmpeg、MSE、HLS、DASH、AudioWorklet、自定义 Renderer、字幕菜单和控制层。

## 本机自动化覆盖

新增测试文件：

- `packages/types/tests/native-public-api.test.ts`
- `packages/core/tests/native-pipeline.test.ts`
- `packages/core/tests/native-target.test.ts`
- `packages/core/tests/native-events.test.ts`
- `packages/core/tests/native-close.test.ts`
- `packages/core/tests/native-engine.test.ts`
- `packages/sdk/tests/native-sdk.test.ts`

fake HTMLVideoElement、fake document、fake URL API、mock Promise 和 mock Phase 2/能力/策略入口覆盖 File URL 创建/替换/撤销、远程 headers 拒绝、MP4/WebM contentType、autoplay/network/CORS/decode/abort 映射、非法控制参数、duration NaN/Infinity、TimeRanges、全屏/PiP 缺失或拒绝、RVFC 统计、事件 on/off/once 和 close 清理。测试不访问真实媒体或 HTTP 站点。Phase 3 新增测试共 33 项（types 3、core 29、SDK 1）；全工作区共 111 项测试通过。

## 验收命令

以下命令于 2026-08-07 在当前工作区实际执行并通过：

```text
pnpm typecheck
pnpm test
pnpm build
git diff --check
```

## 浏览器 smoke matrix

真实 Chrome/Chromium、Firefox 和 macOS Safari 最新两个稳定大版本需要真实 File、CORS/Range、autoplay、全屏/PiP、native frame statistics 和 close 场景。当前 Windows 执行环境的命令路径中未发现 chrome、msedge、firefox 或 safari，也没有 macOS Safari 环境，因此状态为 pending，不能以本机 Vitest 结果替代。

| 环境 | 状态 | 待验证内容 |
|---|---|---|
| Chrome/Chromium 最新两个稳定大版本 | pending | MP4/WebM File、CORS/Range、autoplay、RVFC、fullscreen/PiP、Object URL close |
| Firefox 最新两个稳定大版本 | pending | MP4/WebM native capability、fastSeek、network/decode mapping、close |
| macOS Safari 最新两个稳定大版本 | pending | MP4 native path、WebM capability rejection、PiP/fullscreen、CORS/close |

## 未完成或外部验证项

- 三浏览器真实 smoke matrix 尚待浏览器 CI/设备环境。
- 真实跨源服务器的 CORS/Range 与浏览器 autoplay 权限策略尚未在本环境执行。
- HLS/DASH/直播、fMP4 fragment 播放、WebCodecs、WASM、字幕和 UI 控件明确留在后续阶段。
