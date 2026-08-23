# 渲染模式切换 + Matroska + 失败归因 验收记录

日期：2026-08-23

对应计划：[`docs/superpowers/plans/2026-08-23-render-mode-switch-and-mkv-ai-plan.md`](../superpowers/plans/2026-08-23-render-mode-switch-and-mkv-ai-plan.md)

范围：该计划的 A 组（A1、A1b、A2、A3、A4、A5）。B 组（AI 开关端到端、性能证据、真实浏览器矩阵）
仍为 **pending**，原因见文末环境事实——本机只有软件 WebGPU 适配器。

逐包测试数以生成证据
[`evidence/current-test-counts.json`](evidence/current-test-counts.json) 为准，不在本文件手工维护。
`pnpm test` 会重新执行全部 workspace 测试并与该文件比对，数量变化需显式 `pnpm test:update-counts`
并审查 diff。

## 自动化结果

| 命令 | 结果 |
|---|---|
| `pnpm build` | passed；20 个 workspace package/app 完整构建 |
| `pnpm test` | passed；总数见 `evidence/current-test-counts.json`，与生成计数一致 |
| `pnpm test:update-counts` | 已重新生成 `evidence/current-test-counts.json` |
| `pnpm quality:acceptance-drift` | passed |
| `pnpm quality:media` | passed；10 个媒体 + 2 个字幕 fixture，SHA-256 与字节数一致（新增 3 条 Matroska） |
| `pnpm exec playwright test --project=media-chromium --project=media-firefox` | passed；32/32，含 5 条新增 Matroska/VP9 用例 |
| `pnpm exec playwright test --project=chromium-desktop` | passed；6/6 |
| `pnpm release:manifest` | passed；新增 audio-worklet 自包含断言，回填坏文件时会中断发布 |
| `pnpm verify:packages` | passed；19 个公开包 |
| `pnpm test:release` | passed；28/28 |
| `pnpm test:quality` | passed；9/9 |

## 各项交付与其护栏

| 项 | 交付 | 回归护栏 |
|---|---|---|
| A1 | AudioWorklet 改为自包含单文件 | `packages/audio/tests/shared-header-layout.test.ts` 比对常量并禁止运行时 import；`generate-manifest.mjs` 对 `type: "audio-worklet"` 资源同样断言；`webcodecs-audio` 验收模式跑构建产物 |
| A1b | 音频传输放不下的 PCM 改为挂起而非致命溢出，并在选用 MessagePort 传输时播种处理器 epoch | `webcodecs-audio` 断言 `audioRenderedFrames > 0`；`packages/core/tests/custom-backpressure.test.ts` |
| A2 | 设置面板「渲染模式」三档 | `packages/ui/tests/player-ui-menu.test.ts` 5 条：三档渲染、回调、外部同步、两种不渲染路径、本地化 |
| A3 | Demo 宿主接线 + AI 模型根目录 | `apps/demo/src/render-mode.test.ts` 4 条纯映射用例；`deployment.test.ts` 覆盖 Pages 下不给模型根目录 |
| A4 | 两条 Matroska 夹具与三个验收模式 | 4 条浏览器用例（chromium + firefox）；`quality:media` 校验哈希；裸 `vp09` 拒绝被单独钉住 |
| A4 补 | 内嵌 `S_TEXT/ASS` 轨的容器级覆盖：夹具 `mkv-h264-baseline-8bit-aac-embedded-ass.mkv` + 验收模式 `mkv-embedded-subs` | `media-paths.spec.ts` 的 embedded-ASS 用例（断言选中的是 `embedded-<trackId>`、cue 落在 0.4–1.2 s）；`embedded.test.ts` 的 reduced-format 用例；`verify-media-manifest.mjs` 校验 `embeddedSubtitleTracks` 的引用与格式 |
| A5 | 失败归因（视频/音频编码、声道、容器、无路径） | `player-ui-menu.test.ts` 7 条，含陈旧轨迹忽略与状态文案回落 |

## 手工核对（构建产物 + preview）

| 场景 | 观察 |
|---|---|
| 设置面板切 WebGPU 档 | 启动器同步为 `frame-access`，反向亦同步；诊断面板渲染器 `webgpu` |
| 切 WebGL2 档 | 渲染器 `webgl2`，AI 两个开关灰显并给出渲染路径原因 |
| `/models/weights/rt4ksr/rt4ksr_x2.mxai` | 200，612953 字节；`/models/../package.json` 取不到仓库文件 |
| `flower.webm`（VP8 + Vorbis）切自定义档 | 状态文案指出音频编码不支持，报告含 `WEBCODECS_AUDIO_NOT_SUPPORTED`、`audioCodec: vorbis 2ch` |
| HEVC MP4 切自定义档 | 状态文案指出没有可用路径，报告含 `videoCodec: hvc1`、`candidates: none` |

## 已知限制与未完项

- **AI 两个开关在本机无法端到端验收。** WebGPU 只能拿到 `google/swiftshader`
  （`GPUAdapterInfo.isFallbackAdapter === true`），引擎据此一律报 `device-capability`。
  归入计划的 B 组，需换有真实 GPU 的机器。
- **Firefox 需要更长的操作预算。** 本机无 GPU，Firefox 走自定义管线比 Chromium 慢约 60%，
  脚本化验收会间歇性撞上引擎默认的 10 s worker/configure/flush/seek 预算，表现为
  `WEBCODECS_WORKER_FAILED` 或 `CUSTOM_SEEK_FAILED`。验收 harness 把该预算提到 30 s、
  `media-firefox` project 的用例超时提到 120 s 后，连续三轮 3/3 通过。这是计时问题，
  **不是解码缺陷**，也没有改动出厂默认值。
- **VP9 走不了自定义管线（A7）。** EBML 解复用把 VP9 轨道报成裸 `vp09`，WebCodecs 拒绝该字符串。
  语料里 VP9 样本已修正为仅 `native`。
- **策略层不知道引擎自身的编码范围（A8）。** 能力探测反映浏览器支持，`decoder-webcodecs` 的范围更窄，
  于是 Vorbis 这类会先被排进候选再硬失败。A5 让这个失败可读，但没有消除它。
- 真实浏览器矩阵 [`tests/browser/evidence/real-browser-matrix.json`](../../tests/browser/evidence/real-browser-matrix.json)
  仍全部 `pending`：本工作区没有物理 latest-two-stable 浏览器，Playwright 自动化不充当该证据。

## 环境事实

| 项 | 值 |
|---|---|
| WebGPU 适配器 | `google/swiftshader`，`isFallbackAdapter: true`；强制 Vulkan 时无适配器 |
| 显卡 | NVIDIA GeForce GT 705（Fermi，驱动 23.21.13.9135）+ Microsoft Remote Display Adapter，RDP 会话 |
| WebCodecs | `VideoDecoder` 支持 vp8 / vp09.PP.LL.DD / avc1；裸 `vp09` 不支持；`AudioDecoder` 支持 opus / mp4a.40.2 |
| Chrome 原生 Matroska | `avc1+mp4a` → `probably`；`vp8+opus` → `probably`；`vp9+opus` → 空串 |
| 工具链 | ffmpeg 9.0、pwsh 7、Playwright chromium（`channel: 'chromium'` + `--enable-unsafe-webgpu`） |
