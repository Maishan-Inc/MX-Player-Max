# @mx-player-max/postprocess

AI 后处理层：插帧与超分辨率。

## 当前阶段

Phase 7 实现了拉取式 AI 链、WebGPU RIFE/RT4KSR stage、纹理池、governor、MXAI manifest/哈希加载器和真实上游权重资产。RIFE 资产明确为 Practical-RIFE 4.25；上游没有可锁定的 4.6 archive。

**超分（RT4KSR x2）已与上游 PyTorch forward 端到端对齐并可验证**：`pnpm quality:webgpu:oracle`
用真实权重跑 shipped `Rt4kSrGraphExecutor`，对 `tools/generate_rt4ksr_reference.py` 生成的
参考张量，8-bit 输入下输出 `max |delta| = 3.7e-3`。验证跑在软件 adapter（SwiftShader）上，
只覆盖正确性；`shader-f16`、性能和实机三浏览器矩阵仍未覆盖。

**插帧（RIFE）仍是占位实现**：`createRifeGraph()` 只枚举层，没有 executor 消费它；
`WebGpuInterpolationStage` 只 dispatch 一个 warp/blend pass，且把输入帧当作光流纹理绑定。
不要把它当作 RIFE 推理。SDK 因此把该 stage 报成 `not-implemented`，UI 开关保持禁用。

RIFE 所需的算子已逐个对上游验证：`pnpm quality:webgpu:rife` 覆盖 `Head`（含
`ConvTranspose2d`）、`grid_sample` 反向 warp 和 `align_corners=False` 双线性 resize。
仍缺 IFBlock body、五级 flow 累积、可表达 concat/slice/resize/warp 的 graph IR，以及最终
sigmoid blend 的接线。

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
