# @mx-player-max/postprocess

AI 后处理层：插帧与超分辨率。

## 当前阶段

Phase 7 实现了拉取式 AI 链、WebGPU RIFE/RT4KSR stage、纹理池、governor、MXAI manifest/哈希加载器和真实上游权重资产。RIFE 资产明确为 Practical-RIFE 4.25；上游没有可锁定的 4.6 archive。

模型失败、shader/device loss、fallback adapter 和预算超限都会保留解码/音频时钟并回退为 passthrough。Native HTMLVideo 路径不会启用 AI。

真实推理使用 `MXAI` v1 派生资产。应用在 `MXPlayerOptions.aiModelBaseUrl` 指向包含
`weights/rt4ksr/rt4ksr_x2.mxai` 和 `weights/rife/rife_v4.25.mxai` 的 HTTPS 根目录后，Core
才会懒加载、校验哈希并上传 tensor；未提供根目录时仍保留无模型的可恢复 passthrough。

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

详见 `docs/ai/overview.md` 和 `docs/development/phase-7-acceptance.md`。

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
