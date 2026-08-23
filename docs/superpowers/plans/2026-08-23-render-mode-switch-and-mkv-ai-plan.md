# 渲染模式切换 + MKV 超分/插帧 开发任务

Date: 2026-08-23

## 1. 目标

1. 播放器**设置面板**里提供一个「渲染模式」三档开关：
   - `native` — 原生 `<video>`，作为对照档（Chrome 能原生放 MKV/H.264+AAC，但这一档下 AI 永远不可用）
   - `custom-webgpu` — 自定义管线 + WebGPU 渲染器（超分辨率与 AI 插帧只在这一档可用）
   - `custom-fallback` — 自定义管线 + WebGL2（无 WebGL2 时 Canvas2D），作为无 AI 的对照档
2. 修掉现在「切到自定义管线就播放失败」的问题。
3. 最终在 demo 里用一个 **MKV（H.264 + AAC，或 VP9/AV1 + Opus）** 跑通超分辨率与 AI 插帧，并留下可复跑的证据。

## 2. 现状核实（本机实测，2026-08-23）

### 2.1 AI 门禁链条

`packages/core/src/index.ts` 的 `aiStatus()` 依次要求：

| 顺序 | 条件 | 不满足时 UI 显示 |
|---|---|---|
| 1 | 会话走自定义管线，且渲染器是 WebGPU，且 `decodedFrameSource` 存在 | 把渲染模式切换到 WebGPU 自定义管线后才能开启 |
| 2 | WebGPU 适配器不是 fallback（软件）适配器 | 此设备没有可用的 WebGPU 适配器 |
| 3 | 构造播放器时传入了 `aiModelBaseUrl` | 宿主未配置 AI 模型根目录 |

UI 侧只是把引擎给的原因回显（`packages/ui/src/controller.ts` 的 `#aiUnavailableText`），**没有任何开关**；渲染路径在 `MXPlayer` 构造/`load()` 时由 `intent` 与 `customVideo.renderer` 决定。

### 2.2 三个已核实的失败点

**F1 — 生产构建的 AudioWorklet 资源是坏的（这是「播放失败」的直接原因）**

`packages/audio/dist/worklet-processor.js` 第一行是：

```js
import { SHARED_AVAILABLE_FRAMES, /* … */ } from './ring-buffer';
```

`tsconfig.base.json` 用 `moduleResolution: "Bundler"`，所以 tsc 保留了无扩展名的相对说明符。Vite 把这个文件当作 URL 资源整体拷进 `dist/assets/`，**不会**把 `ring-buffer.js` 一起拷过去，浏览器里的 AudioWorklet 也不会去补 `.js`。结果 `addModule()` 拉不到模块，`AudioWorkletOutput.initialize()` 抛出 `AUDIO_WORKLET_LOAD_FAILED`，自定义管线整条候选失败，最终报 `STRATEGY_ALL_CANDIDATES_FAILED`。

实测对照（同一浏览器、同一文件 `webm-vp8-p0-8bit-opus.webm`、`intent=filters`）：

| 环境 | 结果 |
|---|---|
| `vite dev`（源码，未打包） | `state: ready`，`rendererKind: webgpu`，候选 `selected` |
| `vite preview`（`apps/demo/dist`） | 候选 `failed: AUDIO_WORKLET_LOAD_FAILED` |
| 部署站点 `player.maishanzero.com` | 同上（同一构建产物） |

裸 AudioWorklet 在同一个 headless Chromium 里完全正常（`AudioContext.state = running`，`addModule` 10–18 ms，`AudioWorkletNode` 可连到 destination），所以这不是环境问题。

**状态：已修复（见 A1）。** 修好之后 `audioClock.source` 变成 `audio-context`，自定义候选被 `selected`，但随即暴露出 A1b。

**F1b — 自定义管线带音轨时时钟不前进，约 4 秒后致命失败（被 F1 掩盖）**

修掉 F1 后，同一个 VP8 + Opus 文件在 dev 与构建产物下都能 `load()` 成功、渲染器是 `webgpu`、音频时钟来源是 `audio-context`，但：

| 观测 | 值 |
|---|---|
| `audioClock.renderedFrames` | 始终 `0` |
| `audioClock.running` | 始终 `false` |
| `playback.state` | 停在 `ready`，即使 `player.play()` 已 resolve |
| 约 4 秒后 | `lastError = { code: 'AUDIO_BUFFER_OVERFLOW', recoverable: false }` |

抛出点是 `MessagePcmTransport.enqueue` 的 pending 上限（不是 `audio-controller.ts:287` 的 `maxBufferedDuration`——那条路走不到）：`startBufferDuration`（150 ms）恰好填满 8 块的 MessagePort 队列，`play()` 之后第一个 `consumed` 回执还没回来，第 9 块就撞上硬失败。之所以从没被发现：`native` 模式不走自定义音频路径，而 `webcodecs` 模式的样本是无音轨的。

**状态：已修复（见 A1b）。**

**F2 — demo 默认示例 `flower.webm` 是 VP8 + Vorbis**

Vorbis 不在自定义管线的音频范围内（`packages/decoder-webcodecs/src/audio-config.ts:53` 只覆盖 AAC / Opus / MP3），所以在部署站点上切到任一自定义管线档都会失败，错误码 `WEBCODECS_AUDIO_NOT_SUPPORTED`。

**F3 — demo 从未传 `aiModelBaseUrl`**

`apps/demo/src/App.tsx` 的 `playerOptions` 只有 `source / intent / native / subtitles`；Pages 构建按设计剔除 `.mxai`（`scripts/release/prepare-pages.mjs:8`），部署的 `sdk/manifest.json` 里 `aiModelBaseUrl` 就是 `null`。

### 2.3 工作区里已经完成的部分（未提交）

`packages/postprocess/src/gpu/rife.ts`（`RifeGraphExecutor`）为新增文件，`chain.ts` 增加了 `attachStages()` 与 `consumedThrough`，`packages/core/src/index.ts` 已经把 RIFE 接进引擎：按需加载 `RIFE_V425_MANIFEST`、`customPipeline.setVideoLookahead(aiPipeline.lookaheadFrames)`、`intent: 'ai-enhance'` 时按 `aiPlan` 自动开启。`aiStatus()` 里原先的 `not-implemented` 已经去掉。

**结论：插帧不再是「没实现」，剩下的是宿主接线（A3）与真机验收（B1）。**

## 3. A 组 — 当前环境可以开发**并且**可以验证

### A1 修复生产构建的 AudioWorklet 加载（阻塞项，必须最先做）

`packages/audio/src/worklet-processor.ts` 必须是**自包含单文件**：AudioWorklet 模块无法解析无扩展名说明符，其兄弟文件也不会被打包器带出去。

- 把 `SHARED_READ_FRAME / SHARED_AVAILABLE_FRAMES / SHARED_EPOCH / SHARED_RENDERED_FRAMES / SHARED_UNDERRUNS / SHARED_PAUSED / SHARED_CLOSED` 这 7 个下标常量直接定义在 worklet 文件内，删掉对 `./ring-buffer` 的运行时 import（`./worklet-protocol` 是 type-only，编译后会被擦除，可以保留）。
- 新增单测断言 worklet 内的常量与 `ring-buffer.ts` 导出值逐一相等，防止两边漂移。
- 备选做法：给 `packages/audio` 的构建加一步 worklet 打包，产出单文件。代价是新增构建依赖并改变已发布资源的哈希与构建契约，除非你更倾向这条路，否则不建议。
- 永久护栏：在 `scripts/release/verify-packages.mjs` 里对清单中 `type: "audio-worklet"` 的资源断言「不含任何 `import` / `export` 语句」。
- 回归用例：在 `tests/browser/media/` 加一条**跑构建产物**（`playwright.pages.config.ts` 那套 preview 服务）的用例，用带 Opus 音轨的样本走自定义管线并断言 `state === 'ready'`。现有 `?mediaAcceptance=webcodecs` 用的是无音轨样本，所以没能拦住这个 bug。

验收：`pnpm build:demo && pnpm test:pages`，以及新用例在 preview 服务下通过。

**已完成（2026-08-23）**：worklet 改为自包含单文件；`packages/audio/tests/shared-header-layout.test.ts` 守住常量漂移与运行时 import；`scripts/release/generate-manifest.mjs` 对 `type: "audio-worklet"` 资源断言无模块 import（回填坏文件时确认会失败）；`apps/demo/src/media-acceptance.ts` 新增 `webcodecs-audio` 模式，`tests/browser/media/media-paths.spec.ts` 新增用例并已确认「回填坏 worklet 时该用例转红」。顺带修掉一处会掩盖缺陷的分类：`STRATEGY_ALL_CANDIDATES_FAILED` 原先被无条件当成 `unsupported`，会让坏 worklet 直接 skip 掉自己的用例，现在按决策轨迹里的逐候选错误码判定，并把 `engineErrorCode` / `attemptErrorCodes` 透出到结果里。

### A1b 自定义管线的音频时钟不前进（已完成）

见 §2.2 的 F1b。实测结论与最初的猜测不同，记录下来免得再走一遍：

- **不是** worklet 的问题。把构建产物里的 worklet 单独加载、依次投 `reset` / `pcm` / `playback`，它正确回了 `consumed`。
- **也不是** `audio-controller.ts:287` 的 `maxBufferedDuration` 检查。`bufferedFrames` 取自 `MessagePcmTransport.pendingFrames`，上限只有 8 块（约 150 ms），根本到不了 2 秒。
- 真正的抛出点是 `MessagePcmTransport.enqueue` 的 `pending.size >= maxMessagePortPendingBlocks`。观测到的时序是：8 块入队（`audiostatechange` 连发 8 次 `ready`）→ 缓冲到 `startBufferDuration`（150 ms）后 `play()` → 输出转 `running` → 第 9 块在第一个 `consumed` 回执之前到达 → 致命 `AUDIO_BUFFER_OVERFLOW`。默认值让 150 ms 的起播缓冲恰好等于 8 块队列容量，一点余量都没有。

改法（已落地）：

1. `AudioOutputLike` 增加 `canAccept(frames)`；`SharedPcmRingBuffer` 补 `freeFrames`。
2. `AudioController` 增加 `#holdback` 队列：塞不进传输层的块暂存，`atHighWater()` 只要有暂存就报高水位，`#handleConsumed` / `#handleUnderrun` 时交付。暂存帧计入 `bufferedFrames` 与 `drained`，`reset` / `close` 时清空。只有暂存量超过 `maxDecodeQueueSize` 才抛 `AUDIO_BUFFER_OVERFLOW`——那时才是喂数据的一方没有遵守高水位。
3. 顺带修掉一个相邻缺陷：MessagePort 传输初始化时补发 `reset`，让处理器的 epoch 对齐会话 epoch（共享内存路径靠 `shared-init` 携带 epoch，MessagePort 路径此前没有任何消息，非 0 epoch 的会话会静默无声）。

验证：构建产物里 VP8 + Opus 走自定义管线，`state: playing`、`currentTime` 前进、`audioClock.renderedFrames` 51751、`running: true`、27 帧已呈现、无错误。`webcodecs-audio` 验收模式恢复成完整的播放 / seek / ended / 换源脚本并断言 `audioRenderedFrames > 0`；`custom-audio-holdback.test.ts` 与 `output.test.ts` 的两条新用例都做过变异验证（去掉暂存逻辑即转红）。

**遗留噪音（未处理）**：构建产物里的 worklet 带 `sourceMappingURL=worklet-processor.js.map`，但打包器只拷了 `.js`，所以控制台每次会有一条 404。运行时无影响，但会误导排查（我这次就被它带偏过）。要修就是让 `packages/audio` 对 worklet 入口不出 sourcemap，代价是动到已发布资源的哈希。

### A2 UI — 设置面板的「渲染模式」三档

沿用 `TheaterModeAdapter` 的宿主适配器模式，UI 不碰引擎重载语义。

- `packages/ui/src/contracts.ts`
  - 新增 `export type PlayerRenderMode = 'native' | 'custom-webgpu' | 'custom-fallback'`
  - 新增 `RenderModeAdapter { getState(): PlayerRenderMode; setState(mode): void | Promise<void>; subscribe(listener): () => void }`
  - `PlayerUiOptions` 加 `readonly renderMode?: RenderModeAdapter`
  - `PlayerUiFeatureOptions` 加 `readonly renderMode?: boolean`，`DEFAULT_FEATURES` 里默认 `true`
  - `PlayerUiLabels` 加 `renderMode / renderModeNative / renderModeWebGpu / renderModeFallback / renderModeAiHint`，并补 `DEFAULT_LABELS`
- `packages/ui/src/locales.ts`：补 zh-CN / zh-TW / ja 三份文案
- `packages/ui/src/controller.ts`：在 `#renderSettings` 里、AI 区块**之前**渲染一个 `<select>`（`aria-label` 用 `renderMode` 文案）；`attach` 时订阅适配器，外部变化要触发 `#renderOverlayIfOpen()`；未提供适配器时整段不渲染
- `packages/ui/src/index.ts`：导出新类型
- 三档与播放器选项的映射（宿主侧执行）：

  | 档位 | `intent` | `customVideo.renderer` |
  |---|---|---|
  | `native` | `normal` | 不传 |
  | `custom-webgpu` | `ai-enhance` | `webgpu` |
  | `custom-fallback` | `filters` | `webgl2` |

  用 `ai-enhance` 是因为策略层只在这个 intent 下计算 `aiPlan`（`packages/strategy/src/index.ts:60`），档位建议与自动开启都依赖它。
- 测试：`packages/ui/tests/` 里覆盖「三档渲染」「切换回调」「外部变更后面板同步」「未提供适配器时不渲染」；`packages/ui/tests/playwright/` 补一张设置面板截图基线
- 文档：`docs/api/player-ui.md` 补契约说明

验收：`pnpm --filter @mx-player-max/ui test`、`pnpm test:browser --project=chromium-desktop`。

### A3 Demo 宿主接线 + AI 模型根目录

- `apps/demo/src/App.tsx`
  - 新增 `renderMode` state 与一个 `DemoRenderMode implements RenderModeAdapter`（照 `DemoTheaterMode` 写）
  - `playerOptions` 依 A2 的映射表派生 `intent` / `customVideo`，并加上 `aiModelBaseUrl`
  - 现有「播放意图」下拉框改为跟随渲染模式，或直接移除（三档已经覆盖它的全部语义）
  - 切档要 `setDiagnosticRevision(r => r + 1)`，让诊断面板重置
- `apps/demo/vite.config.ts`：照 `serveAcceptanceAssets()` 再加一个中间件，把 `packages/postprocess/assets/weights/**` 挂到 `/models/weights/…`（dev 与 preview 都装）。`aiModelBaseUrl` 传 `/models/`，`loadAiModelAsset` 会拼成 `/models/weights/rt4ksr/rt4ksr_x2.mxai`，并按清单里的 sha256 校验。
  - 权重不进 `public/`，因此不会落进 `dist`，`prepare-pages.mjs` 的 `.mxai` 拦截保持有效——**Pages 上依旧是 `model-unavailable`，这是有意的**。
  - RIFE 权重 24.5 MB、RT4KSR 613 KB；首次开启插帧会有一次 24.5 MB 拉取，UI 上需要有加载态。
- `apps/demo/src/i18n.ts`：补四语文案
- 测试：`apps/demo/src/*.test.ts` 里覆盖「档位 → playerOptions」的纯函数映射（把映射抽成可测函数，别写在 JSX 里）

验收：`pnpm --filter @mx-player-max/demo test`；dev 与 preview 下手动切三档，诊断面板的渲染器分别是 `native` / `webgpu` / `webgl2`。

**已完成（2026-08-23）**：`DemoRenderMode` 适配器 + `apps/demo/src/render-mode.ts` 里的纯映射函数（`renderModePlayerOptions` / `renderModeFromIntentValue` / `intentValueFromRenderMode`）；启动器的 `#playback-intent` 选择器保留（ADR-0006 要求），三个 option 值不变但改为渲染模式的两个视图之一，两个控件写同一份状态因此不会互相打架；`resolveAiModelBaseUrl` 在 `--mode pages` 下返回 `undefined`，其余情况指向 `/models/`；`serveModelAssets()` 中间件按显式白名单在 dev 与 preview 下提供 `weights/**`，权重不进 `public/` 因此 Pages 拦截依旧有效。实测：设置面板选 WebGPU 档后启动器同步成 `frame-access`、反向也同步；渲染器变成 `webgpu`，AI 原因从 `renderer-path` 变成 `device-capability`（本机软件适配器）；`/models/weights/rt4ksr/rt4ksr_x2.mxai` 返回 200 且路径穿越请求拿不到仓库文件。

### A3b 起播延迟（原先误判为「不起播」，已排除缺陷）

A3 记录中曾把「带音轨的源在 demo 里停在 `ready`」当成阻塞缺陷。**这是观测窗口太短造成的误判，不是缺陷。**
给它 25 秒后同一个会话正常播到 `ended`：`audioClock.renderedFrames = 132895`、presented 90 帧、无错误码。

在 pipeline 的 `#runPump` 上加临时 instrumentation 后测到的起播时间线（本机 headless + SwiftShader，
`play()` 为零点）：

| 源 | `state: playing` | 首个音频块 | 首帧呈现 |
|---|---|---|---|
| VP8 + Opus | 5877 ms | 5858 ms | 5958 ms |
| VP8 无音轨 | 2240 ms | – | 2328 ms |

带音轨的会话要等音频缓冲到 `startBufferDuration` 才会 `#startIfReady()`，所以引擎的 `playing` 状态本就
落在首个音频块之后；两条路径的差值约 3.6 秒。这些绝对值在本机没有意义（软件光栅化器 + 软解，
`docs/development/webgpu-harness.md:61` 明确禁止把本机计时当性能证据），需要在真机上重新量，
因此归入 B 组而不是 A 组。

**验收用例的教训**：黑盒探测时给起播留足窗口。`webcodecs-audio` 验收模式用的 45 秒超时是合适的，
手写探针用 3–4 秒就会把慢启动读成死锁。

### A4 MKV 测试样本与自动化用例

仓库现在**没有任何 `.mkv` 夹具**（只有 mp4 与 webm），MKV 解复用有 `MatroskaContainerAdapter` 但没进过媒体矩阵。本机有 ffmpeg 9.0 与 pwsh 7，可以直接生成。

- `scripts/quality/generate-media-fixtures.ps1` 增两条：
  - `mkv-h264-baseline-8bit-aac.mkv`（`-c:v libx264 -profile:v baseline -c:a aac`）
  - `mkv-vp9-p0-8bit-opus.mkv`（`-c:v libvpx-vp9 -c:a libopus`）
- `tests/media/manifest.json` 按现有 schema 补两条（`container: "matroska"`、sha256）。`expectedPaths` 按实测填：
  - `mkv-h264-baseline-8bit-aac` → `["native", "webcodecs"]`
  - `mkv-vp9-p0-8bit-opus` → `["webcodecs"]`（Chrome 对 `video/x-matroska; codecs="vp9,opus"` 返回空串，原生放不了）
- `apps/demo/src/media-acceptance.ts` 加 `mkv` 模式（`intent: 'frame-access'`，先用 `canvas2d` 保证与现有用例同构），并在 `tests/browser/media/media-paths.spec.ts` 接上
- 顺手验证 MKV 内嵌 ASS 字幕轨（`packages/subtitles/src/embedded.ts` 已有能力，但没有 MKV 覆盖）

**已完成（2026-08-23）**：两条 Matroska 夹具 `mkv-h264-baseline-8bit-aac.mkv` 与
`mkv-vp8-p0-8bit-opus.mkv`，都要 `-bitexact` —— 否则 matroska 复用器每次写一个随机 `SegmentUID`，
文件哈希不可复现，语料校验会直接拒收（实测：不加时两次生成哈希不同，加了完全一致）。
`verify-media-manifest.mjs` 的容器白名单加上 `matroska`。三个新验收模式 `mkv-native` / `mkv` /
`mkv-vp8` 加四条用例，chromium 与 firefox 都通过（Firefox 原生也能放 Matroska）。

**计划外的发现：VP9 在任何容器里都没有自定义管线路径。** EBML 解复用把 VP9 轨道报成裸 `vp09`
（`matroska-adapter.ts` 的 `mapCodec`），而 `VideoDecoder.isConfigSupported({ codec: 'vp09' })`
返回 `false`，`video-config.ts` 的 `VP9_CODEC` 也要求完整的 `vp09.PP.LL.DD`。实测两个 WebM VP9
样本在自定义档下都是 `STRATEGY_NO_VIABLE_BACKEND`、候选数为 0。因此：

- 第二条 MKV 夹具从 VP9 改成 VP8 —— VP9 那条根本跑不起来，留着就是个假样本
- `webm-vp9-p0-8bit-opus` 与 `webm-vp9-p2-10bit-opus` 的 `expectedPaths` 从
  `["native", "webcodecs"]` 修正为 `["native"]`，原先的 webcodecs 声明从来没有用例验证过
- 新增一条用例把「裸 `vp09` 不被接受」钉住，等哪天补上完整 codec 字符串推导时它会提醒改回来
- 补全 codec 字符串（从 VP9 bitstream 或 CodecPrivate 推 profile/level/bitDepth）是独立工作，
  不在本任务内；`mkv-vp8` 已经覆盖了「Matroska + 第二组编码对」这个维度

**内嵌 ASS 字幕轨（2026-08-23 补做）**：新增第三条 Matroska 夹具
`mkv-h264-baseline-8bit-aac-embedded-ass.mkv`，把 `basic-style.ass` 以 `S_TEXT/ASS` 流拷贝进容器，
验收模式 `mkv-embedded-subs` 用 `selectSubtitleTrack('embedded-<trackId>')` 选中它。这条夹具
**不能加 `-shortest`**：字幕流在 2.60 s 结束，`-shortest` 会把视频和音频一起截断到那里。

**这一步不是纯加夹具：`AssPacketParser` 有个真实缺陷。** Matroska 的 ASS 块携带的是 CodecPrivate
里 `Format:` 行声明的字段（减去 Start/End、前置 ReadOrder），而 `packetDialoguePayload()` 硬要求
固定的九字段布局。`basic-style.ass` 的 `Format:` 只有 `Layer, Start, End, Style, Text`，FFmpeg
原样拷贝后每个块只有四个字段，于是每一块都被判为「字段不全」，整条轨道一条 cue 都出不来
（实测：两个块各得一条 `SUBTITLE_PACKET_INVALID`，cues 为空）。改为按 `context.eventFormat`
推导块布局后端到端通过；规范格式下的行为逐字不变。

验收：`pnpm quality:media`、`pnpm test:browser --project=media-chromium`。

### A5 不支持的编码要给出可读原因

现在 MKV 里放 HEVC 或 AC3 时，用户只看到 `STRATEGY_ALL_CANDIDATES_FAILED`——真实原因（`WEBCODECS_NOT_SUPPORTED` / `WEBCODECS_AUDIO_NOT_SUPPORTED`）只存在于决策轨迹里，UI 完全不展示。

- 让 `packages/ui/src/troubleshoot.ts` 的报告带上决策轨迹里每个候选的 `errorCode`
- 播放失败时的状态文案区分「容器不支持」「视频编码不支持」「音频编码不支持」
- 另有一个策略层的口子：`supportsRequiredWebCodecs()` 在 `context.media.query.audio === null` 时把音频视为“无要求”，于是 Vorbis 这类查不到配置的轨道会让候选先被创建、再在管线初始化时硬失败。应改为「有音频轨但拿不到可用配置」时就不产出该候选，或在候选 `reasons` 里标出来。

验收：新增单测覆盖三种编码不支持路径的错误码透出。

**已完成（2026-08-23）**：`PlayerUiPlayer` 的 telemetry 增加 `decisionTrace`，`StatsInput` 随之
带上它；`troubleshoot.ts` 新增 `playbackFailureCause()` 把逐候选错误码归成五类（视频编码 / 音频
编码 / 声道数 / 容器 / 无可用路径），报告与控制栏状态文案共用同一份判定，四语言文案齐备。轨迹的
`sessionEpoch` 与当前快照不符时忽略，避免用上一次会话的原因解释这一次的失败。环境报告新增
`videoCodec`、`audioCodec`（带声道数）、`candidates`（`候选 id:结果`）。7 条单测覆盖五类归因、
陈旧轨迹与状态文案回落。

实测（构建产物）：

| 源 | 状态文案 | 报告 |
|---|---|---|
| `flower.webm`（VP8 + **Vorbis**）切自定义档 | 「这个音频编码在此处无法解码。AAC、Opus、MP3 可以播放，AC-3、DTS、FLAC、Vorbis 不行。」 | `WEBCODECS_AUDIO_NOT_SUPPORTED`、`audioCodec: vorbis 2ch`、`candidates: webcodecs-ai:WEBCODECS_AUDIO_NOT_SUPPORTED` |
| `mp4-hevc-main10-10bit-aac.mp4` 切自定义档 | 「没有任何播放路径能处理这个媒体，因此一次尝试都没有发生。」 | `STRATEGY_NO_VIABLE_BACKEND`、`videoCodec: hvc1`、`candidates: none` |

**原第三条诊断是错的，改立为 A8。** 我原先写「`supportsRequiredWebCodecs()` 在
`context.media.query.audio === null` 时把音频视为无要求」——实际上 `createMediaCapabilityQuery()`
只要有音轨就一定构造出 `query.audio`，所以那条路走不到。真实原因是**能力探测反映的是浏览器支持，
而 `decoder-webcodecs` 自己的编码范围更窄**：Chrome 的 `AudioDecoder` 配合 CodecPrivate 能解
Vorbis，于是候选被建出来，随后 `audio-config.ts` 以「outside the Phase 5 codec scope」硬失败。
要根治得把引擎自身的编码范围传进策略层（`CapabilityContext` 已有 `wasmDecoders` 这个先例可循），
牵动 types / capabilities / strategy / core 四个包，独立成任务更稳妥。

可选的后续改进：自定义档下 HEVC 报的是「没有任何路径」，但切回原生档其实能播。轨迹里没有「原生
候选因 intent 被排除」这条信息，所以现在无法据此给出「换回原生档试试」的提示；要做得先在轨迹里
记录被 intent 排除的候选。

### A6 回归护栏与证据更新

- `pnpm test:update-counts` 更新 `docs/development/evidence/current-test-counts.json`（`pnpm test --check` 会比对数量，漏了会红）
- `pnpm quality:acceptance-drift`
- CHANGELOG 与相关验收文档补条目

**已完成（2026-08-23）**：新增验收记录
[`docs/development/render-mode-mkv-acceptance.md`](../../development/render-mode-mkv-acceptance.md)，
列出每条命令的实际结果、每项交付对应的回归护栏、手工核对项，以及未完项与环境事实。
`check-acceptance-drift.mjs` 把这份文档纳入同一条规则（必须引用生成计数、不得手写全仓总数），
并已用负例确认会中断。`phase-13-acceptance.md` 里被本轮改动作废的语料条数改为引用清单，
并加了指向新记录的说明。

**顺带修掉 Firefox 的间歇失败。** 全量跑 `media-firefox` 时带音轨的自定义路径会间歇报
`WEBCODECS_WORKER_FAILED` 或 `CUSTOM_SEEK_FAILED`，也出现过 45 s 内拿不到终态。原因不是解码缺陷，
而是本机无 GPU、Firefox 走自定义管线比 Chromium 慢约 60%，脚本化验收会撞上引擎默认的 10 s
worker/configure/flush/seek 预算。处理：验收 harness 通过公开选项把该预算提到 30 s，
`media-firefox` project 的用例超时提到 120 s，harness 内层等待提到 90 s——**没有改动出厂默认值**。
改动后连续三轮 3/3 通过，两个媒体 project 全量 30/30 通过。

## 4. B 组 — 本机可以写完，但**验收必须换有真实 GPU 的机器**

本机 WebGPU 只能拿到 `google/swiftshader`（`GPUAdapterInfo.isFallbackAdapter === true`），引擎因此一律报 `device-capability`，两个 AI 开关在本机永远是灰的。

### B1 AI 端到端开启验收

- 切到 `custom-webgpu` 档，超分辨率与插帧两个开关应可勾选
- 勾选后 `playback.ai.tier` 不为 `off`，`superResolutionEnabled` / `interpolationEnabled` 为 `true`
- 播放 A4 的 MKV 样本，画面与帧率正常，`rendererStats` 的 `droppedFrames` 不持续上升
- 关掉再开、切档、换源、seek 各走一遍，确认 epoch 与 lookahead 释放正确（`chain.ts` 的 `consumedThrough` 是这条路径的关键）

### B2 性能与画质证据

- `scripts/quality/collect-performance-baseline.mjs` 采集 1080p→4K 的每帧耗时，填进性能证据（SwiftShader 下的计时**不得**作为证据，`docs/development/webgpu-harness.md:61` 已有明文）
- 超分输出与上游 oracle 的数值比对可以在本机用 `pnpm quality:webgpu:oracle` / `pnpm quality:webgpu:rife` 跑（SwiftShader 做纯计算是可信的），**只有实时性与画面观感需要真机**
- 起播时间：本机实测 `play()` → `state: playing` 在无音轨时约 2.2 秒、带 Opus 音轨时约 5.9 秒（见 A3b）。
  需要在真机上复量并判断是否要优化 `startBufferDuration` 与首帧路径。

### B3 真实浏览器矩阵

`tests/browser/evidence/real-browser-matrix.json` 里 Chrome / Edge / Firefox 的 WebGPU 行需要在有 GPU 的机器上补齐；`pnpm quality:browsers` 会拒绝把模拟浏览器写成真实平台证据。

## 5. C 组 — 当前环境不支持开发/验证

| 项 | 原因 | 处置 |
|---|---|---|
| 硬件 WebGPU | 本机显卡是 NVIDIA GeForce GT 705（Fermi，驱动 23.21.13.9135），没有 D3D12/Vulkan 后端；强制 `--use-angle=vulkan` 时连适配器都拿不到；且会话在 RDP 下 | 全部归入 B 组，换机器验收 |
| 实时帧率 / 硬件解码 | 无可用 GPU 解码器，SwiftShader 是 CPU 光栅化器 | 同上 |
| HEVC 视频 | `packages/decoder-webcodecs/src/video-config.ts` 显式拒绝（`WEBCODECS_NOT_SUPPORTED`），且本机无 HEVC 硬件解码可验证 | 属于新增编解码范围，不在本任务内；本任务只保证 A5 的可读报错 |
| AC3 / E-AC3 / DTS / TrueHD / FLAC 音频 | `audio-config.ts` 只覆盖 AAC / Opus / MP3 | 同上 |
| Safari / iOS / macOS | 无设备；Playwright WebKit 只能作为自动化证据，不能当平台证据 | 保持 pending |

## 6. 建议的 PR 切分

1. `fix(audio): ship a self-contained AudioWorklet module` — A1 ✅ 已完成
2. `fix(core): hold decoded PCM the audio transport cannot take yet` — A1b ✅ 已完成
3. `feat(ui): add a render-mode control to the settings panel` — A2 ✅ 已完成
4. `feat(demo): wire the render-mode switch and the AI model root` — A3 ✅ 已完成
5. `test(quality): add Matroska fixtures and media coverage` — A4 ✅ 已完成
6. `fix(ui): explain why a load failed instead of showing a generic error` — A5 ✅ 已完成
7. `chore(quality): refresh test counts and evidence` — A6 ✅ 已完成
8. `feat(demux): derive a full VP9 codec string` — A7（A4 的计划外发现，独立工作）
9. `fix(strategy): stop ranking a backend whose codec scope the engine will reject` — A8（A5 的计划外发现，跨四个包）

**A 组全部完成。** 剩下的 A7 / A8 是这轮挖出来的两个独立缺陷，都不阻塞 MKV + AI 的最终验收；
真正的终局验收（AI 开关端到端、性能与画质、真实浏览器矩阵）在 B 组，需要一台有真实 GPU 的机器。

## 7. 最终验收清单（demo 里要能看见的）

1. 设置面板里有「渲染模式」三档，切换即时生效，诊断面板的渲染器随之变成 `native` / `webgpu` / `webgl2`
2. 载入 MKV（H.264+AAC）时三档都能正常播放**且有声音**；`native` 档下两个 AI 开关灰掉。载入 MKV（VP9+Opus）时 `native` 档明确报「容器/编码不支持」，两个自定义档正常播放
3. `custom-webgpu` 档下超分辨率与插帧两个开关可勾选，勾上后画面变化可见、`playback.ai.tier` 不为 `off`
4. `custom-fallback` 档下两个开关灰掉，原因显示「把渲染模式切换到 WebGPU 自定义管线后才能开启」
5. 部署到 Pages 的版本里，两个开关灰掉并显示「宿主未配置 AI 模型根目录」——这是权重不上 CDN 的既定策略，不是缺陷

## 附录：本机环境事实（用于判断 A/B/C 归属）

| 项 | 值 |
|---|---|
| WebGPU 适配器 | `google/swiftshader`，`isFallbackAdapter: true`；`--use-angle=vulkan` 下无适配器 |
| 显卡 | NVIDIA GeForce GT 705（1 GB，驱动 23.21.13.9135）+ Microsoft Remote Display Adapter |
| WebCodecs | `VideoDecoder` 支持 vp8 / vp09 / avc1；`AudioDecoder` 支持 opus / mp4a.40.2 |
| Chrome 原生 MKV | `video/x-matroska; codecs="avc1…,mp4a.40.2"` → `probably`、`decodingInfo.supported = true`；`codecs="vp9,opus"` → 空串（不支持）。所以默认 `normal` intent 下 MKV/H.264 会走原生、AI 不会启用——这正是需要渲染模式开关的原因 |
| AudioWorklet | 可用（`AudioContext.state = running`，`addModule` 10–18 ms） |
| 跨源隔离 | demo 默认不开；`?wasmAcceptance=isolated` 等路由会带上 COOP/COEP |
| 工具链 | ffmpeg 9.0、pwsh 7、Playwright chromium（`channel: 'chromium'` + `--enable-unsafe-webgpu`） |
| 浏览器工具限制 | 本仓库禁用 `preview_*` 工具（会杀 GPU 进程）；一律用 Bash + headless Playwright |

