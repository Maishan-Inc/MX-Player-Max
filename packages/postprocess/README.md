# @mx-player-max/postprocess

AI 后处理层：插帧与超分辨率。

## 当前阶段

契约层实现完成。包含类型定义、passthrough 帧源骨架、governor 接口和模型 manifest schema。

WGSL 着色器实现、权重加载器、纹理池与 GPU 管线属于**阶段 5.5**，依赖阶段 4（帧队列）与阶段 5（WebGPU 渲染器）完成后方可启动。

## 架构

采用**拉取式帧源（Pull-based FrameSource）**设计。呈现循环按时钟时刻 `t` 从后处理链拉取帧，而非推送式滤镜。

```typescript
interface FrameSource {
  frameAt(t: Micros, epoch: number): Promise<PipelineFrame | null>
  readonly lookaheadFrames: number
  reset(epoch: number): void
  close(): void
}
```

- 插帧器合成 `t` 两侧帧之间相位 `(t - tA) / (tB - tA)` 的画面
- 超分器放大该帧
- passthrough 返回最近的原始帧

详见 `docs/ai/overview.md`。

## 依赖

仅依赖 `@mx-player-max/types`。不得依赖 `renderers`、`core` 或 `strategy`——本包是叶子，由 `core` 组合。

## 公共 API

```typescript
export { createPassthroughSource } from './passthrough'
export type * from './types'
export type { AiModelManifest, ModelPrecision } from './assets/manifest'
export type { FrameBudgetGovernor } from './governor'
```

## 参考

- [docs/ai/README.md](../../docs/ai/README.md)
- [docs/decisions/ADR-0003-ai-post-processing.md](../../docs/decisions/ADR-0003-ai-post-processing.md)
