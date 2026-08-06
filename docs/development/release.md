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

## Docker 演示站

```bash
docker compose up --build
```

Docker 演示站用于展示 WebGPU、WASM 线程和浏览器策略，不等同于 CDN 运行时。Nginx 响应头配置见 `apps/demo/nginx.conf`。

## 版本策略

- SDK 与包使用 SemVer。
- Codec/WASM 构建版本写入 manifest。
- 破坏公共接口时提升 major。
- 改变策略评分或浏览器黑名单时必须补充 ADR 和回归样本。

