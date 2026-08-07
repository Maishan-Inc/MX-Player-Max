# 分发与嵌入

本文档定义 SDK 如何被第三方网页使用，以及项目可以分发到哪些渠道。目标是达到 Video.js、Plyr、hls.js 那样的接入体验：开发者一行 `<script>` 或一句 `npm install` 就能用。

## 1. 当前 SDK 的差距

先说现状。`packages/sdk/src/index.ts` 目前是：

```ts
export class MXPlayer {
  readonly engine: MediaEngine
  readonly ready: Promise<void>
  constructor(options: MXPlayerOptions) { ... }
  play() / pause() / seek(time) / destroy()
}
```

对比主流播放器的接入要求，缺三样：

### 1.1 缺事件系统（阻塞级）

当前 API 只有 4 个方法，**没有任何事件**。开发者无法知道：加载进度、可以播放了、播放中、暂停、时间更新、seek 完成、缓冲、错误、轨道变化、后端切换。

**没有事件系统的播放器无法被集成。** 开发者连"什么时候显示播放按钮"都不知道。

这是首要缺口。需要在 `MediaEngine` 和 `MXPlayer` 上加 `on()` / `off()` / `once()`，或暴露标准的 `EventTarget`。

### 1.2 缺 UMD/IIFE 构建（阻塞 script 标签接入）

`packages/sdk/package.json` 当前只有：

```json
"exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } }
```

**只有 ESM，没有 UMD。** 这意味着开发者不能写：

```html
<script src="https://cdn.jsdelivr.net/npm/@mx-player-max/sdk"></script>
<script>const player = new MXPlayer.MXPlayer({...})</script>
```

而这恰恰是 Video.js、Plyr、hls.js 最常见的接入方式——尤其在 WordPress、旧项目、无构建工具的页面里。ESM 虽然是现代标准，但 `<script type="module">` 无法在不支持的环境降级。

### 1.3 缺 UI 层（定位问题，非缺陷）

当前 SDK 是**纯引擎**，没有控制条、进度条、音量、全屏按钮。

这是有意的架构选择（`AGENTS.md` 定位是"媒体能力层"），但要达到"像开源播放器一样嵌入"，必须明确二选一：

| 方案 | 说明 | 类比 |
|---|---|---|
| **A：纯引擎** | 开发者自己写 UI，SDK 只管解码播放 | hls.js、dash.js、Shaka Player |
| **B：引擎 + 默认 UI** | 提供开箱即用的皮肤，可关闭 | Video.js、Plyr |

**推荐 A + 可选 UI 包**：核心 SDK 保持纯引擎，另发一个 `@mx-player-max/ui` 提供默认控制条。这样两类开发者都能满足，也不违背现有架构边界。

## 2. 三种接入方式

### 2.1 npm（构建工具用户）

```bash
npm install @mx-player-max/sdk
```

```ts
import { MXPlayer } from '@mx-player-max/sdk'

const player = new MXPlayer({
  target: '#player',
  source: { kind: 'url', url: 'https://media.example.com/movie.mkv' },
})

player.on('ready', () => player.play())
player.on('error', (e) => console.error(e.code, e.message))
```

Tree-shaking 友好，类型完整。这是 React/Vue/Svelte 项目的标准方式。

### 2.2 CDN ESM（现代浏览器，无构建）

```html
<div id="player"></div>
<script type="module">
  import { MXPlayer } from 'https://cdn.jsdelivr.net/npm/@mx-player-max/sdk@0.1.0/+esm'

  const player = new MXPlayer({
    target: '#player',
    source: { kind: 'url', url: 'https://media.example.com/movie.mkv' },
  })
</script>
```

**必须锁定版本号。** 用 `@latest` 会在发新版时静默破坏线上页面。

### 2.3 UMD 全局变量（最大兼容，需新增构建产物）

```html
<div id="player"></div>
<script src="https://cdn.jsdelivr.net/npm/@mx-player-max/sdk@0.1.0/dist/mx-player.min.js"></script>
<script>
  const player = new MXPlayerMax.MXPlayer({
    target: '#player',
    source: { kind: 'url', url: 'https://media.example.com/movie.mkv' },
  })
</script>
```

这是目前**缺失**的产物。需要在构建流程加一步（Rollup/esbuild 打 IIFE 格式，全局名 `MXPlayerMax`）。

### 2.4 建议的 package.json exports

```json
{
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "unpkg": "./dist/mx-player.min.js",
  "jsdelivr": "./dist/mx-player.min.js",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.cjs",
      "default": "./dist/index.js"
    },
    "./wasm/*": "./wasm/*"
  },
  "sideEffects": false
}
```

`unpkg` 和 `jsdelivr` 字段让 CDN 在访问包根路径时自动返回 UMD 产物，开发者不用写完整路径。

## 3. CORS 完整分析

这是集成中最容易出问题的部分。**SDK 涉及三条独立的跨域链路**，任何一条配错都会失败，且错误信息往往误导。

### 3.1 三条链路

```text
链路 1：宿主页面 → SDK JS/WASM 文件
        example.com 的页面加载 cdn.jsdelivr.net 的脚本

链路 2：宿主页面 → 媒体文件
        example.com 的页面读取 media.example.com 的视频

链路 3：宿主页面 → 字幕文件
        example.com 的页面读取外挂字幕
```

三条链路的要求不同：

| 链路 | 需要什么 | 谁负责配置 |
|---|---|---|
| SDK 文件 | CORS（CDN 已配好）+ COEP 页面需要 CORP | CDN / 我们 |
| 媒体文件 | **CORS + Range 支持** | 开发者的媒体服务器 |
| 字幕文件 | CORS | 开发者的字幕服务器 |

### 3.2 媒体服务器必须返回的响应头

这是开发者最常踩的坑。媒体服务器必须支持：

```http
Access-Control-Allow-Origin: https://example.com
Access-Control-Allow-Methods: GET, HEAD, OPTIONS
Access-Control-Allow-Headers: Range
Access-Control-Expose-Headers: Content-Range, Content-Length, Accept-Ranges
Accept-Ranges: bytes
```

**`Access-Control-Expose-Headers` 是最常被遗漏的一项。**

原因：跨域请求中，JS 默认只能读到 6 个"安全"响应头。`Content-Range` 不在其中。不 expose 的话，`fetch` 能拿到数据，但 `response.headers.get('Content-Range')` 返回 `null`——SDK 无法知道文件总长度，容器解析直接失败。

这个错误的表现是"视频加载不出来但网络面板显示 206 成功"，极难排查。

### 3.3 Range 请求的验证

服务器必须正确响应 Range 请求：

```http
请求：
GET /movie.mkv HTTP/1.1
Range: bytes=0-4095

正确响应：
HTTP/1.1 206 Partial Content
Content-Range: bytes 0-4095/8589934592
Content-Length: 4096
Accept-Ranges: bytes
```

**如果服务器返回 `200 OK` 加完整文件**，说明它不支持 Range。此时：
- 大文件会被整个下载（可能几十 GB）
- seek 无法按需读取
- 内存可能爆掉

SDK 应该在探测阶段检测这一点，明确报错而不是尝试下载。

### 3.4 常见服务器配置

**Nginx**

```nginx
location ~* \.(mp4|mkv|webm|m4v|mov)$ {
    add_header Access-Control-Allow-Origin "https://example.com" always;
    add_header Access-Control-Allow-Methods "GET, HEAD, OPTIONS" always;
    add_header Access-Control-Allow-Headers "Range" always;
    add_header Access-Control-Expose-Headers "Content-Range, Content-Length, Accept-Ranges" always;
    add_header Accept-Ranges "bytes" always;

    if ($request_method = OPTIONS) { return 204; }
}
```

Nginx 默认支持 Range，不需要额外配置。

**Cloudflare R2 / AWS S3**

需要在 bucket 的 CORS 配置里加：

```json
[{
  "AllowedOrigins": ["https://example.com"],
  "AllowedMethods": ["GET", "HEAD"],
  "AllowedHeaders": ["Range"],
  "ExposeHeaders": ["Content-Range", "Content-Length", "Accept-Ranges"],
  "MaxAgeSeconds": 3600
}]
```

S3 和 R2 原生支持 Range。

**Express / Node.js**

```js
app.use('/media', cors({
  origin: 'https://example.com',
  exposedHeaders: ['Content-Range', 'Content-Length', 'Accept-Ranges'],
}))
// 用 express.static 或 send 库，它们自带 Range 支持
```

### 3.5 SDK 应该提供的诊断

集成失败时错误信息必须明确指向原因，而不是笼统的"加载失败"：

| 现象 | 应报的错误码 | 提示 |
|---|---|---|
| fetch 被 CORS 阻止 | `SOURCE_CORS_BLOCKED` | 媒体服务器缺 `Access-Control-Allow-Origin` |
| 拿不到 Content-Range | `SOURCE_RANGE_HEADER_HIDDEN` | 缺 `Access-Control-Expose-Headers` |
| 返回 200 而非 206 | `SOURCE_RANGE_UNSUPPORTED` | 服务器不支持 Range 请求 |
| 混合内容被拦 | `SOURCE_INSECURE_ORIGIN` | HTTPS 页面不能加载 HTTP 媒体 |

这些错误码需要补充到 `packages/types/src/index.ts` 的错误码定义中。

## 4. HTTP vs HTTPS

### 4.1 混合内容阻止

**HTTPS 页面无法加载 HTTP 资源。** 浏览器会直接阻止，不给任何绕过方式。

```text
https://example.com 的页面
      ↓
加载 http://media.example.com/movie.mp4   ← 被阻止
加载 https://media.example.com/movie.mp4  ← 正常
```

这对本项目影响很大：媒体文件、SDK 脚本、WASM 文件全都必须是 HTTPS。开发者如果媒体服务器还在 HTTP，整个 SDK 不可用。

### 4.2 安全上下文限制

多个关键 API 只在**安全上下文**（HTTPS 或 localhost）可用：

| API | HTTP 页面 | 影响 |
|---|---|---|
| `SharedArrayBuffer` | 不可用 | 多线程 WASM 失效 |
| `crossOriginIsolated` | 恒为 false | 同上 |
| WebCodecs | 不可用 | **自定义管线完全失效** |
| WebGPU | 不可用 | 只能降级 WebGL2/Canvas2D |
| Service Worker | 不可用 | 无法做缓存优化 |

**WebCodecs 需要安全上下文**这一条最关键：HTTP 页面上 SDK 只剩 HTMLVideo 原生路径和 WASM 软解，MKV 播放性能会大幅下降。

`localhost` 和 `127.0.0.1` 被视为安全上下文，所以本地开发不受影响。但开发者部署到 HTTP 生产环境会遇到"本地好好的，线上不行"。

**文档必须明确要求 HTTPS。**

## 5. 多线程 WASM 与跨源隔离

### 5.1 要求

多线程 WASM 需要 `SharedArrayBuffer`，而它需要页面处于跨源隔离状态。宿主页面必须返回：

```http
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

**SDK 无法通过 JS 设置这两个头。** 它们必须由宿主页面的服务器返回。这是开发者的责任，`integration.md` 已经说明了这点。

### 5.2 COEP 的连锁反应

这是最容易被低估的坑：**开启 `require-corp` 后，页面上所有跨域资源都必须显式允许被嵌入。**

包括但不限于：
- 第三方图片、字体、iframe
- Google Analytics、广告脚本
- **SDK 自己的 JS 和 WASM 文件**

每个跨域资源都必须返回：

```http
Cross-Origin-Resource-Policy: cross-origin
```

或者通过 CORS 加载（`crossorigin` 属性）。

**结果：很多开发者开了 COEP 后发现页面上别的东西全挂了，只能关掉。** 所以：

**SDK 绝不能把多线程当作必需能力。** 单线程路径必须是完全可用的一等公民，多线程只是性能优化。这一点 `ADR-0002` 已经定了，实现时必须严格遵守。

### 5.3 我们的 CDN 产物必须支持 COEP 页面

如果开发者的页面开了 COEP，从 jsDelivr 加载我们的 SDK 时，jsDelivr 必须返回 `Cross-Origin-Resource-Policy: cross-origin` 或支持 CORS。

jsDelivr 和 unpkg 都默认返回 `Access-Control-Allow-Origin: *`，所以用 `<script crossorigin>` 加载即可：

```html
<script type="module" crossorigin>
  import { MXPlayer } from 'https://cdn.jsdelivr.net/npm/@mx-player-max/sdk@0.1.0/+esm'
</script>
```

WASM 文件通过 `fetch` 加载时天然走 CORS，没问题。

### 5.4 演示站的配置

`apps/demo/nginx.conf` 已经正确配置了：

```nginx
add_header Cross-Origin-Opener-Policy "same-origin" always;
add_header Cross-Origin-Embedder-Policy "require-corp" always;
add_header Cross-Origin-Resource-Policy "cross-origin" always;
```

第三行让演示站自己的资源可以被其他 COEP 页面嵌入，是对的。

## 6. WASM 分发

### 6.1 三种托管方式

```ts
// 方式 1：默认（跟随 SDK 版本从 CDN 加载）
new MXPlayer({ target, source })

// 方式 2：自托管（企业内网、CDN 加速、离线部署）
new MXPlayer({ target, source, wasmBaseUrl: '/assets/mx-wasm/' })

// 方式 3：指定 CDN 版本
new MXPlayer({
  target, source,
  wasmBaseUrl: 'https://cdn.jsdelivr.net/npm/@mx-player-max/decoder-wasm@0.1.0/wasm/'
})
```

`MXPlayerOptions.wasmBaseUrl` 字段已存在于 `packages/types/src/index.ts`，方向正确。

### 6.2 为什么必须支持自托管

- 企业内网无法访问公共 CDN
- 中国大陆访问 jsDelivr 不稳定
- 需要走自己的 CDN 加速
- 需要审计所有加载的二进制
- 离线部署（Electron、内网系统）

### 6.3 版本一致性

WASM 文件必须与 SDK 版本严格对应。SDK 应在加载时校验 manifest 版本，不匹配则明确报错，而不是加载一个不兼容的解码器后崩溃。

`WasmDecoderManifest` 已有 `version` 和 `sha256` 字段，运行时校验逻辑需要在 Phase 8 实现。

## 7. 分发渠道

### 7.1 npm（主渠道，必需）

```bash
npm publish --access public
```

所有包已配置 `"publishConfig": { "access": "public" }`。

`@mx-player-max/*` 是 scoped 包，免费账户下 scoped 包默认私有，**必须显式指定 `--access public`**，否则发布会失败或变成私有包。

发布哪些包需要决策：

| 包 | 是否发布 | 理由 |
|---|---|---|
| `sdk` | 是 | 主入口 |
| `types` | 是 | 类型依赖 |
| `core` / `strategy` / `capabilities` / `demux` / `decoder-*` / `renderers` / `audio` / `subtitles` / `platform` | 是 | sdk 的依赖链 |
| `react` / `vue` | 是 | 框架适配 |
| `decoder-wasm` | 是（含二进制） | WASM 产物 |
| `demo` | 否 | 已标 private |

**注意**：`workspace:*` 依赖在发布时必须被替换成真实版本号。pnpm 的 `pnpm publish` 会自动处理，但用 `npm publish` 不会——这会导致发布出去的包无法安装。CI 里必须用 `pnpm publish -r`。

### 7.2 jsDelivr（自动，零配置）

npm 发布后自动可用：

```
https://cdn.jsdelivr.net/npm/@mx-player-max/sdk@0.1.0/+esm
https://cdn.jsdelivr.net/npm/@mx-player-max/sdk@0.1.0/dist/mx-player.min.js
```

`+esm` 后缀会自动转换 CommonJS 为 ESM 并处理依赖，对纯 ESM 包也能正常工作。

全球 CDN，中国大陆有节点但稳定性一般。

### 7.3 unpkg（自动，零配置）

```
https://unpkg.com/@mx-player-max/sdk@0.1.0/dist/mx-player.min.js
```

与 jsDelivr 平行，作为备选。会读 package.json 的 `unpkg` 字段。

### 7.4 GitHub Releases

放构建产物压缩包、WASM 二进制、SHA-256 清单、CHANGELOG。适合：
- 离线部署包
- WASM 二进制的独立版本流（`packages/decoder-wasm/wasm/README.md` 提到的独立发布流程）
- 需要审计来源的企业用户

### 7.5 Docker（演示站）

`apps/demo/Dockerfile` 已存在。发布到 Docker Hub 或 GHCR：

```bash
docker pull ghcr.io/<org>/mx-player-max-demo:0.1.0
```

**Docker 镜像只是演示站，不是 SDK 分发渠道。** 文档要说清楚这点，避免开发者以为需要跑容器才能用 SDK。

### 7.6 中国大陆访问

jsDelivr 在大陆时快时慢。可以在文档提供备选：

- 自托管（推荐生产环境）
- npmmirror 镜像（`https://registry.npmmirror.com`，仅安装加速，不是 CDN）
- 自建 CDN 分发

不建议依赖任何单一公共 CDN 做生产部署。

## 8. Subresource Integrity

CDN 接入建议提供 SRI 哈希：

```html
<script
  src="https://cdn.jsdelivr.net/npm/@mx-player-max/sdk@0.1.0/dist/mx-player.min.js"
  integrity="sha384-<hash>"
  crossorigin="anonymous"
></script>
```

防止 CDN 被入侵或中间人篡改。构建流程应自动生成 SRI 哈希并写入发布文档。

`security-and-privacy.md` 已经要求 WASM 做 SHA-256 校验，JS 产物的 SRI 是同一思路的延伸。

## 9. 与主流播放器的对比

| | Video.js | Plyr | hls.js | Shaka Player | MX-Player-Max（目标） |
|---|---|---|---|---|---|
| 定位 | 引擎 + UI | UI 壳 | 流媒体引擎 | 流媒体引擎 | **全格式文件引擎** |
| UI | 完整 + 皮肤 | 完整 | 无 | 无 | 可选包 |
| 容器支持 | 浏览器原生 | 浏览器原生 | HLS | HLS/DASH | **MKV/TS/AVI + 原生** |
| 自定义解码 | 无 | 无 | 无 | 无 | **WebCodecs + WASM** |
| 逐帧访问 | 无 | 无 | 无 | 无 | **有** |
| UMD 产物 | 有 | 有 | 有 | 有 | **缺** |
| 事件系统 | 有 | 有 | 有 | 有 | **缺** |

差异化优势清晰：**没有任何主流 Web 播放器支持 MKV 直接播放。** 这是本项目的核心价值。

但要让开发者用得上，必须补齐 UMD 产物和事件系统这两块基础设施——它们不是加分项，是入场券。

## 10. 落地优先级

按阻塞程度排序：

| 优先级 | 事项 | 阻塞什么 |
|---|---|---|
| **P0** | 事件系统（`on`/`off`/`once`） | 任何集成 |
| **P0** | UMD/IIFE 构建产物 | script 标签接入 |
| **P0** | CORS 错误码与诊断 | 集成排障 |
| **P1** | `exports` 补 `require` / `unpkg` / `jsdelivr` 字段 | CJS 用户、CDN 默认路径 |
| **P1** | 文档明确 HTTPS 要求 | 生产部署失败 |
| **P1** | CI 用 `pnpm publish -r` 处理 workspace 依赖 | 发布出去的包装不上 |
| **P2** | `@mx-player-max/ui` 默认皮肤包 | 无 UI 开发者的接入体验 |
| **P2** | SRI 哈希生成 | 安全加固 |
| **P3** | Docker Hub / GHCR 镜像发布 | 演示站分发 |

P0 三项在实现 `MediaEngine` 时一并完成成本最低，不必等到 Phase 10。
