# 分发与嵌入架构

## 1. 当前发布形态

Phase 12 的公开包提供 ESM + TypeScript declarations；Browser 包另外提供固定文件名的 IIFE 和 CSS：

| 使用方式 | 安装包 | 样式 | 状态 |
|---|---|---|---|
| 引擎 API | `@mx-player-max/sdk` | 无 | 已实现 |
| 原生 DOM 播放器 UI | `sdk` + `ui` | 显式导入 `@mx-player-max/ui/style.css` | 已实现 |
| React | `@mx-player-max/react` | 显式导入 UI CSS | 已实现 |
| Vue | `@mx-player-max/vue` | 显式导入 UI CSS | 已实现 |
| Browser IIFE script tag | `MXPlayerMax` 全局 | `@mx-player-max/browser/style.css` | 已实现 |

Browser 包包含 `mx-player-max.iife.js`、`mx-player-max.iife.min.js`、`style.css` 和 ESM entry。`unpkg`/`jsdelivr` 字段指向 release-time 生成的 IIFE；生产 URL 必须锁定精确版本并使用 Manifest 的 SRI，不使用 `latest`。

## 2. 可选安装与 tree-shaking

```text
sdk -> core -> engine packages
ui  -> sdk + types + named Lucide icons
react/vue -> sdk + ui + types + framework peer
```

引擎依赖图没有任何 UI 边。`@mx-player-max/ui` 的 JS 与 CSS 是独立 entry；消费者只安装 SDK 时不会得到 UI/Lucide 代码。UI manifest 将 `dist/style.css` 标为 side effect，防止 bundler 丢弃消费者显式导入的样式，同时 JS export 保持 tree-shakable。

每个包发布前使用 `pnpm pack` 或递归 publish，让 pnpm 把 `workspace:*` 转换为真实版本。Demo 是 private app，不发布为 SDK 包。

## 3. 四种嵌入方式

### 3.1 SDK only

```ts
import { MXPlayer } from '@mx-player-max/sdk'

const player = new MXPlayer({ target: '#player', source })
await player.ready
```

Native 路径可以由宿主选择浏览器 controls；Custom canvas 没有浏览器 controls，宿主需自建界面或安装 UI 包。

### 3.2 SDK + UI

```ts
import { MXPlayer } from '@mx-player-max/sdk'
import { attachPlayerUi } from '@mx-player-max/ui'
import '@mx-player-max/ui/style.css'

const host = document.querySelector<HTMLElement>('#player')!
const player = new MXPlayer({ target: host, source })
const ui = attachPlayerUi(player, host)
```

SDK 与 UI 必须共享同一个定位容器。SDK 拥有 video/canvas/subtitle overlay，UI 只拥有控制 root。容器进入 fullscreen 后所有层保持一致；宿主 theatre mode 通过 adapter 改变外层布局。

### 3.3 React/Vue

框架组件内部组合 SDK + UI，props identity 改变时分别 reload/update，卸载时 UI-first cleanup。CSS 仍由应用显式导入，便于替换主题或完全省略官方样式。

### 3.4 Browser ESM/IIFE

```ts
import { create } from '@mx-player-max/browser'
import '@mx-player-max/browser/style.css'

const handle = create({ target: '#player', source })
await handle.ready
handle.destroy()
```

Script-tag 用户使用 `MXPlayerMax.create(...)`。IIFE 不代理媒体、不上传本地文件，也不把 Worker、AudioWorklet、WASM 或模型自动内联进主 bundle；这些资源按 Manifest 和自托管 base URL 规则解析。

## 4. 远程媒体 CORS 与 Range

Custom Range/Demux 路径的远程源必须：

- 使用 HTTP(S)，生产页面应使用 HTTPS；
- 允许宿主 origin 的 CORS；
- 支持 GET Range 并返回 `206 Partial Content`；
- 暴露 `Content-Range`、`Content-Length`、`Accept-Ranges` 和可用的 ETag；
- 返回稳定且与响应体一致的范围/总长度。

```http
Access-Control-Allow-Origin: https://app.example.com
Access-Control-Allow-Headers: Range
Access-Control-Expose-Headers: Content-Range, Content-Length, Accept-Ranges, ETag
Accept-Ranges: bytes
```

Native HTMLVideo 直接加载 URL，不能发送 `SourceDescriptor.headers`，因此 custom headers 会返回 `NATIVE_CUSTOM_HEADERS_UNSUPPORTED`。Range loader 自己控制 `Range`/`If-Range`；只把强 ETag 用作 `If-Range`，弱 ETag 只参与响应一致性比较。

SDK 不代理媒体、不上传本地文件，也不把 Demo/CDN 当作媒体代理。

## 5. 字幕与预览跨域

外挂 URL 字幕由浏览器直接 HTTPS/CORS fetch，限制 redirect、字节、chunk 和 timeout。字幕事件与公共错误不会泄露全文或完整 URL/query。

Native preview 使用隔离 media element 并默认 `crossOrigin="anonymous"`。若媒体源不允许 canvas 像素读取，预览安静返回 `null`，正常播放与 seek 不受影响。Custom preview 只调用宿主 provider；provider 结果必须是受限 PNG/JPEG/WebP Blob。公共 preview request/result 不包含 source、Frame、canvas 或 GPU 对象。

## 6. HTTPS 与安全上下文

生产宿主应使用 HTTPS。混合内容会阻止 HTTPS 页面加载 HTTP 媒体。WebCodecs、WebGPU、Service Worker 和其他高级 API 受安全上下文或浏览器实现限制；`localhost` 通常被视为安全上下文。

浏览器能力必须通过实际 API 探测，不能用品牌硬编码。能力不可用时策略选择经验证的 Native/Custom fallback；UI 只读取最终 snapshot capability。

## 7. COOP/COEP 与未来 WASM

多线程 WASM 需要 `crossOriginIsolated`、`SharedArrayBuffer` 与宿主响应头：

```http
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

SDK 无法从 JavaScript 设置这些头。启用 COEP 后，页面全部跨域资源也要提供 CORS 或 CORP。单线程路径必须是一等 fallback。

当前没有已审查 Codec WASM 二进制进入 publishable manifest。本节记录宿主分发约束，不表示任意 WASM/Codec 已支持或可发布。

## 8. 发布渠道

- npm：主渠道，使用受保护 workflow 的 `pnpm publish -r --access public` 处理 workspace 版本。
- ESM CDN：npm 发布后可供支持 ESM 的 CDN 使用；生产环境锁定精确版本并从 Manifest 复制 SRI。
- IIFE CDN：Browser 包 `unpkg`/`jsdelivr` 字段指向 `mx-player-max.iife.min.js`，示例中的版本和 SRI 是 release-time 替换模板。
- GitHub Releases：后续用于离线包、哈希清单和经许可审查的二进制。
- Docker/GHCR：只分发 Demo，不是 SDK 的安装前置。
- 自托管：企业内网、离线审计和区域 CDN 的推荐方案。

不提供 CJS 或 UMD 兼容层。SRI、SHA-256/SHA-384、IIFE/CSS 和 Worker/AudioWorklet 条目由 release manifest 生成；未审查 WASM/模型必须保持 excluded。

## 9. 安全与诊断

对外错误只能保留稳定 code、安全 message 和 recoverable。UI 进一步把播放错误压缩为 code/recoverable，不显示 URL query、subtitle text、response body、DOMException、stack 或宿主 callback message。

发布审计必须验证：

- SDK/Core 等包无 UI 依赖；
- UI 不跨入口 import 内部文件；
- UI package 只含 dist 与 README，不含 tests/Demo/framework runtime；
- `dist/style.css` 单独存在；
- SDK 构建不包含 Lucide、`mxp-` class 或 UI controller；
- Playwright 自动化与真实浏览器结果分表记录。
