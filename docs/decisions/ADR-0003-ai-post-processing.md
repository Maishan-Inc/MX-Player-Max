# ADR-0003：AI 后处理采用拉取式帧源 + 手写 WGSL

## 状态

已接受。

## 背景

MX-Player-Max 需要支持 AI 插帧（frame interpolation）和超分辨率（super-resolution）。这引入了三个架构问题：

1. 插帧是 2-进-N-出的变换，需要改写呈现时间轴。若用 push 式滤镜，滤镜必须自行发明呈现时间表，与音频主时钟规则冲突。
2. ONNX Runtime Web 是常见的浏览器端神经网络运行时选项，但它对 RIFE 的关键算子 `GridSample` 支持很晚（v1.26.0），且引入数 MB WASM+JS。
3. HTMLVideo 原生路径通过 `requestVideoFrameCallback` + `importExternalTexture` 理论上可把帧引入自定义管线，但这违反了 audio-pipeline.md:39 对「原生 HTMLVideo 音频 + 自定义视频」的禁止。

## 决策

### 1. 拉取式帧源（Pull-based FrameSource）而非 push 式滤镜

```typescript
export interface FrameSource {
  frameAt(t: Micros, epoch: number): Promise<PipelineFrame | null>
  readonly lookaheadFrames: number
  reset(epoch: number): void
  close(): void
}
```

呈现循环按时钟时刻 `t` 从后处理链拉取帧。插帧器合成 `t` 两侧帧之间相位 `(t - tA) / (tB - tA)` 的画面，超分器放大该帧，passthrough 返回最近帧。同一接口覆盖所有情况，且可变输出帧率免费获得。

现有 `VideoRenderer.render(frame: VideoFrame)` 接口不变——变的是调用方。

### 2. 手写 WGSL Compute Shader，不引入 ONNX Runtime Web

- 只有两个固定的已知网络需要运行（RT4KSR + RIFE）
- ORT Web 的 `GridSample` 仅 v1.26.0+ 可用：为该算子押注新实现过于脆弱
- 自写 GridSample warp 约 60 行 WGSL（对流场做双线性采样）
- 已有验证：Chrome 扩展绕开 ONNX 纯手写 WGSL 实现 3-4ms/帧 RIFE 
- SR 端 RT4KSR 的结构重参数化折叠为纯卷积栈，几乎 1:1 映射到 WGSL compute pass
- AGENTS.md §5 的二进制审查负担远低于一个大依赖树

### 3. HTMLVideo 原生路径首阶段明确不启用 AI

- audio-pipeline.md:39 对混用原生/自定义时钟的禁止使该配置不存在
- 插帧编排自己的呈现时间，会使规则要防的漂移从偶发变为结构性
- 外加 HDR 元数据丢失、DRM 硬阻断、无零拷贝 overlay 导致高功耗
- 需先有独立 ADR 设计「明确的外部时钟桥接」，方可重启

请求 AI 增强的加载将强制选择 CustomMediaPipeline。

### 4. Anime4K-WebGPU 作为有条件的低档

Anime4K-WebGPU 是本特性唯一的有意破例（引入外部源）。理由：纯 WGSL（无 WASM）、审查面仅为着色器源码、许可证 MIT。若法务审查不通过，直接弃用，低档改用 RT4KSR 的小型变体。

## 后果

- 呈现循环从后处理链拉取而非从解码队列直接取帧
- 插帧器引入 +1 帧（24fps 下 +41.7ms）启动延迟，但不引入逐帧停顿
- 手写 WGSL 增加实现成本（~15-22 周）但消除 ONNX Runtime 的依赖与许可证包袱
- AI 特性在 CustomMediaPipeline 上可用，NativeMediaPipeline 首阶段排除
- 所有 AI 错误码归入 `RENDERER_AI_*`，不新增 `AI_*` 命名空间（避免修改 AGENTS.md §7 的既定命名空间列表）
- 模型资产分发复用 WASM manifest 的 `version`/`variants`/`sha256`/`license` 模板
