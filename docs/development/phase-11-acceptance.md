# Phase 11 验收记录

日期：2026-08-11

## 实现状态

Phase 11 已交付 `@mx-player-max/platform` 的可插拔平台增强、诊断和版本 Issue 规则：

- `PlatformRuntimeAdapter` 与 `detectPlatformEnhancements()` 读取实际 API 信号；探测抛错或
  特性缺失统一降为 `false`，不影响通用候选。
- Chromium 增强记录 Worker MediaSource 与 WebGPU external texture；只有现有、媒体级
  WebCodecs 已验证的 WebGPU 候选才能获得 external-texture 小幅加分。
- WebKit 增强记录原生 HLS/HEVC、HDR display、ManagedMediaSource、AirPlay、PiP 和
  fastSeek；HEVC/HDR/HLS 偏好只作用于现有且媒体级 Native 报告支持的 HTMLVideo 候选。
- 标准 `getVideoPlaybackQuality()` 与 Gecko 私有帧计数分开记录；Firefox 私有字段只进入
  诊断，不参与后端评分。
- WebCodecs 加速观测显式保存请求偏好、支持状态和实际选择；标准 API 无法确认最终实现时
  保留 `unknown`，不从 `powerEfficient` 或 config supported 推断硬件解码。
- `PlatformIssueRule` 强制要求浏览器、半开版本范围、HTTPS Issue、失效日期、回归样本、
  负向分数和候选匹配。非法、正向、版本无效或过期规则不生效。
- 内建 Firefox Bugzilla #1918769 规则覆盖已验证的 Firefox 130-145 H.264 WebCodecs
  configure 风险并减 100 分；不改写能力状态，也不替代 decoder 初始化 try/catch/原子回退。
- 同一候选的平台提示和 Issue 惩罚合并为唯一 adjustment，避免策略层重复 adjustment 保护
  丢弃风险惩罚；输入候选保持不可变，空候选列表不会生成候选。

本阶段不实现 HLS/DASH/MSE 播放管线，不接入新的 Decoder/Renderer，不把平台名称映射到
后端，也不宣称真实浏览器 Codec、HDR、AirPlay、PiP 或硬解矩阵已通过。

## 自动化验证

| 命令 | 结果 |
|---|---|
| `pnpm --filter @mx-player-max/platform typecheck` | passed |
| `pnpm --filter @mx-player-max/platform test` | passed；12 tests |
| `pnpm typecheck` | passed；17 个工作区项目完成 build + strict typecheck |
| `pnpm test` | 当阶段 passed；当前数量由 `docs/development/evidence/current-test-counts.json` 自动生成并由 CI 校验 |
| `pnpm build` | passed；17 个工作区项目及 Demo production build |
| `pnpm test:browser` | passed；12 tests，Chromium desktop/mobile、Firefox、WebKit |
| `git diff --check` | passed |

本节原有全仓总数与分包数字会随后续 Phase 漂移，已停止手工维护。当前全仓总数、测试文件数
和逐包分布统一读取 `docs/development/evidence/current-test-counts.json`；`pnpm test` 会在测试通过后
比较该文件，数量变化必须通过 `pnpm test:update-counts` 显式更新并审查。

Platform 12 项测试覆盖：全增强信号、全特性缺失、无 DOM 默认适配器、通用路径、候选不可
创建/不可变、WebKit HEVC/HDR 已验证 Native 候选、Firefox #1918769 版本范围、版本上界、
规则过期、非法/正向规则、同候选 adjustment 合并、标准/Gecko 帧统计、WebCodecs 显式
加速观测和 reset。回归夹具位于
`packages/platform/tests/fixtures/firefox-h264.ts`。

Demo build 仍报告既有的单个 623.36 kB minified chunk 警告；构建成功，该警告不由 Phase 11
引入，也不影响平台包边界。

## 浏览器证据边界

| 环境 | 本次自动化 | 真实平台状态 |
|---|---|---|
| Playwright Chromium desktop/mobile | UI DOM/CSS/交互 6 tests passed | 最新两个稳定大版本 external texture、Worker MSE、Codec/硬解待真实验证 |
| Playwright Firefox | UI DOM/CSS/交互 3 tests passed | 最新两个稳定大版本 fastSeek、播放质量、#1918769 媒体复现待真实验证 |
| Playwright WebKit | UI DOM/CSS/交互 3 tests passed | 不替代 macOS Safari；HLS/HEVC/HDR/AirPlay/PiP/ManagedMediaSource 待物理环境验证 |

Playwright 项目名称中的 Firefox/WebKit 表示自动化浏览器引擎，不构成 latest-two-stable 或
物理 macOS Safari 证据。本次没有可用的 macOS Safari、AirPlay 设备、HDR display 或真实
Codec 媒体矩阵，因此上述项目保持待验证，不能写为 supported。

## 边界审计

- `@mx-player-max/platform` 的唯一生产依赖为 `@mx-player-max/types`；无跨包内部引用。
- 平台增强只读取快照/API，Issue 规则只返回现有 `candidateId` 的负向或合并 adjustment。
- `PlatformDiagnostics` 不依赖 Strategy/Core，也不会把 Gecko 私有计数反馈到评分。
- 仓库没有新增二进制、远程媒体、WASM、Worker、AudioWorklet 或 Demo 运行时依赖。
- 公共入口构建出 `dist/index.js` 与 `dist/index.d.ts`；严格可选字段和无 `any` 检查通过。

## 后续门禁

- 在 Chrome/Chromium、Firefox、macOS Safari 最新两个稳定大版本执行固定媒体样本探测，
  保存 UA 归一化结果、能力快照、媒体报告、增强快照、候选排序与初始化结果。
- 在 Firefox 130-145 可复现环境验证 #1918769 样本；扩大版本范围前必须复现，确认修复前
  不得删除 decoder configure try/catch。
- 在物理 macOS Safari 验证原生 HLS/HEVC/HDR、AirPlay、系统 PiP 和 ManagedMediaSource。
- 在可用 Chromium GPU/驱动组合验证 external texture 与 WebCodecs 实际拷贝路径；标准 API
  未提供硬件/软件最终选择时继续记录 `unknown`。
- 所有 Issue 规则必须在 `expiresOn` 前复核、续期或删除，并同步 ADR、回归样本和变更记录。
