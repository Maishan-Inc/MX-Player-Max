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

`pnpm release:pack` 生成 17 个公开包 tarball 和 pack report；`pnpm release:smoke` 只从这些 tarball 安装隔离消费者，验证 Node ESM、TypeScript declarations、Browser IIFE/CSS 与 React/Vue peer。`pnpm release:manifest` 输出 `packages/browser/dist/manifest.json`，其中的 SHA-256、SHA-384 和 SRI 与 tarball、Browser bundle 一起进入 workflow artifact。生成目录被忽略，不作为源码手工维护。

## Docker 演示站

```bash
docker compose up --build
```

Docker 演示站用于展示 WebGPU、WASM 线程和浏览器策略，不等同于 CDN 运行时。Nginx 响应头配置见 `apps/demo/nginx.conf`。

生产镜像使用冻结的 `pnpm-lock.yaml`。HTML 导航明确使用 `Cache-Control: no-cache`；只有 Vite 内容哈希命名的 `/assets/` 资源使用一年 immutable 缓存。媒体样本使用短缓存，并由 Nginx 提供 byte Range、`206 Partial Content`、`Accept-Ranges`、`Content-Range` 和精确 `Content-Length`。

本地 Docker smoke：

```powershell
docker compose build
powershell -File scripts/release/docker-smoke.ps1
```

Smoke 使用 `mx-player-max-demo:phase-12-local` 镜像和带专用 label 的临时容器，验证 HTML/静态资源安全头、JavaScript/CSS MIME、Nginx `application/wasm` 映射、Range、404 以及浏览器中的 `crossOriginIsolated === true`。当前发布清单不含已审查 WASM 二进制，因此 smoke 不伪造可发布 WASM 资源。脚本只在容器 ID 和专用 label 都匹配时移除本次创建的容器；同名既有容器不会被修改。

## 版本策略

- SDK 与包使用 SemVer。
- Codec/WASM 构建版本写入 manifest。
- 破坏公共接口时提升 major。
- 改变策略评分或浏览器黑名单时必须补充 ADR 和回归样本。

## GitHub Actions 门禁

普通 push/PR 只运行 CI 验证，不包含 publish step。Release workflow 的 `validate`、`package`、`consumer-smoke` 和 `artifact` 必须全部成功，才会解锁生产 job。Tag push 只执行验证链；实际发布必须在 `v*.*.*` tag 上手动 dispatch，并将 `publish` input 明确设为 `publish`，同时通过受保护的 `npm-production` environment 和 `NPM_TOKEN` secret。

本仓库不在开发环境执行真实 `npm publish`、GitHub Release 或 CDN 发布。
