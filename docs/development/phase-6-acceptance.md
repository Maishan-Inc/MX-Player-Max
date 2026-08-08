# Phase 6 验收记录

日期：2026-08-08

## 实现状态

Phase 6 已实现 `Demux Worker -> VideoDecoder -> bounded VideoFrame queue -> VideoFrameScheduler -> WebGPU/WebGL2/Canvas2D Renderer -> canvas`。有音轨时继续使用 Phase 5 AudioContext sample clock，无音轨时使用 MediaWallClock。`readVideoFrame()` 的即时 pull、epoch 和外部调用方所有权保持不变。

本机 fake API、TypeScript、Vitest、构建和静态检查已完成。当前环境未执行真实 Chrome/Chromium、Firefox、macOS Safari 的硬件 GPU/VideoFrame smoke；这些项全部明确标记 pending。

## 公共 API

- `VideoRendererPreference`: `auto | webgpu | webgl2 | canvas2d`。
- `VideoFilterOptions`: `none | grayscale | brightness | contrast | saturate`，参数有限、校验并限幅，不生成动态 shader。
- `VideoTransformOptions`: crop、0/90/180/270 rotation、contain/cover/fill、成对 output size、DPR。
- `CustomVideoOptions`: 增量增加 `renderer`、`render`、`filter`、`preserveHdr`。
- `RendererCapabilities`、`RendererState`、`RendererStats` 和稳定 `RENDERER_*` 错误码。
- `MediaEngine`/`MXPlayer`: 只读 `rendererKind`、`rendererState`、`rendererStats`，以及 `setVideoFilter()`、`setVideoTransform()`。
- `rendererchange`、`rendererstatechange`、`rendererstats` 只发送 backend/state、计数、尺寸、颜色/HDR/filter 状态，不发送 Frame、texture、像素、AudioData、PCM、URL 或原始平台异常。

Phase 6 支持 load-time Native/Custom selection。非 `none` load-time filter 会把 normal/low-power intent 提升为 `filters`，从候选阶段排除纯 Native。运行时 Native -> Custom 以及关闭 filter 后自动迁回 Native 尚未实现；Native 活跃时 `setVideoFilter()` 返回 `RENDERER_BACKEND_UNAVAILABLE`，应用必须重新 `load()`。这项限制在 types/core/sdk/architecture 文档中公开，不虚假声明自动切换。

## Renderer 架构与 fallback

`packages/renderers` 只依赖公共 types 和浏览器 canvas/GPU API，不依赖 demux、decoder、core、audio、demo 或框架。保留 `VideoRenderer`/`RendererFactory` 入口，并增加 `ManagedVideoRenderer`。

| Backend | 消费路径 | Filter | HDR 声明 | Loss recovery | Auto 顺序 |
|---|---|---|---|---|---|
| WebGPU | `copyExternalImageToTexture` -> reusable texture -> fixed WGSL pipeline | 五种固定 filter | Phase 6 无端到端 display-HDR 确认，`hdrPreserved=false` | `device.lost` 后原地 rebuild；失败 fallback | 1 |
| WebGL2 | `texImage2D(VideoFrame)` -> reusable texture -> fixed GLSL program | 同上 | `hdrPreserved=false` | context lost/restored rebuild；超时/失败 fallback | 2 |
| Canvas2D | `drawImage(VideoFrame, ...)` | 同语义 CSS filter | `hdrPreserved=false` | 无 GPU context recovery；作为最小可观看终点 | 3 |

显式 preference 的初始不可用或初始化失败使用稳定错误，不静默改变用户选择。`auto` 初始化失败会继续下一个 backend。运行时 WebGPU device loss 先尝试同 backend 重建；只有 `RENDERER_DEVICE_REBUILD_FAILED` 才 fallback。WebGL2 context loss 阻止默认销毁并等待 restore/rebuild，无法恢复时进入 fallback。fallback 写入事件和 `fallbackCount`，不改变 decoder epoch，也不重复消费当前 Frame。

## Frame 所有权

- Queue 中 Frame 归 CustomMediaPipeline。
- `readVideoFrame()` resolve 后归调用方；调用方负责恰好 close 一次。Renderer 不会关闭尚未传给它的外部 Frame。
- `renderer.render(frame)` 接受后临时接管；上传/绘制成功、参数非法、device/context lost 或 close 后迟到路径都 close 一次。
- Scheduler `drop`、stale epoch 和 seek generation 由 render-loop close；`wait` 保留到下一次 rAF；`present` 才转交 Renderer。
- 同一个 Frame 对象不能重复 render；第二次返回 `RENDERER_FRAME_INVALID` 且不重复 close。
- GPU upload 异常在 finally 关闭当前 Frame，创建失败/重建/close 同时释放 texture/buffer/program/VAO/listener/timer。

## 色彩、HDR、crop、rotation 与尺寸

`VideoFrame.colorSpace` 存在时记录 SDR BT.709/sRGB 和 full/limited/unknown range。PQ/HLG 才视为 HDR transfer；BT.2020 primaries 本身不作为 HDR 证明，未知 metadata 保持 unknown。Phase 6 不做像素 readback 猜测，也不虚假声明 P3/PQ/HLG/HDR 保真。

width/height/output size 必须为正安全整数；crop 的 x/y 非负且 rectangle 位于 display/coded bounds；rotation 只允许 0/90/180/270；DPR 必须有限且 `(0, 8]`。canvas backing dimension 硬上限 16,384，同时受 `GPUDevice.limits.maxTextureDimension2D`/WebGL `MAX_TEXTURE_SIZE` 限制。Canvas2D/WebGL2 明确返回 `hdrPreserved=false` 和原因。正常路径禁止 `readPixels()`/`getImageData()` 全帧回读。

## Scheduler、时钟与生命周期

CustomRenderLoop 使用可注入 rAF/cancel rAF 和 Phase 5 `VideoFrameScheduler`，同时最多一个 in-flight read Promise 与一个 retained Frame。主时钟优先 AudioContext 实际消费 sample frame；无音频使用可 pause/resume/seek/rate 的墙钟。rAF 只是唤醒机制，不是媒体时钟。

`wait` 保留；`present` render 并 close；`drop` 统计 late drop 并 close。pause 停止新 feed/read/render，resume 不创建第二个 loop。倍速只改变既有 clock mapping/AudioWorklet consumption，不增加解码并发。seek 停止旧 loop、提升共享 epoch、关闭 retained/stale/pending-read result，在新 epoch ready 后按原状态恢复。EOS 仍由 Custom pipeline 等 VideoDecoder/frame queue 和 AudioDecoder/PCM 真正 drain 后发出，Renderer 不提前发 ended。

## Target 与清理

- caller canvas 原样复用。
- container 增加一个 owned canvas，不清除既有 children；teardown 只删除 owned canvas/未使用 owned video。
- caller video 在 Native path 原样复用；Custom path 临时以 canvas 替换并在 teardown 恢复，不创建隐藏 HTMLVideo。
- close/source replacement 取消 rAF、使 pending read generation 失效、close retained/late Frame、释放 GPU/GL/Canvas context 引用、listener、restore timer、owned canvas，然后关闭 decoder/audio/worker/pending operations。
- closed/旧 load epoch 后不再转发 renderer、frame、state、error 或 clock 事件。

## 自动化测试

测试只使用代码构造的 fake GPUAdapter/GPUDevice/GPUQueue/GPUTexture/GPUCanvasContext、可控 `device.lost`、fake WebGL2/context lost/restored、fake Canvas2D/canvas/VideoFrame、fake rAF/clock/RendererFactory。没有访问真实站点或真实浏览器 GPU，没有第三方媒体样本。

覆盖 auto/explicit selection、WebGPU 初始化/resize/upload/device loss/rebuild failure fallback、WebGL2 context loss/restore、Canvas2D draw、每种 filter、非法参数、rotation、crop/DPR/尺寸、SDR range/unknown metadata/HDR false、Frame exact-close/duplicate/late close、scheduler wait/present/drop、单 in-flight read、pause/resume/seek generation/stale frame、target ownership、Core audio/video clock integration、Native 回归和 SDK proxy。

2026-08-08 最终全仓实际通过 **289** 项测试：types 16、audio 32、capabilities 16、decoder-webcodecs 57、demux 43、platform 3、postprocess 6、renderers 16、strategy 10、core 88、sdk 2。decoder-wasm、subtitles、React 和 Vue 当前没有测试文件，Vitest 以 `--passWithNoTests` 验证包级命令可执行，不计入通过数量。

## 四项阶段验收

| 命令 | 2026-08-08 结果 | 记录 |
|---|---|---|
| `pnpm typecheck` | passed | 16 个参与 workspace 项目的 build 与 strict TypeScript typecheck 均退出 0 |
| `pnpm test` | passed | 289 tests passed；无失败、跳过或真实站点访问 |
| `pnpm build` | passed | 全部可构建包与 demo production build 退出 0 |
| `git diff --check` | passed | 无 whitespace error；Windows 工作树仅报告预期 LF→CRLF 提示 |

## 静态审计

静态审计通过：TypeScript/TSX 源码没有 `any` 类型（仅 postprocess 英文注释出现普通单词 “any”）；无 ScriptProcessor、`decodeAudioData()`、AudioBufferSourceNode；Custom Renderer 不创建隐藏 HTMLVideo；无常规 `readPixels()`/`getImageData()` 全帧回读；无 `setInterval()` 或 renderer/core/sdk `console.*` 敏感日志；无跨包内部引用或文件扩展名 Codec 推断。Frame queue、retained frame、in-flight read、GPU texture、fallback Promise 和既有 MessagePort/Demux queues 均有硬上限；VideoFrame、GPUDevice/GPUTexture/GPUBuffer、WebGL program/texture/buffer/VAO、canvas listener、rAF、restore timer 和迟到 Promise 都有 close/epoch/generation 清理路径。

## 浏览器 smoke matrix

| 环境 | 状态 | 待验证内容 |
|---|---|---|
| Chrome/Chromium 最新两个稳定大版本 | pending | WebGPU/WebGL2/Canvas2D、VideoFrame upload、SDR/HDR、resize/DPR、filters、device/context lost、autoplay、seek、underrun、EOS、close、30 分钟 drift、CPU/内存/功耗代理指标 |
| Firefox 最新两个稳定大版本 | pending | WebGPU availability、WebGL2/Canvas2D、WebCodecs Frame upload、SDR/HDR false、resize/DPR、filters、context lost、autoplay/seek/underrun/EOS/close、30 分钟 drift、CPU/内存/功耗代理指标 |
| macOS Safari 最新两个稳定大版本 | pending | WebGPU/WebGL2/Canvas2D、VideoFrame upload、SDR/HDR platform path、resize/DPR、filters、device/context lost、AudioDecoder availability、autoplay/seek/underrun/EOS/close、30 分钟 drift、CPU/内存/功耗代理指标 |

本机 Vitest/fake GPU 不能替代真实浏览器、硬件 adapter/device、显示器色彩管理、VideoFrame upload、用户手势 autoplay、声卡 sample clock、跨源隔离和 CORS/Range 服务器证据。

## 后续边界

Phase 7 才在 decoded frame 与 Renderer 之间接入 AI 插帧/超分；Phase 8 才实现独立字幕 overlay。Phase 6 不包含 WASM Decoder、MSE、HLS/DASH、直播、录制、DRM、UI controls 或字幕内核。
