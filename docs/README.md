# MX-Player-Max 文档

## 公共 API

- `api/player-ui.md`：Phase 9 播放快照、预览、UI 生命周期、选项、CSS 与 React/Vue 适配器。

## 架构

- `architecture/overview.md`：整体分层、生命周期和数据流。
- `architecture/browser-strategy.md`：Chrome/Firefox/Safari 的能力检测和专属优化。
- `architecture/media-fundamentals.md`：封装结构、编码代际、HDR/SDR、对象音频、蓝光原盘和 FFmpeg 边界的原理说明。
- `architecture/codec-strategy.md`：容器/后缀映射、四类解码路径、完整决策矩阵、HDR 与许可证边界。
- `architecture/playback-decision-flow.md`：从源到后端的完整决策流程、硬件解码与 GPU 渲染的区别、M3U8 专门决策、支持格式总表。
- `architecture/distribution-and-embedding.md`：三种接入方式、CORS 三条链路、HTTPS 与安全上下文限制、COEP 连锁反应、分发渠道与落地优先级。
- `architecture/audio-pipeline.md`：音频解码、AudioWorklet 和音画同步。
- `architecture/subtitle-pipeline.md`：SRT/ASS 字幕、轨道、样式和外挂字幕。
- `architecture/ui-package.md`：可选 UI 包的组件结构、CSS 契约、主题变量、双路径适配与无障碍要求。
- `architecture/wasm-and-distribution.md`：WASM 变体、懒加载、缓存、npm/CDN 和 Docker。

## AI 后处理

- `ai/README.md`：AI 功能索引与前置声明。
- `ai/technology-landscape.md`：为什么不能照搬 DLSS/FSR、RIFE/RT4KSR/Anime4K 选型、RTX VSR 关系、WebGPU 与 WebNN 平台矩阵。
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
- `development/phase-1-acceptance.md`：Phase 1 自动化结果、浏览器矩阵和剩余验收项。
- `development/phase-8-acceptance.md`：Phase 8 字幕内核自动化与真实浏览器待验证项。
- `development/phase-9-acceptance.md`：Phase 9 UI、适配器、Demo、截图、发布边界和真实浏览器矩阵。

## 决策记录

- `decisions/ADR-0001-dual-render-path.md`
- `decisions/ADR-0002-single-sdk-wasm-variants.md`
- `decisions/ADR-0003-ai-post-processing.md`
- `decisions/ADR-0004-engine-and-optional-ui.md`：引擎与可选 UI 包分离，及其对 UMD 产物的约束。
