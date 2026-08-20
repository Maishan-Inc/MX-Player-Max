# WASM、CDN 与 Docker 部署

## 1. 单一 SDK 版本

对外发布一个 SDK 版本和一个稳定 JS API。Browser 包是 SDK + UI 的组合分发入口；包内通过 manifest 描述已审核资源、Codec/WASM URL、版本、哈希、线程变体和许可证。

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

Phase 10.2 增加一个审核通过的 libvpx VP8 video-only 垂直切片。Core 只有在调用方显式提供
`wasmBaseUrl` 时才构造该次会话的 VP8 declaration；未提供时没有 WASM candidate，也不会检查
isolation/SAB/SIMD/threads。VP8 packet 经共享 Decoder Worker 进入真实 WebAssembly runtime，
通过 Codec 无关 MXWF ABI v1 构造 I420 `VideoFrame`，再复用既有 Custom Pipeline 和 Renderer。

开发者不需要手动选择线程版本。SDK 在进入 WASM Decoder 后判断 `crossOriginIsolated`、`SharedArrayBuffer`、WASM Threads、SIMD 和 Worker 能力。多线程初始化失败自动回退单线程。

## 2. 懒加载和缓存

- 启动阶段只加载核心 JS 和最小能力探测器。
- 识别 Codec 后才请求对应 WASM。
- 使用版本化 URL、内容哈希和 Cache Storage/浏览器 HTTP 缓存。
- 变体按顺序下载；失败回退时可继续请求下一变体，但不会并行下载。
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

### 3.1 发布资源 Manifest

`pnpm release:manifest` 从固定白名单生成 `packages/browser/dist/manifest.json`。Manifest 使用
`packageName + packageVersion + path` 标识资源，包含文件字节数、SHA-256、SHA-384、SRI、
MIME 和资源类型。当前白名单覆盖 Browser ESM/IIFE/CSS、source map、Demux/Decoder Worker
入口、AudioWorklet 入口，以及经审核和哈希锁定的 libvpx VP8 `single`/`simd`；脚本不会递归信任任意 `dist` 目录。

Manifest 不包含生成时间，资源按包名和路径排序，因此相同输入产生逐字节相同的 JSON。
缺失文件、重复路径、目录逃逸、未知 MIME 或显式期望哈希不匹配都会终止生成。

待许可证或专利审查的 WASM 和模型只能进入 `excluded`，且 `publishable` 必须为 `false`。
当前 libvpx VP8 `single`/`simd` 已完成项目所有者授权和仓库许可证/专利门禁，进入正式 publishable assets；AI 模型仍不进入 Browser 发布清单。任何新增二进制都必须先完成来源、版本、许可证、编译选项和专利风险审查。PolyForm Noncommercial 只覆盖本仓库包，不替代第三方 Codec/WASM/模型许可证。

Phase 10.2 的 `single`、`simd`、`threaded` 三个 libvpx VP8 文件的 review 均为 `approved`；
`single`/`simd` 以固定 SHA-256 进入 `assets`。`threaded` 显式进入 `excluded`，reason 为
`threaded-host-glue-unavailable`。threaded 是真实 pthread/shared-memory 构建，但当前
没有 Emscripten pthread host glue；隔离会话尝试它后应获得可恢复初始化失败，再回退 SIMD/single。
这只证明回退安全，不代表 threaded decode 可用。

自托管时，`assetBaseUrl` 优先使用调用方显式值，否则相对于 ESM 模块 URL 或 IIFE 脚本 URL
解析；`wasmBaseUrl` 和 `aiModelBaseUrl` 分别优先使用各自显式值，否则在 `assetBaseUrl` 下
解析 `wasm/` 与 `models/`。不得从 Demo 页面 origin 猜测 SDK 资源位置。跨包 Worker 与
AudioWorklet 条目必须按 Manifest 的包名、版本和路径部署，不能只复制入口文件并丢失依赖。

## 4. Docker 响应头

演示站是静态构建产物，由 Nginx 在 Docker 内提供。要启用多线程 WASM，页面响应必须包含：

```http
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

跨域 JS、Worker、WASM、字体和媒体必须通过 CORS 或 CORP 允许嵌入。未配置隔离时 SDK 仍然使用单线程变体，不把页面判定为不可用。

## 5. Docker 安全

生产容器应配置 CSP、`X-Content-Type-Options: nosniff`、严格 HTTPS、只读文件系统和非 root Nginx。WASM 必须返回 `application/wasm`，Worker 必须返回正确 JavaScript MIME；隔离页面的 Worker 响应也必须满足 COEP/CORS/CORP 嵌入要求。Demo Playwright 验收可提供全部三个已审核开发资产；Docker/Release/Pages 只允许 manifest 中的 `single`/`simd`，不得带入技术性排除的 `threaded`。
