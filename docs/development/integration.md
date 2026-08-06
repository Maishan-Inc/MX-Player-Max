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

