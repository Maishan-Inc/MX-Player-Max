# 构建与发布流程

## npm 与 jsDelivr

GitHub 保存源码和工作流，npm 保存正式版本，jsDelivr 通过 npm 版本提供 CDN。建议使用固定版本 URL，不使用 `latest` 作为生产依赖。

```text
pnpm build
  ↓
生成每个包的 dist 与声明文件
  ↓
生成 WASM manifest 和哈希
  ↓
GitHub Release
  ↓
npm publish
  ↓
jsDelivr / npm ESM
```

SDK 必须允许通过 `wasmBaseUrl` 自托管 WASM。发布前验证 JS、Worker、AudioWorklet 和 WASM 的 MIME、CORS、内容哈希和版本一致性。

`pnpm release:pack` 生成 19 个公开包 tarball 和 pack report；`pnpm release:smoke` 只从这些 tarball 安装 MX-Player-Max 包，并以 `--prefer-offline` 解析固定版本的外部 peer/dependency，验证 Node ESM、TypeScript declarations、Browser IIFE/CSS 与 React/Vue peer。`@mx-player-max/decoder-wasm-vpx` tarball 只包含已批准的 `single`/`simd` WASM 及其 provenance、BSD-3-Clause 和 PATENTS 文本，不包含 `threaded`。`pnpm release:manifest` 输出 `packages/browser/dist/manifest.json`，其中的 SHA-256、SHA-384 和 SRI 与 tarball、Browser bundle 一起进入 workflow artifact。生成目录被忽略，不作为源码手工维护。

## Docker 演示站

```bash
docker compose up --build
```

Docker 演示站用于展示 WebGPU、WASM 线程和浏览器策略，不等同于 CDN 运行时。Nginx 响应头配置见
`apps/demo/nginx.conf`：容器 80 端口启用 COOP/COEP，8080 端口不启用隔离头以验证单线程降级；
两者均启用 CSP、CORP、`nosniff` 和同一静态资源边界。Compose 映射为宿主 4173/4174。

生产镜像使用冻结的 `pnpm-lock.yaml`。HTML 导航明确使用 `Cache-Control: no-cache`；只有 Vite 内容哈希命名的 `/assets/` 资源使用一年 immutable 缓存。媒体样本使用短缓存，并由 Nginx 提供 byte Range、`206 Partial Content`、`Accept-Ranges`、`Content-Range` 和精确 `Content-Length`。

本地 Docker smoke：

```powershell
docker compose build
powershell -File scripts/release/docker-smoke.ps1
```

Smoke 使用 `mx-player-max-demo:phase-12-local` 镜像和带专用 label 的临时容器，验证 CSP、HTML/静态
资源安全头、JavaScript/CSS MIME、Nginx `application/wasm` 映射、Range、404，以及浏览器中的
隔离端点 `crossOriginIsolated === true` 和非隔离端点 `false`。发布清单包含已批准的 `single`/`simd`
WASM，但 Docker smoke 只验证静态分发合同，不冒充真实解码或 threaded 支持证据。脚本只移除本次 ID/label 均匹配的容器。

## GitHub Pages Demo

`.github/workflows/deploy-demo.yml` 是独立的手动 workflow，输入 `version` 和 `deploy_pages`。它运行
类型检查、工作区测试、Pages 构建、包/Release 合同与 Chromium 子路径 smoke，然后把
`apps/demo/dist` 上传为 Pages Artifact。只有 `deploy_pages=true` 且仓库已在 Settings > Pages 中
选择 GitHub Actions 时才执行部署；否则保留已验证 Artifact 并输出明确提示。

```text
apps/demo/dist/
  index.html + assets + flower.webm + .nojekyll
  sdk/
    manifest-approved @mx-player-max/browser JS/CSS/maps
    wasm/libvpx-vp8-single.wasm + libvpx-vp8-simd.wasm
    manifest.json
```

默认页面为 <https://maishan-inc.github.io/MX-Player-Max/>。`/sdk/` 是当前 Demo 的静态快照，不替代
npm 固定版本与 SRI 发布。准备脚本复制 release manifest 中受支持包的 `publishable: true` 文件，
只允许已批准的 `single`/`simd` WASM，并拒绝 excluded `threaded`、AI 模型和测试资产。

GitHub Pages 不提供 COOP/COEP、CSP、CORP、自定义 MIME 合同或隔离/非隔离双端点，因此不能关闭
WASM Threads、Docker runtime、真实 Safari 或 latest-two-stable 验收项。Docker 仍是这些环境合同
的权威 Demo 部署方式。

## 版本策略

- SDK 与包使用 SemVer。
- Codec/WASM 构建版本写入 manifest。
- 破坏公共接口时提升 major。
- 改变策略评分或浏览器黑名单时必须补充 ADR 和回归样本。

## GitHub Actions 门禁

普通 push/PR 只运行 CI 验证，不包含 publish step。Release workflow 的 `validate`、`package`、`consumer-smoke` 和 `artifact` 必须全部成功，才会解锁生产 job。Tag push 只执行验证链；实际发布必须在 `v*.*.*` tag 上手动 dispatch，并将 `publish` input 明确设为 `publish`，同时通过受保护的 `npm-production` environment 和 `NPM_TOKEN` secret。

Pages Demo 与 SDK Release 分离：前者只能由 `deploy-demo.yml` 手动触发，后者继续由 `release.yml`
控制。CI 和 Release workflow 不申请 Pages 写权限，Pages workflow 不包含 `npm publish` 或 npm token。

本仓库不在开发环境执行真实 `npm publish`、GitHub Release 或 CDN 发布。
