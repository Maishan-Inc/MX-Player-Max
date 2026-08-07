# AI 后处理：插帧与超分辨率

本目录记录 MX-Player-Max 的 AI 增强特性设计与实现指南。

## 关键前提

**AI 后处理不属于任何解码后端分支。** 它位于解码之后、渲染之前，与 WebCodecs、WASM、HTMLVideo 解码器完全正交。

```text
                   解码器（生产帧）
                         ↓
            WebCodecs / WASM / HTMLVideo
                         ↓
                    VideoFrame
                         ↓
              AI 后处理（变换帧）← 你在这里
                         ↓
            插帧 → 超分 → 滤镜
                         ↓
                    渲染器
```

**技术事实**：
- WebCodecs → VideoFrame 是 AI 的**首选目标**——硬件解码把 CPU/GPU 预算留给神经网络。
- WASM → VideoFrame 技术可行但性能最差——软解已吃满 CPU，叠加 AI 是最糟组合。
- HTMLVideo 原生路径首阶段明确不支持——需先设计「外部时钟桥接」才能重启（见 ADR-0003）。

**文档索引**：

| 文件 | 内容 |
|---|---|
| [overview.md](overview.md) | 拉取式帧源架构、管线顺序、与双路径关系 |
| [interpolation.md](interpolation.md) | RIFE 插帧；前瞻、epoch、seek、EOS |
| [super-resolution.md](super-resolution.md) | RT4KSR + Anime4K；档位与网络规模 |
| [runtime-and-budget.md](runtime-and-budget.md) | 能力探测 / 策略 / governor 三方职责 |
| [assets-and-licensing.md](assets-and-licensing.md) | 模型分发与许可证审查清单 |
| [feasibility.md](feasibility.md) | 性能预算与诚实的负面结论 |
| [../decisions/ADR-0003-ai-post-processing.md](../decisions/ADR-0003-ai-post-processing.md) | 架构决策记录 |

## 当前阶段

本特性处于**契约层**阶段：类型、接口、探测器已落地，postprocess 包存在但仅含 passthrough 骨架。

WGSL 实现与模型权重属阶段 5.5，依赖阶段 4（帧队列 + 音频时钟）与阶段 5（WebGPU 渲染器）完成后才能启动。
