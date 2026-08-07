# MX-Player-Max 文档

## 架构

- `architecture/overview.md`：整体分层、生命周期和数据流。
- `architecture/browser-strategy.md`：Chrome/Firefox/Safari 的能力检测和专属优化。
- `architecture/media-fundamentals.md`：封装结构、编码代际、HDR/SDR、对象音频、蓝光原盘和 FFmpeg 边界的原理说明。
- `architecture/codec-strategy.md`：容器/后缀映射、四类解码路径、完整决策矩阵、HDR 与许可证边界。
- `architecture/playback-decision-flow.md`：从源到后端的完整决策流程、硬件解码与 GPU 渲染的区别、M3U8 专门决策、支持格式总表。
- `architecture/audio-pipeline.md`：音频解码、AudioWorklet 和音画同步。
- `architecture/subtitle-pipeline.md`：SRT/ASS 字幕、轨道、样式和外挂字幕。
- `architecture/wasm-and-distribution.md`：WASM 变体、懒加载、缓存、npm/CDN 和 Docker。

## AI 后处理

- `ai/README.md`：AI 功能索引与前置声明。
- `ai/overview.md`：拉取式帧源架构、管线顺序、与双路径和解码后端的关系。
- `ai/interpolation.md`：RIFE 架构、前瞻、epoch、seek、EOS、性能预算。
- `ai/super-resolution.md`：RT4KSR + Anime4K-WebGPU、档位映射、零拷贝管线。
- `ai/runtime-and-budget.md`：capabilities/strategy/governor 三方职责与降级策略。
- `ai/assets-and-licensing.md`：模型分发 manifest、许可证审查清单。
- `ai/feasibility.md`：诚实性能预算与风险。

## 开发

- `development/roadmap.md`：从脚手架到生产发布的阶段计划。
- `development/execution-plan.md`：每个阶段的任务、测试、退出条件和 Git 工作方式。
- `development/testing.md`：单元、浏览器、媒体样本和性能测试方案。

## 决策记录

- `decisions/ADR-0001-dual-render-path.md`
- `decisions/ADR-0002-single-sdk-wasm-variants.md`
<<<<<<< HEAD
- `decisions/ADR-0003-ai-post-processing.md`

=======
>>>>>>> 17821f034782a402b0354fd55dcf71809634232e
