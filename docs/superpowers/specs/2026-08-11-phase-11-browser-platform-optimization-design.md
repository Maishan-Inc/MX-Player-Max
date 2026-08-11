# Phase 11: Browser Platform Optimization Design

状态：由 `docs/development/execution-plan.md` 与
`docs/architecture/browser-strategy.md` 的既有阶段定义批准；实现完成。

## 1. 目标与范围

Phase 11 在通用能力探测和候选生成正确之后加入可插拔平台增强。交付内容包括：

- Chromium 的 WebGPU external texture 与 Worker MediaSource 信号。
- WebKit 的原生 HLS、HEVC、HDR display、ManagedMediaSource、AirPlay 和 PiP 信号。
- Gecko/通用媒体元素的 `fastSeek()`、标准播放质量和 Firefox 私有帧统计诊断。
- WebCodecs 硬件偏好与实际选择结果的显式记录边界。
- 带版本范围、Issue、失效日期和回归样本的负向评分规则。

本阶段不实现 HLS/DASH/MSE 管线，不把 AirPlay/PiP 变成解码候选，不从浏览器名称或
`powerEfficient` 猜测 Codec 支持，也不替代后端初始化失败后的原子回退。

## 2. 架构边界

```text
CapabilitySnapshot + runtime API signals
                   ↓
       PlatformEnhancements
                   ↓
existing BackendCandidate[] + audited issue rules
                   ↓
      PlatformScoreAdjustment[]
                   ↓
             StrategyEngine
```

`PlatformRuntimeAdapter` 隔离 DOM/API 读取；`detectPlatformEnhancements()` 只生成布尔信号；
`PlatformPolicy` 只对输入候选返回 adjustment；`PlatformDiagnostics` 只保存统计与显式观测。
`platform` 继续只依赖 `@mx-player-max/types`，不依赖 Core、Decoder、Renderer 或 Demo。

## 3. 增强信号与评分

增强快照区分 Codec、显示和 UI 能力：

- `nativeHls`/`nativeHevc` 来自固定 `canPlayType()` 查询。
- `hdrDisplay` 来自 `(dynamic-range: high)`，不代表当前 Codec 可解码。
- `workerMediaSource` 与 `webGpuExternalTexture` 来自 Phase 1 能力快照。
- ManagedMediaSource、AirPlay、PiP、fastSeek 和帧统计来自实际运行时成员。

Chromium 仅在现有 WebCodecs + WebGPU 候选、配置级 WebCodecs 报告支持且 external texture
可用时加 5 分。WebKit 仅在现有 Native 候选和媒体级 Native 报告支持时加基础分，并对实际
匹配的 HEVC/HDR/HLS 信号追加小幅偏好。Gecko 只为高级逐帧意图下已经验证的 WebCodecs
候选加 5 分。可选 API 缺失或探测抛错统一变为 `false`，不能移除通用候选。

## 4. Issue 黑名单

每条规则包含：稳定 ID、浏览器、`minInclusive/maxExclusive` 版本范围、HTTPS Issue URL、
`YYYY-MM-DD` 失效日期、回归样本标识、负向 `scoreDelta` 和候选匹配器。规则只能匹配候选
kind/renderer/Codec 前缀/intent，不能声明 API 或 Codec 支持。

同一候选的平台提示和 Issue 惩罚必须先合并，再输出唯一 adjustment；这是因为策略层会拒绝
重复候选 adjustment，防止外部策略重复加分。非法、正向、版本无效或过期规则被忽略。

首条内建规则覆盖 Firefox 130-145 的 Bugzilla #1918769：H.264
`VideoDecoder.isConfigSupported()` 可能返回支持但 `configure()` 失败。规则只减 100 分，
不会把能力改成 unsupported；运行时 configure try/catch 与下一候选回退仍是最终防线。

## 5. 诊断

`PlatformDiagnostics.snapshot(video)` 读取标准 `getVideoPlaybackQuality()` 和可选 Gecko 私有计数。
无效、负数、NaN 或抛错值归一化为 `null`。Firefox 私有字段不会进入评分。

WebCodecs 记录器保存 `requestedPreference`、配置支持状态、`selected` 与原因。只有 decoder
adapter 明确观察到硬件/软件结果时才可写入对应值；标准 API 不暴露最终选择时必须记录
`unknown`，不能把 `isConfigSupported()` 或 `powerEfficient` 当作硬件确认。

## 6. 测试与验收

单元测试覆盖：全信号、全缺失、API 抛错、通用策略无 adjustment、候选不可创建、输入候选
不可变、版本边界、规则过期、非法规则、同候选 adjustment 合并、标准/Gecko 帧统计、显式
WebCodecs 选择记录与 reset。Firefox H.264 回归夹具位于
`packages/platform/tests/fixtures/firefox-h264.ts`。

阶段验收运行 `pnpm typecheck`、`pnpm test`、`pnpm build`、`pnpm test:browser` 和
`git diff --check`。Playwright WebKit 不能替代物理 macOS Safari；真实 latest-two-stable
Codec/平台矩阵继续作为 Phase 13 的环境验收门禁。

