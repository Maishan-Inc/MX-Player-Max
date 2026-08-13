# MX-Player-Max

面向桌面浏览器的模块化 Web 媒体引擎、播放器 SDK 与可选播放器界面。

## 当前阶段

仓库已完成 Phase 1-12 的当前批准范围，以及 Phase 10.2 的 restricted libvpx VP8 WASM
垂直切片：真实 WebAssembly runtime、MXWF I420 帧 ABI、Decoder Worker、Core Custom Pipeline
和 WebCodecs -> WASM 原子回退。该切片仅覆盖 video-only VP8 profile 0 / 8-bit I420，且只有
调用方显式提供自托管 `wasmBaseUrl` 时启用。

```bash
pnpm add @mx-player-max/sdk @mx-player-max/ui
```

```ts
import { MXPlayer } from '@mx-player-max/sdk'
import { attachPlayerUi } from '@mx-player-max/ui'
import '@mx-player-max/ui/style.css'

const host = document.querySelector<HTMLElement>('#player')!
const player = new MXPlayer({
  target: host,
  source: { kind: 'url', url: 'https://media.example.com/video.mp4' },
})
const ui = attachPlayerUi(player, host, { theme: 'dark' })

await player.ready

// 宿主卸载时先移除 UI，再销毁播放器。
ui.destroy()
player.destroy()
```

只安装 `@mx-player-max/sdk` 时不会引入 UI、Lucide 或样式代码。React 与 Vue 包是 SDK + UI 的薄生命周期适配器；Demo 只是独立集成样例，不是运行时依赖。

浏览器一体化入口：

```ts
import { create } from '@mx-player-max/browser'
import '@mx-player-max/browser/style.css'

const handle = create({
  target: '#player',
  source: { kind: 'url', url: 'https://media.example.com/video.mp4' },
  ui: { theme: 'dark' },
})
await handle.ready
```

`@mx-player-max/browser` 只组合 SDK 和官方 UI，`destroy()` 按 UI -> SDK 顺序幂等清理。所有公开包使用 `PolyForm-Noncommercial-1.0.0`；商业使用需要单独授权。

## 包边界

```text
@mx-player-max/sdk
  -> core -> capabilities / strategy / demux / decoder / renderer / audio / subtitles

@mx-player-max/ui -> sdk + types
@mx-player-max/react -> sdk + ui + types
@mx-player-max/vue -> sdk + ui + types
@mx-player-max/browser -> sdk + ui + types (ESM/IIFE)
apps/demo -> react + sdk + ui + types
```

引擎包禁止反向依赖 UI。UI 只使用 `@mx-player-max/sdk` 与 `@mx-player-max/types` 公共入口，不读取 video/canvas、Frame、GPU、AudioContext 或字幕内部对象。

## 文档

- `docs/api/player-ui.md`：SDK 播放快照、预览与 UI 公共 API。
- `docs/architecture/ui-package.md`：UI 生命周期、状态同步、CSS、可访问性和边界。
- `docs/architecture/distribution-and-embedding.md`：可选安装、宿主容器、CORS、HTTPS 与分发。
- `docs/development/release.md`：固定版本、SRI、Docker、CI 和受保护发布门禁。
- `packages/platform/README.md`：Phase 11 平台增强、Issue 规则和诊断 API。
- `docs/development/phase-11-acceptance.md`：Phase 11 自动化与真实浏览器待验证项。
- `docs/development/roadmap.md`：后续阶段范围。

## 本地命令

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
pnpm test:browser
pnpm dev
pnpm test:release
pnpm verify:packages
pnpm release:pack
pnpm release:smoke
```

Playwright Chromium/Firefox/WebKit 自动化与真实 Chrome、Firefox、macOS Safari 验证分开记录。Playwright WebKit 不能替代真实 macOS Safari 证据。

## 当前范围边界

当前真实 WASM Codec 覆盖只包含 restricted libvpx VP8 video-only 切片；VP9、AV1、H.264、
HEVC、VVC、WASM 音频和 FFmpeg 均未实现。三个 VP8 二进制不属于可发布资源，Browser release
manifest 只把它们列入 `excluded`。仓库仍不包含 PGS/VobSub、完整 libass、字幕内容编辑器、
播放列表或下一集业务、HLS/DASH 自定义管线。Playwright WebKit 不等价于物理 macOS Safari 验收。
