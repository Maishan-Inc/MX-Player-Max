# @mx-player-max/demux

Range Loader、容器探测、轨道解析和压缩包输出边界。解封装与 Codec 解码严格分离。

## Phase 2 能力

- `FileRangeLoader`：只读取 `File.slice()` 对应的半开字节范围，支持 AbortSignal、有界并发、缓存和幂等关闭。
- `HttpRangeLoader`：只接受 HTTP(S) URL 和精确的 `206 Partial Content`，严格校验 `Content-Range`、可用的 `Content-Length`、响应体长度、ETag 与源总长度。
- `LruRangeCache`：按源身份、ETag 和精确范围隔离，限制条目数与总字节数，读写均复制数据。
- `probeContainer`：根据 magic bytes 选择 MP4、Matroska 或 WebM adapter，不使用文件扩展名作结论。
- `Demuxer`：输出未解码的 `DemuxPacket`，包含微秒 PTS、nullable duration、轨道、关键帧和压缩数据。
- `DemuxWorkerController`：提供 `start/read/seek/close`、session/epoch 隔离和关闭后的迟到消息抑制。

## Range 读取

```ts
import {
  FileRangeLoader,
  HttpRangeLoader,
  LruRangeCache,
} from '@mx-player-max/demux'

const cache = new LruRangeCache({ maxEntries: 64, maxBytes: 16 * 1024 * 1024 })
const local = new FileRangeLoader(file, { cache, maxConcurrentReads: 4 })
const remote = new HttpRangeLoader('https://media.example/video.mp4', {
  cache,
  credentials: 'omit',
  retry: { maxRetries: 2, baseDelayMs: 50, maxDelayMs: 1_000 },
})

const result = await remote.read({ start: 0, endExclusive: 4096 })
```

调用方不能覆盖 `Range`、`If-Range`、`Content-Length` 等受控请求头。`200 OK` 不会被当作 Range 成功。默认重试仅覆盖同源/明确网络失败和 `5xx`；CORS、重定向、4xx、协议错误与取消不重试。

浏览器 Fetch 无法可靠区分跨源 CORS 拒绝与被安全边界隐藏的跨源 DNS/连接故障。实现将跨源 fetch 拒绝映射为 `RANGE_CORS_FAILED`，明确离线或同源失败映射为 `RANGE_NETWORK_FAILED`。

## 容器边界

```ts
import { createRangeLoader, probeContainer } from '@mx-player-max/demux'

const loader = createRangeLoader({ kind: 'file', file })
const { metadata, demuxer } = await probeContainer(loader)
const packets = await demuxer.next()
await demuxer.seek(5_000_000)
demuxer.close()
loader.close()
```

Matroska/WebM 支持 EBML Header、未知长度 Segment/Cluster、Info、Tracks、SimpleBlock、BlockGroup、四种 lacing 和 Cues。无 Cues seek 使用受字节预算限制的 Cluster 前向扫描。WebM 必须由 `DocType=webm` 识别。

MP4 支持 `ftyp/moov/trak/mdia/minf/stbl/mdat`、32/64 位 box size、合法 `size=0`、尾部 `moov`、Codec 配置以及 `stts/ctts/stsc/stsz/stco/co64/stss`。Probe 跳过 `mdat` 正文。fMP4 可被识别并输出初始化段轨道信息，但 Phase 2 不实现 fragment packet 流或 MSE 播放。

未知 CodecID/FourCC 会按原值保留，不会用容器名或猜测值填充 `TrackInfo.codec`。

## 默认资源预算

| 项目 | 默认值 |
|---|---:|
| 单次 Range | 8 MiB |
| 可缓冲元数据元素 | 16 MiB |
| box/EBML 声明 span | 1 TiB |
| 嵌套深度 | 16 |
| 轨道 | 64 |
| 单 packet | 32 MiB |
| 关键帧索引 | 250,000 |
| 无索引前向扫描 | 64 MiB |
| 单次 Worker packet 消息 | 32 MiB |

大于单次 Range 但仍在缓冲预算内的数据通过多个精确 Range 读取。`Segment`、`Cluster` 和 `mdat` 不整体分配。

## Worker

模块 Worker 入口通过 `@mx-player-max/demux/worker` 导出。所有请求与响应携带 `sessionId`、`epoch` 和 `requestId`。seek 必须使用递增 epoch；close 会中止 Loader、关闭 Demuxer，并抑制旧 epoch 的异步结果。

该包不构造 `VideoDecoder`、`AudioDecoder`、HTMLVideo、MediaSource、Renderer、AudioWorklet，也不下载或实例化 WASM。
