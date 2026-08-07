# AI 后处理：架构概览

## 核心设计：拉取式帧源

**`VideoRenderer.render(frame: VideoFrame)` 接口不变。** 变的是调用方——呈现循环从后处理链拉取帧，而非直接从解码队列拉取。

### 为何不用 push 式滤镜

AGENTS.md §6 规定：音频时钟为主时钟，渲染器按时钟决定显示/等待/丢帧。若插帧做成 push 式滤镜，它必须**自行发明呈现时间表**，与呈现循环里已有的时钟逻辑重复，并在每次漂移修正时与时钟冲突。

插帧是 2-进-N-出，会**改写呈现时间轴**：24fps 源生成 60fps 输出。让滤镜拥有时间轴权威违反单一时钟规则。

### 拉取式语义

```typescript
interface FrameSource {
  frameAt(t: Micros, epoch: number): Promise<PipelineFrame | null>
  readonly lookaheadFrames: number
  reset(epoch: number): void
  close(): void
}
```

时钟说「现在是 t 微秒」，帧源回答「这是你该显示的帧」：
- 插帧器合成 t 两侧帧之间相位为 `(t - tA) / (tB - tA)` 的画面
- 超分放大该帧
- passthrough 返回最近的原始帧

**同一接口，可变输出帧率免费**：24fps 在 60Hz 显示器下就是 60 次非均匀相位的 `frameAt()` 调用，不是固定 2x/3x 倍数。

## 管线顺序

```text
Decoder → VideoFrame (YUV 1920x1080)
  ↓
[1] 色彩转换 YUV → linear RGB    (阶段6 渲染器负责)
  ↓
[2] 插帧   2进1出 @ phase p       (postprocess, 时域)
  ↓
[3] 超分   1080p → 4K             (postprocess, 空域)
  ↓
[4] 滤镜                          (阶段6 滤镜接口)
  ↓
[5] 渲染器 present → canvas
  ↓
[6] 字幕覆盖层（不被放大）
```

### 关键排序理由

**插帧必须在超分之前**：
- 性能：在 1080p 上做光流比在 4K 上便宜约 4 倍（像素数是 1/4）
- 准确性：超分会幻觉出高频细节，污染光流匹配。运动估计在源分辨率更准确。

**超分在字幕之前**：
- 已天然满足。`docs/architecture/subtitle-pipeline.md:21` 已把字幕覆盖层置于渲染器**之上**作为独立 DOM 层。
- 只要永远不把字幕移入帧管线，字幕就不会被 AI 放大（保持清晰锐利）。

**色彩转换在 AI 之前**：
- 模型基于 RGB 训练。喂 YUV 平面会产生色边。
- 这已是阶段 6 WebGPU 渲染器的职责，AI 阶段接收的是 RGB。

## 与双路径的关系

### NativeMediaPipeline（HTMLVideo 原生）

首阶段 **AI 不可用**。理由：

1. `docs/architecture/audio-pipeline.md:39` 明令禁止「原生 HTMLVideo 音频 + 自定义视频」。
2. 经 `requestVideoFrameCallback` + `importExternalTexture` 引入帧会造成上述配置。
3. 插帧改写呈现时间轴，使该规则要防的漂移从偶发变为结构性。
4. 代价：HDR 元数据丢失、DRM 硬阻断、绕过零拷贝 overlay 导致显著功耗回退。

需先有独立 ADR 设计「明确的外部时钟桥接」后才能重启。见 ADR-0003。

### CustomMediaPipeline（WebCodecs/WASM → VideoFrame）

**AI 的唯一适用路径。** 解码器把帧放入队列，后处理链从队列拉取并变换，渲染器消费变换后的帧。

```text
WebCodecs Decoder → Frame Queue
                         ↓
              DecodedFrameSource (peek, 非消费)
                         ↓
              PostProcessChain.frameAt(t, epoch)
                         ↓
                 PipelineFrame (GPU)
                         ↓
              WebGPU Renderer.render()
```

**WebCodecs 是首选目标**：硬件解码省出的 CPU/GPU 预算正是 AI 需要的。WASM 软解已吃满 CPU，叠加 AI 是最糟组合（技术可行但不作为优化目标）。

## 帧的生命周期

```typescript
export type PipelineFrame =
  | { readonly location: 'cpu'; readonly frame: VideoFrame; readonly timestamp: Micros }
  | {
      readonly location: 'gpu'
      readonly texture: GPUTexture
      readonly width: number
      readonly height: number
      readonly timestamp: Micros
      readonly release: () => void   // 调用方必须且只能调用一次
    }
```

- **GPU 帧零拷贝**：插帧与超分之间传 GPU 纹理，不走 CPU。
- **纹理池复用**：每个 stage 预分配固定数量 `GPUTexture`，按 epoch 回收复用，绝不逐帧分配（最大卡顿源）。
- **release 契约**：调用方收到 GPU 帧后必须且只能调用一次 `release()`，归还纹理到池中。

## 接口边界

`packages/postprocess/` 是叶子包：
- 依赖：仅 `@mx-player-max/types`
- 不得依赖：`renderers`、`core`、`strategy`
- 由 `core` 组合，绝不感知解码后端（对齐 AGENTS.md §3「renderer 只消费帧」）

**关键：** AI 后处理层与渲染器一样，只消费帧、不知道文件格式和解码器细节。把 AI 绑定到 WASM 分支违反模块边界。
