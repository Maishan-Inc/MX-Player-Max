# MX-Player-Max Demo

Phase 12 播放与诊断 workbench。首屏直接挂载官方 React 适配器和可选 UI，支持 HTTPS/HTTP URL、本地媒体（点击或拖入播放区）、外挂 SRT/ASS/SSA、播放意图切换与宿主剧场模式。Probe、Decision、Runtime 和 Subtitles 面板只消费 React handle 暴露的 SDK 公共 getter/event，不读取 Core 或 Strategy 私有状态。Demo 不实现自己的播放器控制逻辑，也不是 SDK/UI 的运行时依赖。

页面的布局、排版尺度与折叠组件形态对齐 MX-Player-Pro 的落地页结构（顶栏、播放区、URL 表单、能力条、
为什么选择、接入示例、工作原理、诊断、FAQ、页脚），品牌、文案、代码示例与图标都是 Max 自己的，不引入
Pro 的实现文件或品牌资源。依据见 `docs/decisions/ADR-0006-demo-and-player-visual-alignment.md`。
主题切换写入 `<html data-theme>` 并同步传给播放器 UI，选择持久化在 `localStorage`。

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

访问 `http://localhost:4173`。Nginx 注入 COOP/COEP/CORP，用于跨源隔离能力验证；诊断面板会把未知或尚未完成实际探测的能力显示为 pending verification，不把它们声明为 supported。

默认 `flower.webm` 是仓库内的 CC0 媒体样本。非空 poster 与媒体来源、SHA-256 和许可记录在 `public/ASSET-PROVENANCE.md`。

## GitHub Pages

公开静态 Demo 位于 <https://maishan-inc.github.io/MX-Player-Max/>。仓库维护者在 GitHub Actions
中手动运行 `.github/workflows/deploy-demo.yml`，输入展示版本并选择是否部署；首次部署前需在
Settings > Pages 中选择 GitHub Actions。页面 Artifact 还在 `/sdk/` 提供 manifest-approved
Browser JS/CSS，但不包含 restricted WASM 或 AI 模型。

本地构建与子路径 smoke：

```bash
pnpm build:pages
pnpm test:pages
```

GitHub Pages 不提供 COOP/COEP、CSP、CORP 或 Docker 的隔离/非隔离双端点，不能验证 WASM Threads
或替代 Nginx runtime smoke。远程媒体仍由浏览器直接访问，必须支持 HTTPS、CORS 和 Range。

Playwright fixture 与 workbench 截图只构成自动化证据。真实 Chrome/Firefox 最新两个稳定大版本及 macOS Safari 的验证状态将在 Phase 12 验收记录中单独维护。
