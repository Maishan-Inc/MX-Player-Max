# MX-Player-Max 文档

## 公共 API

- `api/player-ui.md`：播放快照、Decision Trace、预览、UI 生命周期、选项、CSS 与 React/Vue 适配器。
- `../packages/decoder-wasm/README.md`：Phase 10 WASM Manager、插件契约、加载规则与稳定错误。
- `../packages/platform/README.md`：Phase 11 平台增强、诊断、版本 Issue 规则与评分边界。

## 架构

- `architecture/overview.md`：整体分层、生命周期和数据流。
- `architecture/browser-strategy.md`：Chrome/Firefox/Safari 的能力检测和专属优化。
- `architecture/media-fundamentals.md`：封装结构、编码代际、HDR/SDR、对象音频、蓝光原盘和 FFmpeg 边界的原理说明。
- `architecture/codec-strategy.md`：容器/后缀映射、四类解码路径、完整决策矩阵、HDR 与许可证边界。
- `architecture/playback-decision-flow.md`：从源到后端的完整决策流程、硬件解码与 GPU 渲染的区别、M3U8 专门决策、支持格式总表。
- `architecture/distribution-and-embedding.md`：SDK/UI、Browser ESM/IIFE、React/Vue 接入，CORS/Range、固定版本/SRI、HTTPS 与 COOP/COEP。
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
- `development/phase-10-acceptance.md`：Phase 10 WASM Manager、manifest、变体选择、哈希/缓存和发布边界。
- `development/phase-11-acceptance.md`：Phase 11 浏览器增强、诊断、Issue 规则和平台回归边界。
- `development/release.md`：本地构建、Docker smoke、CI/Release 门禁和未执行的真实发布边界。
- `development/phase-12-acceptance.md`：Phase 12 命令证据、包清单、Manifest/SRI 和 pending 项。

## 决策记录

- `decisions/ADR-0001-dual-render-path.md`
- `decisions/ADR-0002-single-sdk-wasm-variants.md`
- `decisions/ADR-0003-ai-post-processing.md`
- `decisions/ADR-0004-engine-and-optional-ui.md`：引擎与可选 UI 包分离，及其对 UMD 产物的约束。
- `decisions/ADR-0005-platform-policy-and-issue-rules.md`：平台增强、诊断与可过期负向评分规则。
- `decisions/ADR-0006-demo-and-player-visual-alignment.md`：演示站视觉对齐 MX-Player-Pro 落地页结构，播放器 chrome 对齐 MXAnime-CMS 内置 MX-Player。
