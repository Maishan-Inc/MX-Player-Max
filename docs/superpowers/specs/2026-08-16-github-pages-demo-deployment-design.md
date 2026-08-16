# GitHub Pages Demo Deployment Design

状态：已实现并通过本地验证；真实 GitHub Pages 部署待手动运行 `deploy-demo.yml`。

## 1. 目标与范围

为 MX-Player-Max 增加与 MX-Player-Pro 同类的手动 GitHub Pages Demo 发布能力，同时保留 Max
现有的 Monorepo、自动 CI、npm Release 和 Docker 部署边界。Pages 用于公开展示当前 Demo，并在
同一站点的 `/sdk/` 下提供经过发布校验的 Browser SDK 静态产物。

本功能不复制 MX-Player-Pro 的页面结构或视觉样式，不把 Pages 变成正式 SDK 发布渠道，也不替代
Docker 的隔离/非隔离运行时验证。默认站点地址为
`https://maishan-inc.github.io/MX-Player-Max/`；本阶段不加入 `CNAME` 或自定义域名。

## 2. Workflow 职责

GitHub Actions 保持三个独立职责文件：

- `.github/workflows/ci.yml`：继续在 main push 和 pull request 上执行质量门禁，不部署。
- `.github/workflows/deploy-demo.yml`：新增，仅通过 `workflow_dispatch` 手动构建和部署 Demo。
- `.github/workflows/release.yml`：继续负责 SDK/npm 验证、打包、Artifact 和受保护发布。

`deploy-demo.yml` 提供与 Pro 相同语义的 `version` 字符串输入和 `deploy_pages` 布尔输入。默认版本为
当前仓库版本 `0.1.0`，默认执行 Pages 部署。取消 `deploy_pages` 时仍完成构建和 Artifact 上传，
但不调用部署 action。部署 workflow 不响应 push、pull request 或 tag，避免未经人工选择的公开更新。

## 3. 构建与产物流

手动 workflow 使用 Node 22、pnpm 10.14.0 和冻结 lockfile，并按以下顺序执行：

```text
checkout
  -> pnpm install --frozen-lockfile
  -> typecheck + workspace tests
  -> workspace/demo build
  -> package and release-contract verification
  -> Pages-specific Demo build
  -> publishable Browser SDK copy
  -> Pages artifact verification
  -> upload-pages-artifact
  -> optional deploy-pages
```

Pages 专用构建向 Vite 传入相对 base 与 `VITE_APP_VERSION`。最终上传根目录为
`apps/demo/dist/`，其中包含：

- Demo 的 `index.html`、哈希 JS/CSS、poster 和 CC0 示例媒体；
- `.nojekyll`；
- `sdk/` 下的 `@mx-player-max/browser` JS、CSS、source map 和发布 manifest。

SDK 文件只能来自已经通过 `pnpm verify:packages`、`pnpm test:release` 和
`pnpm release:manifest` 的 `packages/browser/dist/`。不得复制 restricted WASM、AI 模型、测试夹具、
源码目录、npm token 或其他工作区产物。Pages Artifact 是 Demo 快照，不替代 npm 的版本化发布。

## 4. Demo 子路径兼容

本地开发、Playwright 和 Docker 继续使用 `/` base；只有 Pages 构建使用 `./`。Vite 生成的脚本、
样式、Worker 和静态资源因此可同时运行在 GitHub 仓库子路径和未来自定义域名根路径。

Demo 默认媒体地址从根绝对路径 `/flower.webm` 改为基于 `import.meta.env.BASE_URL` 解析，确保页面在
`/MX-Player-Max/` 下请求同目录媒体。普通用户输入仍只接受 HTTP(S) URL，本地文件与字幕上传行为
不变。页面 Repository 链接指向 `https://github.com/Maishan-Inc/MX-Player-Max`，运行状态显示手动
输入的构建版本；本地开发缺少版本环境变量时显示 `dev`。

Demo 不使用客户端路由，本阶段不增加 404 重写脚本。未知路径保持 GitHub Pages 的正常 404 行为。

## 5. Pages 配置与失败行为

部署 job 使用最小权限：`contents: read`、`pages: write`、`id-token: write`，并绑定
`github-pages` environment 和 deployment URL。使用官方 `actions/configure-pages`、
`actions/upload-pages-artifact` 与 `actions/deploy-pages`。

与 Pro 一样，workflow 先通过 GitHub API 检查仓库是否启用 Pages：

- 已启用且 `deploy_pages=true`：配置并部署；
- 未启用：Artifact 仍上传，job 给出 Settings > Pages > GitHub Actions 的明确 warning；
- `deploy_pages=false`：只构建并上传 Artifact，明确记录未部署；
- 构建、校验或 Artifact 缺失：立即失败，不上传不完整站点。

首次真实部署前，仓库管理员必须在 GitHub Settings 中把 Pages source 设置为 GitHub Actions。
本地实现不会调用 API 修改远程仓库设置。

## 6. 运行时与安全边界

GitHub Pages 不能配置 Max Docker 所需的 COOP/COEP、CSP、CORP、MIME 和双端点策略。因此：

- Pages 只承诺普通 HTTPS 静态 Demo、Native/WebCodecs 能力探测和可用浏览器降级；
- WASM Threads、`crossOriginIsolated` 和自定义响应头仍只由 Docker/自托管环境验证；
- Pages 不代理远程媒体，也不上传本地文件；远程 URL 仍必须满足 HTTPS、CORS 和 Range 要求；
- Pages 自动化结果不能填充真实 latest-two-stable 或物理 macOS Safari 证据。

文档必须同时给出 Pages 的限制和 Docker 的权威运行时用途，避免把静态展示结果描述为完整发布验收。

## 7. 测试与验收

测试覆盖以下合同：

1. Workflow 契约测试验证三个文件的职责、手动触发、输入、最小权限、Pages Actions、Artifact 路径、
   SDK 构建/校验步骤，以及 CI/Release 中不存在意外 Pages 部署。
2. Demo 单元测试验证 base-aware 默认媒体 URL、开发版本 fallback 和固定仓库链接。
3. Pages 构建校验验证相对 HTML 资源、`.nojekyll`、默认媒体和 `/sdk/` 白名单；restricted
   WASM/模型和测试文件出现时必须失败。
4. Chromium Pages smoke 从构建产物启动静态预览，确认页面非空、播放器可见、默认媒体可加载、
   版本可见且 Browser SDK 文件可请求。
5. 完整门禁运行 `pnpm typecheck`、`pnpm test`、`pnpm build`、`pnpm verify:packages`、
   `pnpm test:release`、受影响的 Playwright smoke 和 `git diff --check`。

同步更新根 README、Demo README、`docs/development/release.md`、分发/嵌入文档与 Changelog。真实
GitHub Pages 部署需要远程仓库设置和 GitHub Actions 环境，只能在 workflow 运行后记录为通过。
