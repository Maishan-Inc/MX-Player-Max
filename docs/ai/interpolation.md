# 帧插值（Frame Interpolation）

采用 **RIFE**（Real-Time Intermediate Flow Estimation）架构，支持任意时间步插值。

## 核心特性

### 任意时间步合成

```typescript
interface TemporalStage {
  synthesize(a: PipelineFrame, b: PipelineFrame, phase: number, epoch: number): Promise<PipelineFrame>
}
```

- `phase = 0` → 返回 A
- `phase = 1` → 返回 B  
- `phase = 0.5` → 合成中点
- `phase = 0.333` → A 后 1/3 位置（24fps → 72fps 时的第二帧）

这正是拉取式帧源所需：给定时钟时刻 `t`，计算 `phase = (t - tA) / (tB - tA)`，合成该相位的帧。固定倍率架构（只能 2x）无法满足。

## 前瞻（Lookahead）与启动延迟

插帧器需要**两帧才能合成中间帧**：

```text
解码队列：[A] [B] [C] [D] ...
               ↑
          插帧器持有 A，等待 B 到达后才能合成 t ∈ [tA, tB) 的帧
```

`lookaheadFrames = 1` 表示需提前 1 帧。在 24fps 下：
- 帧间隔 = 1000ms / 24 ≈ 41.7ms
- 启动延迟 = 41.7ms（等待第二帧解码完成）

**这是启动延迟，不是逐帧停顿。** 呈现循环在 `queue.depth > source.lookaheadFrames` 后启动，之后以满速运行。

**不要用「先播未插帧画面」掩盖延迟**——那会造成可见的节奏顿挫（前几帧 24fps，突然切到 60fps），比静默等 41.7ms 更糟。

## Epoch 与 Seek

### Epoch 的作用

每次 seek、轨道切换、解码器 reset 递增 `epoch`。所有异步 GPU 操作传入 epoch，完成时比对，不匹配则丢弃结果：

```typescript
async synthesize(a: PipelineFrame, b: PipelineFrame, phase: number, epoch: number): Promise<PipelineFrame> {
  const capturedEpoch = epoch
  const result = await gpuCompute(...)
  if (capturedEpoch !== this.currentEpoch) {
    result.release()  // 归还纹理到池
    return null       // 不触碰渲染器
  }
  return result
}
```

### Seek 后的处理

1. `core` 调用 `source.reset(newEpoch)`
2. 插帧器：
   - 递增 `this.currentEpoch = newEpoch`
   - 丢弃缓存的帧 A
   - 清空相位游标
   - **保留纹理池**（重新分配 GPU 纹理会造成多帧卡顿）
3. 下一次 `frameAt(t, newEpoch)` 请求到来：
   - 只有一帧 A，无前驱
   - **直接返回 A，不插帧**
   - 一帧不平滑无法察觉；为等第二次解码而停顿则明显

### 纹理生命周期

绝不 `destroy()` 仍在飞行的 `GPUTexture`：

```typescript
reset(epoch: number) {
  this.currentEpoch = epoch
  this.cachedFrameA = null
  // 纹理池保留，但标记当前 epoch
  // 仅在 GPU.queue.onSubmittedWorkDone() 结算后复用
}
```

## 流结束（End of Stream）

解码器报告 `endOfStream = true` 时，队列中只剩最后一帧 Z，无后继帧可合成。

`frameAt(t)` 的语义：
- `t > tZ` 且 `!endOfStream` → 返回 `null`（等待更多帧）
- `t > tZ` 且 `endOfStream` → 返回 **帧 Z**（hold 最后一帧）

返回 `null` 会让呈现循环误判为饥饿而空转。用 `endOfStream` 消歧：
- `null` + `!endOfStream` = 缓冲区饥饿，等待
- `null` + `endOfStream` = 播放结束，停止

最后一帧不插值直接输出——与 seek 后首帧逻辑一致。

## DecodedFrameSource 接口

```typescript
export interface DecodedFrameSource {
  peekAt(t: Micros): PipelineFrame | null
  peekNext(timestamp: Micros): PipelineFrame | null
  readonly endOfStream: boolean
  readonly epoch: number
}
```

**`peek` 是非消费式的**。插帧器需要：

1. 在 t₀ 时刻，读取帧 A（`peekAt(t₀)`）
2. 等待帧 B 到达（`peekNext(tA)`）
3. 在 t₀ 到 t₁ 之间的多个相位重复使用 A 和 B
4. t 越过 tB 后，A 作废，B 成为新的 A

若用消费式 `dequeue()`，插帧器必须自己管理帧的生命周期，职责错位——生命周期属于队列。

## RIFE 实现策略

### 手写 WGSL，不用 ONNX Runtime Web

理由见 ADR-0003。关键点：

- ORT Web 直到 v1.26.0 才在 WebGPU 上支持 `GridSample`（RIFE 最关键的算子）
- 自己写反向 warp 约 60 行 WGSL（对流场做双线性采样）
- Chrome 扩展已验证纯手写 WGSL 可达 3–4ms/帧

### 网络结构

RIFE v4.x 包含：
1. **特征提取器**：轻量 CNN 提取 A 和 B 的多尺度特征
2. **光流估计器**：从粗到细预测双向光流
3. **融合网络**：根据光流 warp A 和 B，按 phase 加权融合

关键操作：
- **GridSample / Warp**：给定流场 `flow(x,y)` 和图像 A，采样 `A[x + flow_x, y + flow_y]`（双线性插值）
- **Phase 调制**：fusion 网络的输入包含 `phase` 作为额外通道

### 权重来源

- 上游：[hzwer/Practical-RIFE](https://github.com/hzwer/Practical-RIFE)
- 训练数据：Vimeo90K
- 许可证：**必须在契约层阶段审查**——部分发布版本为研究/非商用授权，AGENTS.md §5 禁止发布未审查二进制

## 性能预算

- 目标：1080p 下 < 4ms/帧（留给超分和渲染约 12ms）
- 实际：Chrome 扩展实现达到 3–4ms（硬件未知，乐观值）
- 降级：governor 超预算时**先关插帧再关超分**——画面锐利但卡顿远比柔和但流畅更糟

## 与超分的关系

**插帧必须在超分之前**：

1. **性能**：1080p 的光流比 4K 便宜约 4 倍（像素数 1/4）
2. **准确性**：超分幻觉出的高频细节会污染运动估计

插帧提升帧率，超分提升分辨率。在 4K 下同时启用两者，成本是**相乘**的：插帧到 60fps 意味着超分每秒跑 60 次而非 24 次。见 [feasibility.md](feasibility.md)。
