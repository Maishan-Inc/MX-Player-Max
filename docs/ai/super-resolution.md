# 超分辨率（Super-Resolution）

采用 **RT4KSR** 为主、**Anime4K-WebGPU** 为低档的混合策略。

## RT4KSR：主力架构

**来源**：CVPR 2023 NTIRE Real-Time 4K Super-Resolution Challenge 基线方法  
**目标**：720p/1080p → 4K 实时超分

### 关键设计

1. **结构重参数化（Structural Re-parameterization）**
   - 训练时：`expand 1×1 → fea 3×3 → reduce 1×1`，带内部 identity 与块级残差
   - 推理时：可折叠为单一 3×3 卷积
   - **本仓库使用的是未折叠的训练架构**（`rt4ksr_x2.pth` 即 `--is-train` 变体），因此
     GPU 图逐个执行这三个卷积，`fea_conv` 的 1px 边框按 `expand_conv` 的 per-channel
     bias 填充（上游 `pad_tensor` 的做法，不是零填充也不是边缘复制）

2. **Pixel Unshuffle**
   - 下采样特征图、增加通道数，降低空间分辨率下的计算量
   - 高频细节提取在低分辨率完成，减少深层特征图的宽高
   - 通道序为 `torch.nn.PixelUnshuffle` 的 `c * r² + i * r + j`

3. **NAFNet 简化块**
   - `LayerNorm2d → ResBlock → GELU`；`rt4ksr_rep()` 传入 `layernorm=True`、
     `residual=False`、`eca_gamma=0`，所以有归一化层、没有通道注意力、没有块级残差
   - 高频分支（gaussian blur + `hfb` + `gamma`）因 `forget=False` 在推理时不可达，
     GPU 图不包含它

### 为何选它

- 明确针对 1080p → 4K 实时场景设计
- 结构固定、算子少（卷积、LayerNorm、GELU、pixel shuffle），手写 WGSL 可覆盖
- 论文公开、可复现、基准性能已知；上游 forward 可作为逐层数值 oracle，见
  `docs/development/webgpu-harness.md`

### 排除的方案

**Real-ESRGAN**：质量最佳，但比 Anime4K 慢约 **1000 倍**——完全不适合实时。仅在离线转码场景有意义。

## Anime4K-WebGPU：动画内容优化

**来源**：[Anime4KWebBoost/Anime4K-WebGPU](https://github.com/Anime4KWebBoost/Anime4K-WebGPU)  
**目标**：动画、卡通内容的实时放大与去噪

### 特性

- 纯 WGSL compute shader，无 WASM 运行时
- 五档网络规模：S / M / L / VL / UL，每档计算量约翻倍
- 直接映射到 `AiQualityTier`
- 针对线条清晰、色块平坦的二维动画优化（对实拍效果较弱）

### 技术要求

- WebGPU 特性：`float32-filterable`（Anime4K 需对 f32 纹理做线性采样）
- 不支持该特性时回退到 RT4KSR

### 许可证审查

**Anime4K-WebGPU 是有意破例**（违反「不引入依赖」原则）：
- 审查面小：纯 WGSL 源码，无二进制 blob
- 若许可证审查不通过，直接弃用，低档改用 RT4KSR 小尺寸

## 档位与网络规模映射

```typescript
export type AiQualityTier = 'off' | 'low' | 'medium' | 'high' | 'ultra'
```

| Tier | RT4KSR | Anime4K | 典型硬件 | 1080p→4K 预算 |
|---|---|---|---|---|
| `off` | – | – | – | 0 ms |
| `low` | 小型（~20 层） | S | 集显 | ~12 ms |
| `medium` | 标准（~30 层） | M | 中端独显 | ~9 ms |
| `high` | 增强（~40 层） | L | 高端独显 | ~6 ms |
| `ultra` | 完整（~50 层） | VL/UL | 旗舰显卡 | ~4 ms |

实际数字需在真实硬件基准后校准。Amazon IVS 实测 CNN 超分约 8–9ms/帧（网络规模未知）。

## 实现策略

### 手写 WGSL Compute Shader

每个卷积层一个 compute pass：

```wgsl
@group(0) @binding(0) var input: texture_2d<f32>;
@group(0) @binding(1) var output: texture_storage_2d<rgba16float, write>;
@group(0) @binding(2) var<storage> weights: array<f32>;
@group(0) @binding(3) var<storage> bias: array<f32>;

@compute @workgroup_size(8, 8)
fn conv3x3(gid: vec3<u32>) {
  // 手写 3×3 卷积 + ReLU
  // weights 离线转换自训练好的模型
}
```

优化：
- 共享内存 tile：减少纹理采样
- `shader-f16` 可用时用半精度（带宽减半）
- 预分配输出纹理池，按 epoch 复用

### 零拷贝管线

```text
插帧输出（GPU texture, 1080p RGB）
    ↓ 直接传入
超分 compute pass 链（无 CPU 回读）
    ↓ 直接传入
渲染器（copyTextureToTexture 到 canvas）
```

**CPU 永远看不到像素数据。** `PipelineFrame` 的 `location: 'gpu'` 路径保证零拷贝。

### 权重转换工具

离线工具（不在仓库中，阶段 7 时建立）：

```bash
python convert_weights.py \
  --model rt4ksr-x2.pth \
  --output weights-rt4ksr-x2-f32.bin \
  --precision f32
```

生成二进制 blob：
- 紧密打包的 float32 数组（或 float16）
- 按层顺序排列：conv1_weight, conv1_bias, conv2_weight, ...
- SHA-256 校验和记录在 manifest

**数值等价性验证**：与参考实现（PyTorch）逐层对比输出，误差 < 1e-5。

## 色彩空间

模型基于 **RGB** 训练。阶段 6 的 WebGPU 渲染器负责 YUV → RGB 转换，超分阶段接收的是 linear RGB（或 sRGB，视渲染器输出）。

喂 YUV 平面会产生色边——这是常见错误。

## 与插帧的关系

**超分必须在插帧之后**：

1. 插帧在源分辨率更准确（1080p 光流 vs. 4K 光流）
2. 插帧在源分辨率更便宜（像素数 1/4）
3. 超分放大已插值后的帧

在 4K 下同时启用插帧与超分，成本是**相乘而非相加**：

- 24fps 源 + 超分：超分每秒跑 24 次
- 24→60fps 插帧 + 超分：超分每秒跑 **60 次**
- 60 × 9ms = 540ms GPU 工作量 / 秒视频

**默认配置在 4K 下不得同时启用两者。** governor 必须检测并降级。见 [feasibility.md](feasibility.md)。

## 降级策略

Governor 超预算时的动作顺序：

1. **首先关闭插帧**（保留超分）
   - 理由：画面锐利但卡顿远比柔和但流畅更糟
   - 24fps 锐利 4K > 60fps 模糊 1080p（对多数用户）

2. 降低超分档位（ultra → high → medium → low）

3. **最后关闭超分**（回到原始分辨率）

每次档位变化必须作为 SDK 事件上报给用户（`subtitle-pipeline.md:25` 先例）。
