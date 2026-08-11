# Phase 12 验收记录

日期：2026-08-12

分支：`feat/phase-12-sdk-release`

状态：自动化发布门禁通过；Docker 运行时和真实 latest-two-stable/物理 Safari 证据保持 pending。本阶段没有执行真实 `npm publish`、GitHub Release 或 CDN 发布。

## 变更提交

- `fd43f8e feat(demo): add playback diagnostics workbench`
- `d9d2cb1 build(demo): verify isolated docker distribution`
- `6cf5fb3 ci(release): gate package publishing workflow`
- `eba04a7 docs(distribution): document phase 12 integrations`

## 自动化命令

| 命令 | 实际结果 |
|---|---|
| `pnpm --filter @mx-player-max/types test` | passed，22 tests |
| `pnpm --filter @mx-player-max/strategy test` | passed，12 tests |
| `pnpm --filter @mx-player-max/core test` | passed，120 tests |
| `pnpm --filter @mx-player-max/sdk test` | passed，4 tests |
| `pnpm --filter @mx-player-max/browser test` | passed，10 tests |
| `pnpm --filter @mx-player-max/demo test` | passed，3 tests |
| `pnpm typecheck` | passed，18 workspace projects；Demo、Browser、React、Vue 均通过 |
| `pnpm test` | passed，所有 workspace test script 通过 |
| `pnpm build` | passed；Vite 提示 Demo 主 chunk 超过 500 kB，未作为失败处理 |
| `pnpm test:browser` | passed，16/16：Chromium desktop/mobile、Firefox simulated、WebKit simulated |
| `pnpm test:release` | passed，17/17：Manifest、pack、consumer、Docker/workflow/documentation 静态门禁 |
| `pnpm verify:packages` | passed，17 publishable packages verified |
| `pnpm release:manifest` | passed，写入 `packages/browser/dist/manifest.json` |
| `pnpm release:pack` | passed，17 tarballs |
| `pnpm release:smoke` | passed，5 commands |
| `git diff --check` | passed |

## 分发证据

Browser `dist` 当前文件大小：

- `mx-player-max.iife.js`: 690,375 bytes
- `mx-player-max.iife.min.js`: 359,810 bytes
- `index.js`: 5,227 bytes
- `style.css`: 11,511 bytes

Manifest 记录 10 个 publishable 资源：1 ESM、1 IIFE、1 minified IIFE、1 CSS、2 Worker、1 AudioWorklet 和 3 source map。没有 WASM 或 AI model 条目；任何新增 Codec/WASM/model 仍需来源、许可证、编译选项和专利风险审查。

最新 pack report 位于 `.release-tmp/release-pack/pack-report.json`（目录被 `.gitignore` 忽略）。包含 17 个 `0.1.0` tarball；Browser tarball 为 460,271 bytes，SHA-256 为 `43ba3eda88a7df883f41ee0ffc5d20c659761b58e6134e2faa9699b86cb24090`。Consumer smoke 只从这些 tarball 安装，没有从 workspace 源码解析依赖。

## 浏览器与 Docker 边界

- Playwright 项目是自动化 Chromium/Firefox/WebKit 引擎证据，不等价于真实 Chrome/Firefox 最新两个稳定版本或 macOS Safari。
- `docker compose build` 和 `scripts/release/docker-smoke.ps1`：pending。当前执行环境没有 Docker CLI（`docker` command not found），因此没有创建、停止或删除任何容器，也没有宣称 COOP/COEP、Range、MIME 或 `crossOriginIsolated` 的运行时通过。
- 真实设备/浏览器的 Codec、硬解、HDR、CORS、Range、长时漂移、CPU/内存/功耗和 Safari 行仍保持 pending。

## 发布边界

Release workflow 已拆分为 `validate -> package -> consumer-smoke -> artifact -> publish`。普通 push/PR 没有 publish step；tag push 也只运行验证链。实际发布必须手动 dispatch 到 `v*.*.*` tag，明确输入 `publish`，通过 `npm-production` protected environment，并提供 `NPM_TOKEN`。本次没有执行任何真实发布动作。

许可证保持 `PolyForm-Noncommercial-1.0.0`。该许可证不替代第三方 Codec、WASM、模型或字体的独立许可审查。
