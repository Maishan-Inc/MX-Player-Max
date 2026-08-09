# MX-Player-Max

面向桌面浏览器的模块化 Web 媒体引擎、播放器 SDK 与可选播放器界面。

## 当前阶段

仓库已完成 Phase 1-9：能力探测、Range/Demux、Native/Custom 播放、Audio、Renderer、AI、SRT/ASS 字幕内核，以及独立的 `@mx-player-max/ui`。UI 使用原生 DOM + TypeScript，同一实现消费 SDK 公共状态并覆盖 Native `<video>` 与 Custom `<canvas>` 路径。

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

## 包边界

```text
@mx-player-max/sdk
  -> core -> capabilities / strategy / demux / decoder / renderer / audio / subtitles

@mx-player-max/ui -> sdk + types
@mx-player-max/react -> sdk + ui + types
@mx-player-max/vue -> sdk + ui + types
apps/demo -> react + sdk + ui + types
```

引擎包禁止反向依赖 UI。UI 只使用 `@mx-player-max/sdk` 与 `@mx-player-max/types` 公共入口，不读取 video/canvas、Frame、GPU、AudioContext 或字幕内部对象。

## 文档

- `docs/api/player-ui.md`：SDK 播放快照、预览与 UI 公共 API。
- `docs/architecture/ui-package.md`：UI 生命周期、状态同步、CSS、可访问性和边界。
- `docs/architecture/distribution-and-embedding.md`：可选安装、宿主容器、CORS、HTTPS 与分发。
- `docs/development/phase-9-acceptance.md`：Phase 9 自动化、截图与真实浏览器待验证项。
- `docs/development/roadmap.md`：后续阶段范围。

## 本地命令

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
pnpm test:browser
pnpm dev
```

Playwright Chromium/Firefox/WebKit 自动化与真实 Chrome、Firefox、macOS Safari 验证分开记录。Playwright WebKit 不能替代真实 macOS Safari 证据。

## Phase 9 范围

Phase 9 不包含 Phase 10 WASM Codec、PGS/VobSub、完整 libass、字幕内容编辑器、播放列表或下一集业务、Custom 内建预览解码、UMD/IIFE 分发和无关架构重构。
