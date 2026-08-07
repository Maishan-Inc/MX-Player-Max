# @mx-player-max/strategy

媒体格式优先、能力检测驱动、平台策略可插拔的后端选择器。

```ts
const context = { snapshot, media: report }
const engine = createStrategyEngine(platformPolicy)
const ranked = engine.rank(mediaDescriptor, 'normal', context)
const selection = engine.select(mediaDescriptor, 'normal', context)
```

策略只从已验证能力生成候选：

- HTMLVideo 需要媒体报告确认原生组合可播放；
- WebCodecs 需要每条现有音视频轨的具体配置通过 `isConfigSupported`，并存在 WebGPU/WebGL2/Canvas2D 渲染器；
- WASM 需要调用方显式传入匹配 Codec 的 `WasmDecoderDeclaration`，仅有 WebAssembly API 不代表存在解码器。

候选按 `score DESC -> 固定后端优先级 -> candidate id ASC` 排序。平台插件只能返回 `PlatformScoreAdjustment`，未知候选、重复调分和非有限分数会被忽略。
