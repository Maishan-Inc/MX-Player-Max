# 分阶段开发流程

本文件是阶段计划的概览。每阶段的任务、测试和退出条件见 `execution-plan.md`，那份文件是阶段编号的唯一权威。

## 阶段 0：规范与脚手架

交付 Monorepo、包边界、公共类型、CI 基础、Docker 演示站、文档和许可证清单模板。验收：所有包能被发现，根目录类型检查和空测试命令可执行。

## 阶段 1：公共类型与能力探测

实现 `SourceDescriptor`、`TrackInfo`、`MediaDescriptor`、`CapabilitySnapshot`、`BackendCandidate`、错误码和事件契约。实现浏览器/设备/渲染器/WASM 探测与缓存。验收：三浏览器返回结构一致的快照。

## 阶段 2：Range Loader 与容器抽象

实现本地文件读取、远程 CORS/Range、取消、重试、缓存和最小探测。实现 Container Adapter 接口，先接入 Matroska，随后 MP4/WebM。验收：能读取轨道、Codec 配置、duration、关键帧和字幕包。

## 阶段 3：NativeMediaPipeline

实现普通播放、原生进度、seek、音量、倍速、全屏、HDR 保留、错误转换和基础字幕覆盖。验收：常见 MP4/WebM 在 Chrome、Firefox、Safari 正常播放。

## 阶段 4：WebCodecs CustomMediaPipeline

实现视频 Decoder Adapter、Packet Buffer、Frame Queue 和 seek epoch。优先接入 H.264/VP8/VP9/AV1。验收：能逐帧输出 `VideoFrame`，连续 seek 不产生旧 epoch 画面。

## 阶段 5：音频时钟与 AudioWorklet

实现 `AudioDecoder` Adapter、PCM 标准化、AudioWorklet Processor 和有界 ring buffer，以 AudioContext 时钟驱动视频显示。验收：AAC/Opus/MP3 连续播放 30 分钟无明显漂移。

## 阶段 6：WebGPU/WebGL2/Canvas2D 渲染器

实现视频色彩、旋转、裁剪、滤镜接口、HDR 能力标记和渲染器降级。验收：WebGPU 不可用时仍可播放，滤镜功能明确降级。

## 阶段 7：AI 后处理（插帧与超分）

在阶段 6 的渲染器和滤镜接口之上实现 AI 帧变换层。**与 WASM 解码器无关**——AI 消费已解码的 `VideoFrame`，与解码后端正交。

采用拉取式帧源：呈现循环按音频时钟从后处理链拉取帧，而非推送式滤镜。管线顺序为 色彩转换 → 插帧 → 超分 → 滤镜 → 渲染 → 字幕覆盖。

分期交付：契约层（类型、能力探测、策略打分、passthrough 骨架，已随阶段 0/1 落地）→ 超分 WGSL → 运行时 governor → 插帧 WGSL → 跨浏览器加固。**模型许可证与专利审查必须在契约层阶段完成**，不得推迟。

需要把阶段 10 的 manifest schema、加载器和哈希校验提前到本阶段（发布渠道仍留在阶段 12）。

验收：WebGPU 不可用或为 fallback adapter 时干净回退到 passthrough；档位变化作为 SDK 事件上报；AI 失败必须降级为正常播放而非中断。详见 `docs/ai/`。

## 阶段 8：SRT/ASS 字幕内核

实现 SRT、ASS/SSA 解析器，接入内嵌与外挂字幕，定义轨道枚举与样式数据模型，字幕覆盖层同时适配原生和自定义渲染路径。菜单与编辑器 UI 属阶段 9。验收：字幕由媒体时钟驱动，seek 后立即显示正确 cue，输入不执行 HTML 或脚本。

## 阶段 9：UI 包

建立 `packages/ui`，用框架无关的原生 DOM 实现控制条、进度预览、字幕菜单与样式编辑器、设置/统计/关于浮层和主题变量。外观参考 MX-Player-Pro 的交互模式，不复制其源文件与演示站视觉。验收：同一套 UI 在 `<video>` 与 `<canvas>` 两条路径下行为一致，引擎不反向依赖 UI。详见 `ADR-0004`。

## 阶段 10：WASM Decoder Manager

建立 Codec 插件注册、单线程/SIMD/多线程选择、WASM 哈希校验、懒加载、缓存和失败回退。先接入 libvpx、dav1d、libde265、OpenH264，再接入 VVdeC 和 FFmpeg 兜底。

当前状态：10.2 已完成 restricted libvpx VP8 8-bit I420 单 Codec 垂直切片，包括真实 WASM、
MXWF 帧 ABI、共享 Worker、Core Custom Pipeline、WebCodecs 原子回退和 Chromium/Firefox
真实样本渲染。只有显式 `wasmBaseUrl` 才启用；Browser release manifest 明确排除三个变体。
10.3 其余视频 Codec、10.4 WASM 音频、10.5 FFmpeg 与独立许可/专利发布审查继续 pending。

## 阶段 11：浏览器平台优化

实现 Chromium/WebKit/Gecko 可插拔优化和 Issue 黑名单。平台策略只能改变候选评分，不得创建不存在的能力。

当前状态：增强快照、可注入运行时探测、标准/Gecko 播放诊断、显式 WebCodecs 加速观测、
版本/Issue/失效日期/回归样本约束和 Firefox #1918769 负向评分规则已完成。真实 latest-two-stable
Chrome/Firefox/macOS Safari Codec 与系统能力验证继续作为环境门禁。

## 阶段 12：SDK、演示站与发布

当前状态：自动化发布就绪已完成。Browser ESM/IIFE、公开 API 诊断工作台、统一发布元数据、Manifest/SHA/SRI、17 包 pack/consumer smoke、Docker 配置与 CI/Release 门禁均已交付。真实 Docker、latest-two-stable/物理 Safari、Codec/WASM 二进制审查和 npm/CDN 发布仍是明确的后续环境门禁；Phase 12 不重复实现控制逻辑。

## 阶段 13：质量、安全与性能固化

当前状态：已完成 7 媒体 + 2 字幕的确定性样本矩阵、Native/WebCodecs 真实媒体 Playwright、
postprocess 数值/资源/epoch 固化、明确 Range/Worker/Audio/GPU 错误、隔离/非隔离性能 smoke、AI/WASM
供应链审计、CSP 与 Docker 双模式静态合同，以及当前 511 tests / 93 test files 的自动计数漂移门禁。

最终发布仍 pending：Chrome/Firefox latest-two-stable 和物理 macOS Safari 未执行；本地 30 分钟
automation 已运行但启动、缓冲和帧丢失阈值未通过，独立音画漂移/CPU/功耗仍不可观测；本机无 Docker CLI，
Phase 10.2 WASM 独立审批未通过。不得用 Playwright、
fake runtime 或短 smoke 填充这些行。完成后才进入 HLS/DASH、PGS/VobSub、移动端和 DRM 子项目。
