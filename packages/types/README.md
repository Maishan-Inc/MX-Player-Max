# @mx-player-max/types

所有公共媒体、轨道、能力、策略和错误类型的单一来源。

## Phase 1 公共契约

- `Micros`：所有媒体时间戳与时长的微秒单位。
- `TrackInfo` / `MediaDescriptor`：容器、轨道、Codec、码率、色彩与 HDR 元数据。
- `VideoCodecConfig` / `AudioCodecConfig`：不依赖具体浏览器实现的 Codec 配置。
- `CapabilitySnapshot`：版本化、可序列化的运行环境快照，不包含具体媒体支持结论。
- `MediaCapabilityReport`：针对一个媒体配置的 HTMLVideo、MediaCapabilities 与 WebCodecs 结果。
- `CapabilityContext`：策略层消费的环境快照、媒体报告与可选 WASM 声明。
- `EngineEventMap` / `EngineEventSource`：core、SDK 和 UI 适配层共用的强类型事件契约。
- `PlatformScoreAdjustment`：平台策略唯一允许返回的候选调分结构。

`CapabilitySupport` 有三种状态：`supported` 表示 API 明确支持，`unsupported` 表示 API 明确拒绝或不存在，`unknown` 表示配置不足或探测失败。调用方不得把 `unknown` 当成支持。

`BackendKind` 已预留 `mse`，但 Phase 1 不生成 MSE 候选。
