# @mx-player-max/capabilities

浏览器、设备、Codec、WASM 和渲染器能力探测。探测结果用于策略评分，不直接决定后端。

## API

```ts
import { detectCapabilities, probeMediaCapabilities } from '@mx-player-max/capabilities'

const snapshot = await detectCapabilities()
const report = await probeMediaCapabilities(media, { snapshot })
```

`detectCapabilities()` 返回静态 `CapabilitySnapshot`：浏览器家族/主版本、规范化操作系统、WebCodecs/MediaCapabilities、WebGPU/WebGL2/Canvas2D 和 WASM 运行环境原语。

`probeMediaCapabilities()` 针对具体 `MediaDescriptor` 调用：

- `HTMLVideoElement.canPlayType()`；
- `MediaCapabilities.decodingInfo()`；
- `VideoDecoder.isConfigSupported()`；
- `AudioDecoder.isConfigSupported()`。

配置不足或 API 抛错返回 `unknown`，不猜测支持。缺少音轨的视频文件只验证现有轨道。

如果 MediaCapabilities 查询所需的 bitrate/framerate 等字段不完整，但 `canPlayType()` 对规范化 content type 明确返回 `probably`，Native 结果可保守记为 `supported`，原因同时记录 `can-play-type-probably` 与 `decoding-info-config-incomplete`。`maybe` 仍为 `unknown`，不会被提升。

## 零副作用边界

探测不会设置媒体 `src`、调用 `fetch`、创建 VideoDecoder/AudioDecoder 实例、请求 GPU device 或加载 WASM 资源。WASM SIMD/Threads 使用小型内联模块执行 `WebAssembly.validate()`；Threads 还必须同时满足 `crossOriginIsolated` 与 `SharedArrayBuffer`。

## 缓存与测试

默认使用内存缓存，并在可用时写入按 SDK/schema 隔离的 `sessionStorage`。`forceRefresh: true` 可绕过缓存。`CapabilityProbeAdapter` 与 `CapabilityCache` 可注入，用于无 DOM 环境和确定性测试。
