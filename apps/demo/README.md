# MX-Player-Max Demo

Phase 9 播放器 workbench。首屏直接挂载官方 React 适配器和可选 UI，支持 HTTPS/HTTP URL、本地媒体、外挂 SRT/ASS/SSA、播放意图切换与宿主剧场模式。Demo 不实现自己的播放器控制逻辑，也不是 SDK/UI 的运行时依赖。

```bash
pnpm --filter @mx-player-max/demo dev
```

Vite 会输出本地访问地址。生产构建：

```bash
pnpm --filter @mx-player-max/demo typecheck
pnpm --filter @mx-player-max/demo build
```

Docker：

```bash
docker compose up --build
```

访问 `http://localhost:4173`。Nginx 注入 COOP/COEP/CORP，用于后续跨源隔离能力验证；Phase 9 UI 本身不要求跨源隔离。

默认 `flower.webm` 是仓库内的 CC0 媒体样本。非空 poster 与媒体来源、SHA-256 和许可记录在 `public/ASSET-PROVENANCE.md`。

Playwright fixture 与 workbench 截图只构成自动化证据。真实 Chrome/Firefox 最新两个稳定大版本及 macOS Safari 的验证状态单独记录在 `docs/development/phase-9-acceptance.md`。
