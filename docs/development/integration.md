# SDK 接入方式

## npm

```bash
pnpm add @mx-player-max/sdk
```

```ts
import { MXPlayer } from '@mx-player-max/sdk'

const player = new MXPlayer({
  target: '#player',
  source: { kind: 'url', url: 'https://media.example.com/movie.mkv' },
})

await player.ready
```

## jsDelivr ESM

```html
<script type="module">
  import { MXPlayer } from 'https://cdn.jsdelivr.net/npm/@mx-player-max/sdk@0.1.0/+esm'

  const player = new MXPlayer({
    target: '#player',
    source: { kind: 'url', url: 'https://media.example.com/movie.mkv' },
    wasmBaseUrl: 'https://cdn.jsdelivr.net/npm/@mx-player-max/decoder-wasm@0.1.0/wasm/'
  })

  await player.ready
</script>
```

## 多线程要求

开发者网站需要自行返回 COOP/COEP 响应头，SDK 不能通过 JS 替宿主页面设置安全策略。未配置或浏览器不支持时，SDK 自动选择单线程 WASM；开发者无需更改 API。

## 远程 URL

远程服务器必须允许当前页面来源的 CORS，并支持 GET Range。SDK 不代理媒体、不上传本地文件，也不把 CDN 当作媒体代理。

媒体服务器必须返回以下响应头，缺任何一项都会导致播放失败：

```http
Access-Control-Allow-Origin: <宿主页面来源>
Access-Control-Allow-Headers: Range
Access-Control-Expose-Headers: Content-Range, Content-Length, Accept-Ranges
Accept-Ranges: bytes
```

`Access-Control-Expose-Headers` 最容易遗漏。缺它时 `fetch` 能拿到 206 响应体，但 JS 读不到 `Content-Range`，SDK 无法得知文件总长度，容器解析失败——表现为「网络面板显示成功但视频加载不出来」。

## HTTPS 要求

宿主页面必须是 HTTPS（或 `localhost`）。HTTP 页面下：

- WebCodecs 不可用（需要安全上下文）→ 自定义管线失效，MKV 等非原生容器只能走 WASM 软解
- `SharedArrayBuffer` 不可用 → 多线程 WASM 失效
- WebGPU 不可用 → 渲染降级
- HTTPS 页面也无法加载 HTTP 媒体（混合内容阻止）

`localhost` 属于安全上下文，因此本地开发正常、部署到 HTTP 生产环境失败是预期行为。

完整的跨域链路分析、各类服务器配置示例和分发渠道见 `architecture/distribution-and-embedding.md`。

