# @mx-player-max/postprocess

AI 后处理层：插帧与超分辨率。

## 当前阶段

Phase 7 实现了拉取式 AI 链、WebGPU RIFE/RT4KSR stage、纹理池、governor、MXAI manifest/哈希加载器和真实上游权重资产。RIFE 资产明确为 Practical-RIFE 4.25；上游没有可锁定的 4.6 archive。

**超分（RT4KSR x2）已与上游 PyTorch forward 端到端对齐并可验证**：`pnpm quality:webgpu:oracle`
用真实权重跑 shipped `Rt4kSrGraphExecutor`，对 `tools/generate_rt4ksr_reference.py` 生成的
参考张量，8-bit 输入下输出 `max |delta| = 3.7e-3`。验证跑在软件 adapter（SwiftShader）上，
只覆盖正确性；`shader-f16`、性能和实机三浏览器矩阵仍未覆盖。

**插帧（RIFE 4.25）同样已与上游 `IFNet.forward` 端到端对齐**：`pnpm quality:webgpu:rife`
用真实权重跑 shipped `RifeGraphExecutor`（155 个节点、单 encoder、单次 submit、单次 fence），
对 `tools/generate_rife_reference.py` 生成的 31 个参考 stage 逐个比较：`encode`、`block0..4`
的 `flow`/`mask`/`feat`/`warped0`/`warped1`、`mask.sigmoid` 全部在 `1.8e-4` 以内，最终
`output` 为 `2.0e-3` —— 正好是 `rgba8unorm` 半个 8-bit 步长，也就是这条链的下限。SDK 因此
按能力（模型是否配置 + 会话是否 WebGPU 自定义管线）报告该 stage，UI 开关随之可用。

IFNet 的中间激活默认存 `rgba32float` 而不是 `rgba16float`：flow 是以像素为单位的位移，在该
fixture 上达到 `|5|`，半精度 ulp 已经是 4e-3 像素，而五个 block 会把各自的 flow 反馈进彼此的
warp。同一 fixture 上半精度会让 `output` 偏到 `1.4e-1`（36 个 8-bit 步长），因此出厂默认就是
门禁真正验证过的那个配置。代价是显存：1080p 下激活池约 1040 MiB（半精度约 520 MiB），
`RifeExecutorOptions.activationFormat` 可以换，`RifeGraphExecutor.activationBytes` 可以读出来。
细节与两个负向对照见 `docs/development/webgpu-harness.md`。

插帧需要队列里多留一帧：`AiPipeline.lookaheadFrames` 由 core 接到
`CustomMediaPipeline.setVideoLookahead()` 上，`AiPipeline.consumedThrough` 告诉消费者队列
真正可以释放到哪一帧 —— 不能按刚呈现的那帧释放，因为两帧之间的每个相位都还要读较早那帧。

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
