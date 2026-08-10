# WASM、CDN 与 Docker 部署

## 1. 单一 SDK 版本

对外发布一个 npm 包和一个稳定 JS API。包内通过 manifest 描述 Codec 解码器、WASM URL、版本、哈希、线程变体和许可证。

```text
SDK Loader
  ↓
Decoder Registry
  ↓
Codec Plugin
  ↓
threaded / simd / single 变体
```

Phase 10 的 `@mx-player-max/decoder-wasm` Manager 只在策略已经选择 WASM 后运行。它
通过 Registry 找到匹配的 Codec 插件，校验 manifest 的来源/构建/许可证/专利字段，
再按能力快照产生变体顺序。Manager 不判断浏览器名称，也不把 WebAssembly API 的存在
当成某个 Codec 已经可解码。

开发者不需要手动选择线程版本。SDK 在进入 WASM Decoder 后判断 `crossOriginIsolated`、`SharedArrayBuffer`、WASM Threads、SIMD 和 Worker 能力。多线程初始化失败自动回退单线程。

## 2. 懒加载和缓存

- 启动阶段只加载核心 JS 和最小能力探测器。
- 识别 Codec 后才请求对应 WASM。
- 使用版本化 URL、内容哈希和 Cache Storage/浏览器 HTTP 缓存。
- 单线程与多线程变体不能同时下载。
- 失败结果按会话缓存，避免重复初始化坏二进制。
- Worker、AudioWorklet 和 WASM 资源必须提供可诊断的加载错误。

Manager 的缓存键包含插件 ID、Codec、版本、变体、解析后的 URL 和 SHA-256。缓存命中
仍会重新计算 SHA-256；损坏缓存会标记失败并沿变体顺序安全回退。相同键的并发加载共享
一个请求，不同变体不会并行下载。取消使用 `WASM_ABORTED`，Manager 关闭后新加载使用
`WASM_CLOSED`。

资源 URL 只允许 HTTP(S)，不得携带用户名或密码；相对路径必须留在配置的 base path
内。请求拒绝自动重定向，注入 fetcher 返回的已重定向响应也必须被 Loader 拒绝。
Manager 默认只向策略层输出 review 已批准插件的声明，避免策略先选择一个随后必然被
发布门禁拒绝的 WASM 后端。

## 3. 发布渠道

GitHub 保存源码、构建工作流和 Release。正式包发布到 npm，jsDelivr 通过 npm 版本提供 ESM CDN 入口。允许开发者将 WASM 自托管，通过 `wasmBaseUrl` 或 manifest 覆盖默认地址。

```text
npm @mx-player-max/*
        ↓
jsDelivr ESM/CDN
        ↓
开发者网页加载 SDK
```

CDN 只负责分发，解码仍在用户浏览器本地完成。远程媒体源必须允许当前页面 CORS 和 Range。

## 4. Docker 响应头

演示站是静态构建产物，由 Nginx 在 Docker 内提供。要启用多线程 WASM，页面响应必须包含：

```http
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

跨域 JS、Worker、WASM、字体和媒体必须通过 CORS 或 CORP 允许嵌入。未配置隔离时 SDK 仍然使用单线程变体，不把页面判定为不可用。

## 5. Docker 安全

生产容器应配置 CSP、`X-Content-Type-Options: nosniff`、严格 HTTPS、只读文件系统和非 root Nginx。WASM 必须返回 `application/wasm`，Worker 必须返回正确 JavaScript MIME。
