# 运行时调度与降级治理

AI 特性的质量决策需要三方协调：`capabilities`（启播前探测）、`strategy`（启播时选择）、`postprocess/governor`（播放中自适应）。三方职责不可混淆。

## 职责切分

### (a) capabilities：仅探测

```typescript
export interface WebGpuFeatureSnapshot {
  readonly available: boolean
  readonly float32Filterable: boolean        // Anime4K 必需
  readonly shaderF16: boolean                // ~2x 内存带宽节省
  readonly maxComputeWorkgroupStorageSize: number
  readonly maxTextureDimension2d: number
  readonly maxBufferSize: number
  readonly importExternalTexture: boolean    // Firefox stable = false
  readonly adapterVendor: string | null
  readonly adapterArchitecture: string | null
  readonly isFallbackAdapter: boolean        // 关键：true 时必须拒绝 AI
}
```

**规则**：
- WebGPU 缺席时不得抛错——返回 `available: false`
- Fallback adapter 上**必须**标记 `isFallbackAdapter: true`——软件光栅器跑实时 AI 只会卡死
- 不得做任何选择——探测是纯数据的

**既有缺陷**（本次修正）：
- `packages/capabilities/src/index.ts:20`：`'gpu' in navigator` ≠ 可用。需真实 `requestAdapter()`。
- `packages/capabilities/src/index.ts:29`：`wasmSimd: false` 硬编码。需真正探测 WebAssembly SIMD。

### (b) strategy：静态提议

`createCandidates()` 在 `intent === 'ai-enhance'` 时的行为：

1. **排除 `html-video` 候选**——原生路径不支持 AI（见 ADR-0003）
2. **强制 `renderer: 'webgpu'`**——WebGL2/Canvas2D 无法运行 compute shader，无 WebGPU 时 AI 候选需被淘汰而非降级
3. 由 `CapabilitySnapshot.webGpuFeatures` 提议起始 `AiQualityTier`：
   - 高端独显 + `shaderF16` + `float32Filterable` → 建议 `high`
   - Apple Silicon → 建议 `medium`
   - 集显 → 建议 `low`
   - Fallback adapter → `off`（不提议 AI）

**strategy 是纯函数**：同输入 → 同输出，不持有状态，不测量性能。

### (c) postprocess/governor：运行时自适应

**这是真正的运行时环路**，有状态且持续，是 `capabilities` 和 `strategy` 都无法承载的新增职责。

```typescript
export interface FrameBudgetGovernor {
  calibrate(device: GPUDevice, width: number, height: number): Promise<AiQualityTier>
  record(stageMs: number, budgetMs: number): void
  readonly tier: AiQualityTier
  readonly onTierChange: (listener: (tier: AiQualityTier) => void) => () => void
}
```

## Governor 策略

### 校准（启动时）

以真实播放分辨率跑约 10 帧合成基准，取中位数：

```
预算 = 1000 / displayHz × frameBudgetRatio
60Hz → 16.7ms → 60% = 10ms
120Hz → 8.3ms → 60% = 5ms
144Hz → 6.9ms → 60% = 4.1ms
```

选择低于 **60% 预算** 的最高可用 tier。

**60% 不是随便选的**：留 40% 给解码、合成、浏览器渲染和页面 JS。低于 50% 时会因任何瞬时抖动而掉入降级循环，高于 70% 时几乎不达实时。Amazon IVS 在类似场景下实测约 8–9ms（1080p → 4K），落在 16.7ms 的约 50%。

### 快速降级（degrade fast）

每 30 帧滑动窗口中位数超过预算 **85%** → 立即降档：

1. **先关闭插帧**，保留超分
   - 理由：画面锐利但卡顿远比柔和但流畅更糟
   - 策略失败时最可见的不是分辨率，是掉帧
2. **降低超分档位**：ultra→high→medium→low
3. **最后关闭超分**：回到原始分辨率
4. 超过 `maxTier` 的超分 + 插帧组合直接拒绝

### 缓慢升级（recover slow）

低于预算 **50%** 持续 10 秒 → 升一档：

- 每 30 秒最多升一档，**防止振荡**
- 振荡的危害大于低一档：用户会注意到反复的质量变化，而不是稳定的较低质量

### 边界情况

- **Seek 期间不降档**：seek 瞬时开销（解码器 reset、纹理池重建）会造成假阳性
- **静默降级被禁止**：档位变化必须作为 SDK 事件上报。`docs/architecture/subtitle-pipeline.md:25` 已要求字幕降级为明确行为，AI 降级同理
- **设备丢失**：GPU 丢失后 governor 标记为 off，播放器回到 passthrough——对齐 AGENTS.md §5「回退必须保留当前 source」

## 测量方式

优先级：
1. **`GPUQueue.timestamp-query`**（accurate，零额外开销）→ 当 `timestamp-query` 特性可用时
2. **`onSubmittedWorkDone()` + wall clock**（rough，adds latency）→ 作为 fallback
3. **`requestVideoFrameCallback` callbacks**（仅 HTMLVideo 路径，AI 不可用时）→ 不适用

当前实现走第 2 条：`Rt4kSrGraphExecutor` 把整张图录进**一个** command encoder 并只提交一次，
帧内唯一的 fence 是末尾那次 `onSubmittedWorkDone()`——它同时是 governor 的测量点。逐 pass
同步会把 22 层变成每帧 22 次 CPU↔GPU 往返，因此
`packages/postprocess/tests/model-graph.test.ts` 用回归测试锁定「一次 encoder、一次 submit、
一次 fence」这个不变量。改用 `timestamp-query` 时可以连这一次 fence 一起去掉。

## 依赖关系

Governor 是一个叶子——只依赖浏览器的 GPU API，不依赖 `core`、`strategy` 或 `renderers`。它由 `postprocess/chain.ts` 在运行时创建并注入：

```typescript
// chain.ts
const governor = createFrameBudgetGovernor(options)
governor.onTierChange((tier) => sdk.emit('quality-change', { tier }))
const chain = createAiPipeline({ interpolation, superResolution, governor })

// 呈现循环中
presentationLoop() {
  const t = audioClock.time()
  const frame = await chain.frameAt(t, currentEpoch)  // governor 在此测量
  governor.record(frame.computeTime, budgetMs)
  renderer.render(frame)
}
```
