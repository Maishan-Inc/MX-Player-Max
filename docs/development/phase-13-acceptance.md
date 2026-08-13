# Phase 13 验收记录

日期：2026-08-12 至 2026-08-13

状态：自动化质量、安全和短时性能固化已完成；最终发布门禁仍为 **pending/blocked**。

## 前置门禁

Phase 10.2 在当前工作树已有 restricted libvpx VP8 实现和真实 WASM，但
`phase-10-acceptance.md` 仍记录独立许可证/专利审批、clean-room rebuild 和子阶段 review 未完成。
因此本阶段真实媒体证据只覆盖 Native + WebCodecs。所有 WASM 播放、性能和分发行均为
`blocked-by-phase-10`，fake runtime 和 restricted 本地回归不作为 Phase 13 真实平台证据。

## 自动化结果

| 命令 | 结果 |
|---|---|
| `pnpm typecheck` | passed；20 个 workspace package/app 构建并严格类型检查 |
| `pnpm test` | passed；508/508 tests，92 test files；与生成计数一致 |
| `pnpm build` | passed；20 个 workspace package/app 完整构建 |
| `pnpm test:browser` | passed；50 passed，8 skipped，覆盖 9 个 Playwright projects；其中 restricted Phase 10.2 WASM 为 3 passed/5 skipped，仅作低层回归且不计 Phase 13 证据；Phase 13 Native/WebCodecs/UI/performance 为 47 passed/3 unsupported skipped，WebKit 仍仅 automation-only |
| `pnpm quality:media` | passed；7 个媒体 + 2 个字幕 fixture，FFprobe 元数据和 SHA-256 一致 |
| `pnpm --filter @mx-player-max/postprocess test` | passed；26 tests，含数值 kernel、packed graph、真实 device-lost、epoch、fallback 和 pool 长时复用/容量边界 |
| `pnpm test:update-counts` | passed；508/508 tests，92 test files；生成 `evidence/current-test-counts.json` |
| `pnpm exec playwright test --project=media-chromium --project=media-firefox` | passed；20/20 real-media automation tests |
| `pnpm exec playwright test --project=media-webkit-automation --trace=off` | 7 passed，3 unsupported skipped；automation-only，不是 Safari 证据 |
| `pnpm exec playwright test --project=performance-chromium --project=performance-firefox` | passed；4/4，隔离/非隔离各一条 |
| `pnpm quality:performance:collect && pnpm quality:performance` | passed；4 份 Playwright automation baseline 写入并通过 schema |
| `pnpm quality:performance:collect -- --scenario=long-run-30m` | preflight passed；生成样本缺失时在启动浏览器前拒绝，未写入伪长跑证据 |
| `pnpm quality:audit` | passed；7 个 AI/WASM 资产的 bytes/hash/license/review policy 一致 |
| `pnpm --filter @mx-player-max/decoder-wasm-vpx audit:wasm` | passed；single/SIMD 零 imports，threaded 14 imports；全部 restricted |
| `pnpm verify:packages` | passed；19 个公开包的 metadata、README/API 和发布边界通过 |
| `pnpm test:release` | passed；19/19，包括 CSP、双模式 Docker 静态合约、release 排除策略 |
| `pnpm test:quality` | passed；9/9，性能 schema 完整字段、数值域、四格矩阵和长跑 seed-hash 拒绝负例 |
| `docker version` | pending；当前环境没有 Docker CLI，未执行 build 或 runtime smoke |

当前逐包测试数只以
[`docs/development/evidence/current-test-counts.json`](evidence/current-test-counts.json) 为准。
`pnpm test` 会重新执行所有 workspace 测试并比较该文件；数量变化需显式运行
`pnpm test:update-counts` 并审查 diff，Phase 文档不再复制当前分包数字。

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

**真实 WebGPU 数值执行 pending**：默认 Playwright Chromium 及三组 `--enable-unsafe-webgpu` /
SwiftShader/Dawn 参数探测均为 `navigator.gpu=false`。本机已通过 CPU reference oracle、WGSL full-channel
contract、真实 MXAI graph/hash、真实 device-lost stage 和 bounded pool 测试，但不得把 fake GPU 记成
WGSL kernel 的实设备数值结果；该行随 latest-two-stable 实机 WebGPU 回归补录。

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

**30 分钟门禁 pending**：本环境未完成 1,800,000 ms 连续播放，不能关闭 Phase 5/6/8 的漂移、
内存、CPU 或功耗项。长跑阈值定义为音画漂移 <= 50,000 us、内存增长 <= 64 MiB、dropped ratio
<= 0.05，但必须由完整运行数据验证，不得用 1 秒 smoke 外推。长跑采集命令从实际生成文件计算
SHA-256；缺文件、复用 seed hash、缺少任一 schema 字段都会失败。Native 不可观测的独立音画漂移
仍不能因播放满 30 分钟而标记通过，需在可观测管线或平台诊断中取得真实数值。

## 供应链与分发

RIFE MXAI SHA-256 为 `665472...c56c`（MIT），RT4KSR MXAI 为 `c34a76...fba0`
（Apache-2.0）；上游 archive/checkpoint、commit、许可证、转换命令、tensor 格式和 hash 均已核验。
libvpx WASM single `d8de9e...c5ba`、SIMD `79e784...53d`、threaded `422c57...07f` 与清单
一致，但独立许可证/专利/clean-room review 未完成，release manifest 全部排除。

Nginx 静态合同包含 CSP、CORP、COOP/COEP、`nosniff`、MIME、Range、404；80 端口为隔离模式，
8080 为非隔离模式，用于单线程降级验证。`docker compose build` 和
`scripts/release/docker-smoke.ps1` 未运行，原因是本机 `docker` 命令不存在，故不能宣称镜像可构建
或两个端口的 runtime 行为通过。

## 真实浏览器矩阵

`tests/browser/evidence/real-browser-matrix.json` 的 Chrome latest/latest-1、Firefox
latest/latest-1、物理 macOS Safari latest/latest-1 六行全部 pending，版本、OS、GPU、隔离状态和样本
hash 均保持 null。当前没有真实 latest-two-stable 或物理 Safari 设备；Playwright Chromium/Firefox/
WebKit 不填充这些行。WASM 六行全部 `blocked-by-phase-10`。

## 最终门禁结论

- **P0/P1 真实浏览器回归：pending**，六个实机槽位未执行。
- **无未解释内存增长和音画漂移：pending**，30 分钟与独立 drift/CPU/power 数据未执行。
- **所有公开包 API 文档/变更记录：automation passed**，package verifier 与 README/CHANGELOG 门禁通过。
- **所有 WASM 来源/hash/license：资料完整但发布审批 blocked-by-phase-10**。
- **Docker 可构建、非隔离单线程可运行：pending**，Docker CLI 缺失。

因此 Phase 13 已交付可重复工具、自动化证据和精确 blocker，但尚不满足最终发布条件，不得发布。
