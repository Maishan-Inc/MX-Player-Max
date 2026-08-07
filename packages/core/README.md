# @mx-player-max/core

媒体引擎生命周期、后端组合和统一事件边界。核心包不包含 UI，不直接绑定 React/Vue，也不内置具体 Codec。

## Phase 3 NativeMediaPipeline

`createMediaEngine()` 先复用 `@mx-player-max/demux` 的 RangeLoader 与 ContainerAdapter 读取有限 Probe，再调用 `@mx-player-max/capabilities` 和既有 `@mx-player-max/strategy`。只有最终候选为 `html-video` 且意图为 `normal`/`low-power` 时，才创建 NativeMediaPipeline。

```ts
const engine = createMediaEngine()
await engine.load({
  target: '#player',
  source: { kind: 'file', file },
  native: { preload: 'metadata', playsInline: true },
})
await engine.play()
await engine.seek(30_000_000) // Micros: 30 seconds
```

远程源必须是 HTTP(S)，并由源站提供 CORS 与 Range。远程 URL 直接赋给 `<video>`，默认 `crossOrigin="anonymous"`、`preload="metadata"`、`playsInline=true`；`SourceDescriptor.headers` 无法由 HTMLVideo 发送，因此会显式返回 `NATIVE_CUSTOM_HEADERS_UNSUPPORTED`。MIME/Codec 来自容器 Probe 与已验证的 `MediaCapabilityReport.native.*.contentType`，绝不从扩展名猜测。

NativeMediaPipeline 只消费和管理 HTMLVideoElement 及其原生音频，不输出 `VideoFrame`，也不实现 WebCodecs、WASM、MSE、HLS、DASH、AudioWorklet 或自定义 Renderer。`requestVideoFrameCallback` 仅用于呈现/丢帧/媒体时间统计。

`close()` 会移除事件监听、取消帧回调、停止播放、撤销引擎拥有的 File Object URL，并移除引擎创建的 video；调用方提供的 video 节点不会被删除。所有异步回调都带 load epoch 检查，旧源不会继续发事件。
