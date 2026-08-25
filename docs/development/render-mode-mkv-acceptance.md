# 渲染模式切换 + Matroska + 失败归因 验收记录

日期：2026-08-23；2026-08-25 复测全部门禁，并补上 `media-webkit-automation` 的浏览器能力探测

对应计划：[`docs/superpowers/plans/2026-08-23-render-mode-switch-and-mkv-ai-plan.md`](../superpowers/plans/2026-08-23-render-mode-switch-and-mkv-ai-plan.md)

范围：该计划的 A 组（A1、A1b、A2、A3、A4、A5、A7、A8），加上运行时渲染模式切换与决策轨迹的
intent 排除记录，以及 2026-08-25 的 WebKit 能力探测。B 组（AI 开关端到端、性能证据、真实浏览器
矩阵）仍为 **pending**，原因见文末环境事实——本机只有软件 WebGPU 适配器。

逐包测试数以生成证据
[`evidence/current-test-counts.json`](evidence/current-test-counts.json) 为准，不在本文件手工维护。
`pnpm test` 会重新执行全部 workspace 测试并与该文件比对，数量变化需显式 `pnpm test:update-counts`
并审查 diff。

## 自动化结果

下表为 2026-08-25 的实测结果，每一行都是这一轮亲手跑出来的。

| 命令 | 结果 |
|---|---|
| `pnpm build` | passed；20 个 workspace package/app 完整构建 |
| `pnpm test` | passed；总数见 `evidence/current-test-counts.json`，与生成计数一致 |
| `pnpm test:update-counts` | 已重新生成 `evidence/current-test-counts.json`；2026-08-25 这轮无需再生成，`pnpm test` 与该文件一致 |
| `pnpm quality:acceptance-drift` | passed |
| `pnpm quality:media` | passed；10 个媒体 + 2 个字幕 fixture，SHA-256 与字节数一致（含 3 条 Matroska） |
| `pnpm test:browser` | passed；74 passed / 32 skipped / 0 failed，9 个 project。这一轮 `media-firefox` 在无音频那一侧；音频那一侧会多 8 条 passed、少 8 条 skipped（本轮改动前跑整套是 83 passed / 23 skipped / 0 failed，那次 firefox 在有音频侧、且 HEVC 拒绝那条当时还在 WebKit 里跑） |
| `pnpm test:browser --project=media-chromium --project=media-firefox` | passed；0 failed。`media-chromium` 每轮都是 26 passed / 0 skipped；`media-firefox` 视本机音频状态而定，实测两种都出现过——26 passed / 0 skipped 与 18 passed / 8 skipped（跳掉的是 8 条有音轨的用例），见下「音频输出能力是间歇的」一节 |
| `pnpm test:browser --project=media-webkit-automation` | passed；7 passed / 19 skipped / 0 failed，连续两轮一致。19 条 skip 全部由浏览器能力探测决定，见下「Playwright WebKit」一节 |
| `pnpm test:browser --project=chromium-desktop --project=chromium-mobile` | passed；10 passed / 2 skipped（2 条 skip 是 WASM 用例按 project 名自限） |
| `pnpm test:browser --project=firefox-simulated --project=webkit-simulated` | passed；9 passed / 3 skipped（同上） |
| `pnpm test:browser --project=performance-chromium --project=performance-firefox` | passed；4 passed，隔离/非隔离各一条。这两个 project 的 `dependencies` 覆盖其余 7 个，因此该命令与整套 `pnpm test:browser` 跑的是同一批 |
| `pnpm release:manifest` | passed；audio-worklet 自包含断言在位 |
| `pnpm verify:packages` | passed；19 个公开包 |
| `pnpm test:release` | passed；28/28 |
| `pnpm test:quality` | passed；9/9 |
| `pnpm quality:webgpu` | passed；27/27 shipped WGSL kernel 通过真实 Dawn/Tint，`rgba16float` 2d-array 存储往返位级精确 |
| `pnpm quality:webgpu:numerics` | passed；7 项 kernel 对 CPU 参考，最大偏差 3.58e-4（`packedLayerNorm`） |
| `pnpm quality:webgpu:oracle` | passed；`down` 2.42e-4、22 层 `fullGraph` 3.68e-3 |
| `pnpm quality:webgpu:rife` | passed；算子级 `encode` 8.86e-4 / `warp` 1.18e-3 / `resize` 5.14e-4，整图 155 节点全部 stage 收敛，`output` 1.97e-3 |
| `pnpm build:pages` | passed；产物里 `.mxai` 为 0，打包 JS 里不出现 `models/` 字面量，`sdk/` 下 10 个 Browser SDK 文件（两个 approved libvpx `.wasm` 按清单发布）。跑完后重新 `pnpm build:demo` 恢复非 pages 产物，否则浏览器门禁会跑到 `base: './'` 的构建上 |

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
| A7 | 从关键帧头部推导 `vp09.PP.LL.DD`（MP4 侧从 `vpcC`） | `packages/demux/tests/codec-vp9.test.ts` 20 条（头部解析、拒绝路径、level 表、两个容器的推导与回落）；4 条浏览器用例，按浏览器 VP9 探测而非验收 `unsupported` 决定 skip |
| 任务 4 | 轨迹记录「原生候选因 intent 被排除」，UI 给出「切回原生档」提示 | `strategy.test.ts` 6 条（三种自定义 intent 产出 exclusion、两种原生 intent 不产出、原生本就不通时不产出）；`player-ui-menu.test.ts` 4 条（归因顺序、无候选时不提示、陈旧轨迹忽略、状态栏文案） |
| 任务 5 | 运行时 Native ↔ Custom 切换（`switchRenderMode`） | `packages/core/tests/render-mode-switch.test.ts` 5 条（双向切换、epoch 递增与位置连续、同档 no-op、未载入时拒绝、失败回滚）；`tests/browser/media/render-switch.spec.ts` 真切一次并断言渲染器 native→canvas2d、位置不回退、字幕轨存活（chromium 与 firefox 都通过） |
| A8 | 引擎自身的编码范围传进策略层，范围外不产出候选；撤下的候选以 `skipped` attempt 保留原因 | `packages/strategy/tests/strategy.test.ts` 7 条（三类范围外、两种 intent 的候选 id、范围内仍排出、未声明时行为不变、纯视频轨）；`packages/decoder-webcodecs/tests/codec-scope.test.ts` 24 条声明与构造器逐编码比对；`packages/core/tests/decision-trace.test.ts` 的 skipped attempt 索引；`player-ui-menu.test.ts` 2 条归因优先级与报告行 |
| 2026-08-25 | 媒体浏览器用例改为「先探浏览器能力，再无条件断言」，探针集中在 `tests/browser/media/capabilities.ts` | 三个 media project 的 26 条用例；探针问的是浏览器（媒体元素能否解出这条夹具、`VideoDecoder` / `AudioDecoder` / `VideoFrame` / `AudioContext` 在不在、`AudioContext` 能否 running），不是验收结果的 `status === 'unsupported'`，因此 A7 与 A1 那两类「回归表现为 skip 而不是转红」的陷阱在整个目录里都堵上了 |

## 手工核对（构建产物 + preview）

| 场景 | 观察 |
|---|---|
| 设置面板切 WebGPU 档 | 启动器同步为 `frame-access`，反向亦同步；诊断面板渲染器 `webgpu` |
| 切 WebGL2 档 | 渲染器 `webgl2`，AI 两个开关灰显并给出渲染路径原因 |
| `/models/weights/rt4ksr/rt4ksr_x2.mxai` | 200，612953 字节；`/models/../package.json` 取不到仓库文件 |
| `flower.webm`（VP8 + Vorbis）切自定义档 | 状态文案指出音频编码不支持，报告含 `WEBCODECS_AUDIO_NOT_SUPPORTED`、`audioCodec: vorbis 2ch`；A8 之后候选不再产出，错误码由 `STRATEGY_ALL_CANDIDATES_FAILED` 变为 `STRATEGY_NO_VIABLE_BACKEND`，逐候选原因不变 |
| HEVC MP4 切自定义档 | 状态文案指出没有可用路径，报告含 `videoCodec: hvc1`、`candidates: none` |

## 已知限制与未完项

- **AI 两个开关在本机无法端到端验收。** WebGPU 只能拿到 `google/swiftshader`
  （`GPUAdapterInfo.isFallbackAdapter === true`），引擎据此一律报 `device-capability`。
  归入计划的 B 组，需换有真实 GPU 的机器。
- **Firefox 需要更长的操作预算。** 本机无 GPU，Firefox 走自定义管线比 Chromium 慢约 60%，
  脚本化验收会间歇性撞上引擎默认的 10 s worker/configure/flush/seek 预算，表现为
  `WEBCODECS_WORKER_FAILED` 或 `CUSTOM_SEEK_FAILED`。验收 harness 把该预算提到 30 s、每个脚本化
  步骤的等待提到 25 s、外层等待提到 120 s、`media-*` project 的用例超时提到 180 s 后稳定通过。
  这是计时问题，**不是解码缺陷**，也没有改动出厂默认值。Firefox 下最慢的一条是 10-bit VP9 走
  自定义管线，整条脚本 43 s。步骤超时现在报 `MEDIA_ACCEPTANCE_TIMEOUT_<step>`，能直接看出卡在哪步。
- **VP9 已经能走自定义管线（A7 已完成）。** EBML 解复用从第一个关键帧的 uncompressed header 推出
  `vp09.PP.LL.DD`，MP4 侧从 `vpcC` 取同样三个字段。顺带纠正原先的一条记录：裸 `vp09` 让
  `canPlayType` 返回空串，所以 VP9 样本此前连原生路径也不通——语料里的 `expectedPaths: ["native"]`
  是个从未被用例验证的声明。现在两个样本都是 `["native", "webcodecs"]`，四条用例背书。
- **策略层已经知道引擎自身的编码范围（A8 已完成）。** `CapabilityContext.webCodecsCodecs` 由
  `decoder-webcodecs` 的 `WEBCODECS_CODEC_SCOPE` 提供，范围外的编码不再产出候选；被撤下的候选以
  `status: 'skipped'` 的 attempt 留在决策轨迹里，因此 A5 的归因文案不受影响。
- **本机的音频输出能力是间歇的，`media-firefox` 因此有两种合法结果。**
  原记录写「`AudioContext` 恒为 `suspended`，`resume()` 既不 resolve 也不 reject，firefox 因此固定
  跳过 8 条自定义 + 有音轨的用例」。这一轮两种状态都实测到了，而且是同一天、同一棵树、同一套版本：
  先是连续 5 次启动 Playwright Firefox，`resume()` 都在 1 ms 内 resolve、状态转 `running`、
  `currentTime` 前进，`media-firefox` 26 条全通过、0 skipped（连着两轮都是）；约 20 分钟后连续 3 次
  启动，`resume()` 25 s 都不落地、状态停在 `suspended`，同一轮的 `media-firefox` 就是
  18 passed / 8 skipped，跳掉的正是那 8 条有音轨的用例。中间没有任何可观察到的变化：Firefox 版本
  仍是 153.0，`HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\MMDevices\Audio\Render` 下三个端点
  前后都是 `DeviceState = 4`（NOTPRESENT），`Audiosrv` 与 `AudioEndpointBuilder` 都在运行。
  是什么在翻转，这一轮没查出来。
  所以原记录的**观察**没错，错的是把它写成固定属性；正确的说法是间歇。探针（「`resume()` 能否在
  2 s 内让 `AudioContext` 进入 running」）保留——它正是让两种状态都不产生假失败的东西；2 s 这个
  上限也不该放宽，失败那一侧是**永远不落地**，放宽只会拖慢跑而换不到准确度。Chromium 在两种状态下
  都是 1 ms resolve。当初顺带修掉的那个真实缺陷不受影响：`play()` 曾会无声挂死，现在报
  `AUDIO_AUTOPLAY_BLOCKED`。
- **Playwright WebKit 是 automation-only，而且它的 `canPlayType` 不能当能力探针。**
  实测（Version/26.5、AppleWebKit 605.1.15、Windows，2026-08-25）：
  - 没有 WebCodecs——`VideoDecoder` / `AudioDecoder` / `VideoFrame` / `EncodedVideoChunk` 全部
    `undefined`；也没有 Web Audio——`AudioContext` 与 `webkitAudioContext` 都 `undefined`。
  - `canPlayType` 对**任何**类型都回 `probably`，包括 `video/x-matroska`、HEVC 和裸 `vp09`。
  - 媒体元素的真实能力（直接加载语料夹具）：H.264 MP4 能到 `loadeddata` 但不确定（一次 6.2 s 落地、
    一次 20 s 没落地）；Matroska H.264 **既不 `loadeddata` 也不 `error`**，10 s 后仍 readyState 0，
    引擎因此报 `NATIVE_METADATA_TIMEOUT`；AV1、HEVC、全部 WebM、Matroska VP8 都是
    `MEDIA_ERR_SRC_NOT_SUPPORTED`。
  - 所以原生用例的探针是「把该用例要放的那条夹具真加载一遍，要求 `loadeddata` 且 `videoWidth > 0`」。
    `videoWidth` 是答案的一部分：Chromium 在 HEVC 上能到 readyState 4 却静默丢掉视频轨，那时宽度是 0。
  - `MEDIA_ACCEPTANCE_TIMEOUT_*` 与 `NATIVE_METADATA_TIMEOUT` 一概**不**归为 unsupported：超时与真卡死
    按错误码分不开。跳过只由探针决定，验收 harness 的分类没有为此放宽。
  - HEVC 拒绝那条在 WebKit 里跳过，理由不是「拒绝需要解码能力」（不需要），而是两条：这条用例要钉的
    是**引擎自己的编码范围**在拒绝 HEVC，而 WebKit 没有 WebCodecs，它的拒绝与那个范围无关；更要紧的
    是它的媒体元素对放不了的文件不给确定答复——同一条 HEVC 夹具一轮回 `MEDIA_ERR_SRC_NOT_SUPPORTED`、
    下一轮 45 s 都不落地（引擎报 `NATIVE_METADATA_TIMEOUT`），所以在那里断言「哪一种拒绝」本身不稳。
    实测过让它在 WebKit 里跑：一轮通过、一轮转红，因此按「浏览器有没有 WebCodecs」跳过。
  - 一条与编解码无关的观察：WebKit 下 libvpx WASM 回退能走到 `ready`，随后报
    `WASM_FRAME_ABI_INVALID`。真实原因是没有 `VideoFrame` 构造函数
    （`packages/decoder-wasm-vpx/src/abi.ts` 的 `browserFrameFactory`），不是描述符坏了——一个能力
    缺口穿着「ABI 非法」的码。用例按 `VideoFrame` 是否存在跳过；这个错误码本身**未改动**。
- 真实浏览器矩阵 [`tests/browser/evidence/real-browser-matrix.json`](../../tests/browser/evidence/real-browser-matrix.json)
  仍全部 `pending`：本工作区没有物理 latest-two-stable 浏览器，Playwright 自动化不充当该证据。

## 环境事实

| 项 | 值 |
|---|---|
| WebGPU 适配器 | `google/swiftshader`，`isFallbackAdapter: true`；强制 Vulkan 时无适配器 |
| 显卡 | NVIDIA GeForce GT 705（Fermi，驱动 23.21.13.9135）+ Microsoft Remote Display Adapter，RDP 会话 |
| 音频输出端点 | MMDevices `Render` 下三个端点始终 `DeviceState = 4`（NOTPRESENT），`Audiosrv` 与 `AudioEndpointBuilder` 运行中。Chromium 的 `AudioContext` 恒定 1 ms 进入 `running`；Firefox **间歇**——同一天既测到 5/5 秒内 `running`，也测到 3/3 在 25 s 内不落地 |
| WebCodecs | Chromium 与 Firefox：`VideoDecoder` 支持 vp8 / avc1.42C01E / vp09.PP.LL.DD / av01.0.00M.08，裸 `vp09` 不支持；`AudioDecoder` 支持 opus / mp4a.40.2。Playwright WebKit：整套 WebCodecs 都不存在 |
| Chrome 原生 Matroska | `avc1+mp4a` → `probably`；`vp8+opus` → `probably`；`vp9+opus` → 空串 |
| 原生 VP9 codec 字符串 | `video/webm; codecs="vp09, opus"` → 空串；`codecs="vp09.00.11.08, opus"` → `probably`（Chromium 与 Firefox 都是） |
| Playwright WebKit | Version/26.5、AppleWebKit 605.1.15；`canPlayType` 对任何类型都回 `probably`；只有 H.264 MP4 能真解出画面（且不稳定），Matroska 永远拿不到 metadata |
| 浏览器版本 | Playwright chromium 151.0.7922.34、firefox 153.0、webkit 26.5 |
| 工具链 | ffmpeg 9.0、pwsh 7、Playwright chromium（`channel: 'chromium'` + `--enable-unsafe-webgpu`） |
