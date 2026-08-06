# MX-Player-Max

模块化全能 Web 播放器引擎与 SDK。

## 当前阶段

仓库当前处于架构与脚手架阶段。完整设计见：

- `docs/architecture/overview.md`
- `docs/architecture/browser-strategy.md`
- `docs/architecture/codec-strategy.md`
- `docs/architecture/audio-pipeline.md`
- `docs/architecture/subtitle-pipeline.md`
- `docs/architecture/wasm-and-distribution.md`
- `docs/development/roadmap.md`

## 目标形态

```text
@mx-player-max/sdk
├─ @mx-player-max/core
├─ @mx-player-max/types
├─ @mx-player-max/capabilities
├─ @mx-player-max/strategy
├─ @mx-player-max/demux
├─ @mx-player-max/decoder-webcodecs
├─ @mx-player-max/decoder-wasm
├─ @mx-player-max/renderers
├─ @mx-player-max/audio
├─ @mx-player-max/subtitles
├─ @mx-player-max/react
└─ @mx-player-max/vue
```

## 本地命令

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
pnpm dev
```

演示站使用 Docker 部署，生产容器必须配置 COOP/COEP，以便在条件允许时启用多线程 WASM。

