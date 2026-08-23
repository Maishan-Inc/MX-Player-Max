# Phase 13 验收记录

日期：2026-08-12 至 2026-08-13

状态：自动化质量、安全和短时性能固化已完成；最终发布门禁仍为 **pending/blocked**。

当前复核（2026-08-22）：`pnpm test` 的通过总数以生成证据
`evidence/current-test-counts.json` 为准，不在本文件手工维护；`pnpm verify:packages`
验证 19 个 publishable packages。下表中的包数量已按当前生成证据同步；历史日期和外部
环境 pending 结论保持不变。

## 前置门禁

Phase 10.2 的 libvpx VP8 三个变体已于 2026-08-20 完成项目所有者授权和许可证/专利审核。
`single`/`simd` 已进入受 manifest 控制的发布路径，`threaded` 仅因缺少 host glue 技术性排除。
WASM 实机矩阵不再被 Phase 10 审批阻塞，状态改为可执行的 `pending`；fake runtime 和本地自动化
仍不冒充 latest-two-stable 或物理 Safari 证据。

## 自动化结果

| 命令 | 结果 |
|---|---|
| `pnpm typecheck` | passed；20 个 workspace package/app 构建并严格类型检查 |
| `pnpm test` | passed；总数见 `evidence/current-test-counts.json`，与生成计数一致 |
| `pnpm build` | passed；20 个 workspace package/app 完整构建 |
| `pnpm test:browser` | passed；50 passed，8 skipped，覆盖 9 个 Playwright projects；其中 approved Phase 10.2 WASM 为 3 passed/5 skipped，作为自动化回归但不替代实机证据；Phase 13 Native/WebCodecs/UI/performance 为 47 passed/3 unsupported skipped，WebKit 仍仅 automation-only |
| `pnpm quality:media` | passed；媒体 + 字幕 fixture 的 FFprobe 元数据和 SHA-256 一致；语料条目以 `tests/media/manifest.json` 为准，2026-08-23 起新增两条 Matroska，见 [`render-mode-mkv-acceptance.md`](render-mode-mkv-acceptance.md) |
| `pnpm --filter @mx-player-max/postprocess test` | passed；含数值 kernel、packed graph、真实 device-lost、epoch、fallback、pool 长时复用/容量边界和 `copyExternalImageToTexture` usage 回归 |
| `pnpm test:update-counts` | 已重新生成 `evidence/current-test-counts.json`，`pnpm test --check` 与其一致 |
| `pnpm quality:webgpu` | passed；17/17 shipped WGSL kernel 通过真实 Dawn/Tint，`rgba16float` 2d-array 存储往返位级精确 |
| `pnpm quality:webgpu:numerics` | passed；7 项 kernel 执行对比 CPU 参考（含 torch 通道序、layer norm、1x1 卷积、stage bind layout） |
| `pnpm quality:webgpu:oracle` | passed；shipped `Rt4kSrGraphExecutor` 对上游 RT4KSR forward 端到端，8-bit 输入下 3x16x16 输出 `max |delta| = 3.7e-3`；GELU 换 ReLU 的负向对照会升到 `2.7e-1` |
| `pnpm quality:webgpu:rife` | passed；对上游 IFNet forward，`encode` `8.9e-4`、`warp` `1.2e-3`、`resize` `5.1e-4`；IFBlock body、flow 累积、graph IR 和最终 blend 明确列为未实现 |
| `pnpm exec playwright test --project=media-chromium --project=media-firefox` | passed；20/20 real-media automation tests |
| `pnpm exec playwright test --project=media-webkit-automation --trace=off` | 7 passed，3 unsupported skipped；automation-only，不是 Safari 证据 |
| `pnpm exec playwright test --project=performance-chromium --project=performance-firefox` | passed；4/4，隔离/非隔离各一条 |
| `pnpm quality:performance:collect && pnpm quality:performance` | passed；4 份 Playwright automation baseline 写入并通过 schema |
| `pnpm quality:performance:collect -- --scenario=long-run-30m` | 已执行 Chromium/Firefox 隔离与非隔离四组完整 30 分钟运行；原始失败报告已在复核后清理，摘要保留如下，未作为通过基线提交 |
| `pnpm quality:audit` | passed；7 个 AI/WASM 资产的 bytes/hash/license/review policy 一致 |
| `pnpm --filter @mx-player-max/decoder-wasm-vpx audit:wasm` | passed；single/SIMD 零 imports，threaded 14 imports；三者 review 全部 approved |
| `pnpm verify:packages` | passed；19 个公开包的 metadata、README/API 和发布边界通过 |
| `pnpm test:release` | passed；28/28，包括 CSP、双模式 Docker 静态合约、approved WASM 发布白名单和 threaded 技术排除 |
| `pnpm test:quality` | passed；9/9，性能 schema 完整字段、数值域、四格矩阵和长跑 seed-hash 拒绝负例 |
| `docker version` | pending；当前环境没有 Docker CLI，未执行 build 或 runtime smoke |

当前逐包测试数只以
[`docs/development/evidence/current-test-counts.json`](evidence/current-test-counts.json) 为准。
`pnpm test` 会重新执行所有 workspace 测试并比较该文件；数量变化需显式运行
`pnpm test:update-counts` 并审查 diff，Phase 文档不再复制当前分包数字。

本表记录的是 Phase 13 复核当时的运行结果。2026-08-23 起的渲染模式切换、Matroska 覆盖与失败归因
另立记录：[`render-mode-mkv-acceptance.md`](render-mode-mkv-acceptance.md)，其中的浏览器用例数与
本表不同（媒体 project 由 20 条增至 30 条）。

## 媒体样本

来源均为仓库专用 FFmpeg `lavfi testsrc2 + sine` 合成内容，项目许可证
`PolyForm-Noncommercial-1.0.0`，无第三方版权不明视频。完整 profile/bit-depth/audio/subtitle、
生成命令和最小复现见 `tests/media/manifest.json`。

| 样本 | SHA-256 |
|---|---|
| H.264 Baseline 8-bit + AAC MP4 | `c3cb704e533d88da2d4727c7147cf24db698ec37299ab5ef4aaa3dc585495446` |
| HEVC Main10 10-bit + AAC MP4 | `35b82636aa6109ae930cb0c86ecfbda2fb66d65f586c2f89eb9ff1075f1c2d4d` |
| AV1 Main 8-bit + AAC MP4 | `0a23314493e35f5a8585d332d6177ad33977eff18a40a6aa7bf19842e340ee56` |
| VP8 8-bit + Opus WebM | `e9e8baf10f81588a257bffe147648c31f5a0c5e5a52b57888e935917749d13b8` |
| VP8 8-bit video-only WebM | `d4a405dedb1eff44ee8b86ee7b364d8a25dfd17ef04c5c5b10579ae63aa4c9a9` |
| VP9 Profile 0 8-bit + Opus WebM | `03994a3fda205cb6492fec594361347e6724b467a0a9bfab1170d8a50f6ebbc7` |
| VP9 Profile 2 10-bit + Opus WebM | `486bef6ea4c41cad518fe50cde5cce40d3171c3650f9e03f088f80d35638a0ea` |
| SRT timing | `c26f385d9d5c9570a11a6a691a7f7394f54106e8a93f7984b11ce0f30273a2b8` |
| ASS style | `de8ac7e0c81b3cdec51b9f041bb6da5e403eadf72b609d039080af720c2ddb4f` |

小样本直接提交，保证离线 CI 字节一致。30 分钟样本由已提交 VP8/Opus seed 使用 `-stream_loop`
生成至 ignored `tests/media/generated/`，避免 Git LFS 和外部下载依赖；生成产物必须在长跑记录中
重新保存 SHA-256，短样本 hash 不能代替长样本 hash。

## 媒体与异常路径

Playwright Chromium/Firefox 使用真实 VP8/Opus Native 和 VP8 video-only WebCodecs，覆盖非空像素、
play/pause、连续 seek、buffer/ended/error、换源、SRT cue、video/canvas 像素统计一致性、resize 和 DPR。WebCodecs
选择 video-only 是因为 Playwright Chromium 不可靠支持专有 H.264/AAC，不据此推断实机 Codec 矩阵。

协议故障公开错误码：服务器忽略 Range 返回 200 -> `RANGE_UNSUPPORTED`；错误
`Content-Range` -> `RANGE_CONTENT_RANGE_INVALID`；真实截断容器 -> `CONTAINER_TRUNCATED`；断连并
保持合法长度/Range 但破坏 MP4 `ftyp` -> `CONTAINER_INVALID`；耗尽有界重试 ->
`RANGE_RETRY_EXHAUSTED`。每条浏览器故障均观察到公开 `error` 事件，不是静默空画面。Worker 异常终止 -> `WEBCODECS_WORKER_FAILED`，
AudioContext resume 拒绝 -> `AUDIO_AUTOPLAY_BLOCKED`，GPU device lost 回退 Canvas2D，100 次连续
seek 仅交付当前 epoch 且队列不超过配置上限。所有错误事件只暴露 code/message/recoverable，测试
确认 URL query、本地路径和原始 platform cause 不进入事件 JSON；字幕按 `textContent` 渲染。

| 异常/压力项 | 结果与降级 | 证据 |
|---|---|---|
| 浏览器 offline / 服务端断连 | `RANGE_RETRY_EXHAUSTED`，公开 error、无黑屏静默 | `tests/browser/media/media-paths.spec.ts` |
| Range 200 / 错误 Content-Range | `RANGE_UNSUPPORTED` / `RANGE_CONTENT_RANGE_INVALID` | 同上 |
| 截断 / 合法长度但损坏 MP4 | `CONTAINER_TRUNCATED` / `CONTAINER_INVALID` | 同上 |
| 超长 duration / 解析整数溢出 | `CONTAINER_INVALID`，拒绝元数据 | `packages/demux/tests/container-mp4.test.ts` |
| 内存/队列压力 | `WEBCODECS_QUEUE_OVERFLOW` 或 backpressure，64 pending reader 上限 | `packages/core/tests/custom-backpressure.test.ts`、`frame-queue.test.ts` |
| GPU device lost | renderer 重建失败后 Canvas2D fallback；AI stage passthrough 并释放 pool | `packages/renderers/tests/renderer.test.ts`、`packages/postprocess/tests/hardening.test.ts` |
| AudioContext 挂起/恢复拒绝 | `AUDIO_AUTOPLAY_BLOCKED`，保留已初始化 pipeline | `packages/audio/tests/output.test.ts`、`packages/core/tests/custom-audio.test.ts` |
| Worker 异常终止 | `WEBCODECS_WORKER_FAILED`，所有 pending request 拒绝并终止 transport | `packages/core/tests/custom-demux-session.test.ts` |

**真实 WebGPU 执行已具备（软件 adapter），f16 与性能仍 pending**：早前记录的
`navigator.gpu=false` 是探测配置误判，不是本机能力限制。`navigator.gpu` 受 `[SecureContext]`
约束，在 Playwright 默认的 `about:blank` 上不存在；`headless: true` 默认使用
chromium-headless-shell，它暴露 `navigator.gpu` 但永不返回 adapter。改为
`channel: 'chromium'` + `--enable-unsafe-webgpu` 并在 `http://127.0.0.1` 上探测后，
可稳定获得 `google/swiftshader`（`isFallbackAdapter=true`，`maxTextureDimension2D=8192`，
`float32-filterable` 可用，**`shader-f16` 不可用**）。详见
`docs/development/webgpu-harness.md`。

由此新增三个门禁：`pnpm quality:webgpu`（12 个 shipped kernel 全部通过真实 Dawn/Tint 编译 +
`rgba16float` 2d-array 存储往返精确）、`pnpm quality:webgpu:numerics`（kernel 对 CPU 参考）、
`pnpm quality:webgpu:oracle`（对上游 RT4KSR forward 的参考张量）。仍然 pending 的是：
`shader-f16` 变体、任何性能数字（SwiftShader 是 CPU 光栅化器）、以及播放器整链的 AI 端到端路径
（fallback adapter 会让 `proposeAiPlan()` 返回 tier `off`）。Firefox 即使强制
`dom.webgpu.enabled` 也拿不到 adapter，三浏览器 WebGPU 矩阵依旧依赖实机。

## 性能基线

以下仅为 Windows 11 `10.0.26100 x64` 上 Playwright automation smoke；Chromium
`151.0.7922.34` 使用 SwiftShader，Firefox `153.0` 报告 ANGLE/NVIDIA GeForce GTX 480 or similar。
每条使用 VP8/Opus SHA-256 `e9e8...13b8`。完整 JSON 位于 `tests/performance/baselines/`。

| 浏览器/隔离 | 首帧 ms | 首字幕 ms | seek ms | bufferedAhead us | dropped | 内存增长 | 功耗代理 dropped ratio |
|---|---:|---:|---:|---:|---:|---:|---:|
| Chromium / isolated | 411.04 | 852.13 | 58.04 | 772515 | 4 | 0 B | 0.04167 |
| Chromium / non-isolated | 709.50 | 1594.30 | 56.70 | 783310 | 1 | 0 B | 0.01031 |
| Firefox / isolated | 853.74 | 1559.30 | 99.28 | 913250 | 1 | unavailable | 0.02083 |
| Firefox / non-isolated | 1429.00 | 2120.00 | 94.00 | 913605 | 1 | unavailable | 0.02128 |

短跑阈值为首帧 2000 ms、首音 2500 ms、首字幕 2500 ms、seek 1000 ms、dropped <= 10、
音画漂移绝对值 <= 50,000 us、CPU time <= 2000 ms、内存 <= 512 MiB、增长 <= 16 MiB、
dropped ratio <= 0.1。Native API 不暴露独立
首音 timestamp、独立音频/视频时钟、进程 CPU 或真实功耗，因此这些字段为 `null + reason`；
Firefox 不支持 `performance.memory`，内存字段同样为 `null + reason`。

**30 分钟本地 automation 结果（2026-08-20）**：四组均完成约 1,800,000 ms 连续播放，使用同一
个实际生成的长跑样本 SHA-256 `eff7d642bbcc2bc967c534b151686d7a96e8eb1a6c30073e5f32849701ecb3a4`。
这些结果是失败证据摘要，不满足发布门禁：

| 浏览器/隔离 | 首帧 ms | 首字幕 ms | seek ms | bufferedAhead us | dropped ratio | 内存增长 |
|---|---:|---:|---:|---:|---:|---:|
| Chromium / non-isolated | 3850.6 | 4504.5 | 73.1 | 0 | 0.051749 | 0 B |
| Chromium / isolated | 7534.1 | 8200.7 | 66.9 | 0 | 0.051787 | 0 B |
| Firefox / non-isolated | 13337.0 | 14052.0 | 89.0 | 60086438 | 0.018405 | unavailable |
| Firefox / isolated | 10453.6 | 11085.2 | 68.0 | 61247021 | 0.006211 | unavailable |

Chromium 两组超过首帧/首字幕 2,000/2,500 ms 和 dropped ratio 0.05 阈值，并报告零 buffered
ahead；Firefox 两组长期 dropped ratio 低于阈值但首帧/首字幕超过启动阈值。Native 独立音画漂移、
CPU 和功耗仍不可观测，不能因为运行满 30 分钟而标记通过。长跑采集命令仍从实际文件计算 hash，
缺文件、复用 seed hash 或缺字段都会拒绝运行。

## 供应链与分发

RIFE MXAI SHA-256 为 `665472...c56c`（MIT），RT4KSR MXAI 为 `c34a76...fba0`
（Apache-2.0）；上游 archive/checkpoint、commit、许可证、转换命令、tensor 格式和 hash 均已核验。
libvpx WASM single `d8de9e...c5ba`、SIMD `79e784...53d`、threaded `422c57...07f` 与清单
一致，许可证/专利审核和项目所有者授权已完成。release manifest 发布 single/SIMD，并以
`threaded-host-glue-unavailable` 技术性排除 threaded；clean-room rebuild 仍是独立可复现性后续证据。

Nginx 静态合同包含 CSP、CORP、COOP/COEP、`nosniff`、MIME、Range、404；80 端口为隔离模式，
8080 为非隔离模式，用于单线程降级验证。`docker compose build` 和
`scripts/release/docker-smoke.ps1` 未运行，原因是本机 `docker` 命令不存在，故不能宣称镜像可构建
或两个端口的 runtime 行为通过。

## 真实浏览器矩阵

`tests/browser/evidence/real-browser-matrix.json` 的 Chrome latest/latest-1、Firefox
latest/latest-1、物理 macOS Safari latest/latest-1 六行全部 pending，版本、OS、GPU、隔离状态和样本
hash 均保持 null。当前没有真实 latest-two-stable 或物理 Safari 设备；Playwright Chromium/Firefox/
WebKit 不填充这些行。WASM 六行已解除 Phase 10 阻塞，保持等待实机执行的 `pending`。

## 最终门禁结论

- **P0/P1 真实浏览器回归：pending**，六个实机槽位未执行。
- **无未解释内存增长和音画漂移：pending**，本地长跑已执行但启动/缓冲/帧丢失阈值未通过，独立 drift/CPU/power 仍不可观测。
- **所有公开包 API 文档/变更记录：automation passed**，package verifier 与 README/CHANGELOG 门禁通过。
- **所有当前 libvpx VP8 WASM 来源/hash/license：审核与授权通过**；single/SIMD 可发布，threaded 技术性排除。
- **Docker 可构建、非隔离单线程可运行：pending**，Docker CLI 缺失。

因此 Phase 13 已交付可重复工具、自动化证据和精确 blocker，但尚不满足最终发布条件，不得发布。
