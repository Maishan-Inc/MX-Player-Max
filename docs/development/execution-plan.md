# MX-Player-Max 分阶段执行计划

## 1. 执行原则

项目不采用“大分支一次性开发”。每个阶段都必须独立完成、独立测试、独立评审，再进入下一阶段。

每个阶段必须同时提交：

- 实现代码或接口变更。
- 单元测试和必要的媒体样本。
- 架构文档、公共 API 文档和变更记录。
- 一个可运行的演示或诊断入口。
- 阶段验收记录。

阶段之间采用硬门禁：上一阶段没有达到退出条件，不开始下一阶段的实现。允许提前设计后续阶段接口，但不提前实现后续阶段内部逻辑。

本文件是阶段编号的唯一权威。`roadmap.md` 是同一套编号的概览视图，`docs/ai/` 与各 ADR 引用的阶段号均以本文件为准。

## 2. 阶段总览

```text
Phase 0  规范与脚手架              已完成
Phase 1  公共类型与能力探测        实现完成，三浏览器验收待执行
Phase 2  Range Loader 与容器抽象       实现完成，三浏览器验收待执行
Phase 3  NativeMediaPipeline          实现完成，三浏览器验收待执行
Phase 4  WebCodecs CustomMediaPipeline  实现完成，三浏览器验收待执行
Phase 5  音频时钟与 AudioWorklet
Phase 6  WebGPU/WebGL2/Canvas2D 渲染器（实现完成，浏览器验收待执行）
Phase 7  AI 后处理（插帧与超分）
Phase 8  SRT/ASS 字幕内核
Phase 9  UI 包（控制条、字幕菜单、主题）
Phase 10 WASM Decoder Manager
Phase 11 浏览器平台优化
Phase 12 SDK、演示站与发布
Phase 13 质量、安全和性能固化
```

## 3. Phase 0：规范与脚手架

状态：已完成。

### 已交付

- `AGENTS.md` 工程规范。
- 架构、Codec、音频、字幕、WASM、浏览器和安全文档。
- pnpm Monorepo 与 15 个包。
- SDK、React、Vue 和平台策略入口。
- GSAP 演示站、Docker/Nginx 和 GitHub Actions。

### 退出条件

- `pnpm build` 通过。
- `pnpm typecheck` 通过。
- `pnpm test` 通过。
- 所有包有明确边界和 README。

## 4. Phase 1：公共类型与能力探测

目标：在不加载任何真实解码器的情况下，建立稳定的媒体数据契约和能力快照。

### 任务

1. 完善 `@mx-player-max/types` 的时间戳、轨道、Codec 配置、事件和错误码。
2. 实现浏览器类型、版本、操作系统和 GPU 信息的非敏感快照。
3. 实现 HTMLVideo、MediaCapabilities、WebCodecs、WebGPU、WebGL2、WASM SIMD/Threads 检测。
4. 实现浏览器能力缓存和 SDK 版本隔离。
5. 建立 Chromium、WebKit、Gecko 平台策略接口，但不写 Codec 硬编码映射。
6. 实现确定性的 Backend Scorer。

### 测试

- 能力 API 缺失时返回完整降级快照。
- 非跨源隔离页面不报告 WASM Threads 可用。
- 相同输入快照得到相同排序。
- 平台策略只能改变候选评分，不得创建不存在的能力。

### 退出条件

- Chrome、Firefox、Safari 桌面都能生成结构一致的 `CapabilitySnapshot`。
- 策略单元测试覆盖普通播放、滤镜、HDR、无 WebGPU、无 WebCodecs、非隔离 WASM。
- 没有加载 WASM 或发起远程媒体请求。

## 5. Phase 2：Range Loader 与容器抽象

目标：在 Worker 中可靠读取远程/本地文件，并输出统一轨道与压缩包。

### 任务

1. 实现 File Range Loader 和 HTTP Range Loader。
2. 实现 CORS、206、Content-Range、未知长度和服务器不支持 Range 的错误转换。
3. 实现请求取消、重试、并发窗口和有界缓存。
4. 定义 `ContainerAdapter` 和 `DemuxPacket` 接口。
5. 先实现 Matroska/MKV 探测和轨道元数据。
6. 接入 MP4/WebM 容器适配器。
7. 解析关键帧索引或提供可控的前向扫描回退。

### 测试

- Range 边界、断网、服务器返回 200、错误 Content-Range。
- 本地文件与远程 URL 的元数据一致性。
- 大文件只读取必要范围，不整文件下载。
- Worker 关闭后没有未完成请求和消息泄漏。

### 退出条件

- 读取样本的 container、duration、轨道、Codec 私有数据和关键帧信息。
- 可在无解码器情况下输出可视化 Probe 面板。

## 6. Phase 3：NativeMediaPipeline

目标：先交付最低功耗、最高兼容性的普通文件播放路径。

### 任务

1. 创建 HTMLVideo 生命周期适配器。
2. 根据 MIME/Codec 候选设置 source、`crossOrigin`、预加载和错误监听。
3. 实现播放、暂停、seek、倍速、音量、静音、全屏和原生 PiP 能力检测。
4. 接入统一媒体事件和错误码。
5. 保持字幕层、控制层和视频元素独立。
6. 使用 `requestVideoFrameCallback` 作为可选统计信号，不把它当作 VideoFrame 输出。

### 测试

- MP4 H.264/AAC、WebM VP8/VP9/Opus。
- Safari 原生 HLS 能力只作为未来适配测试，不扩大文件阶段范围。
- 跨域源 CORS、自动播放策略和用户手势限制。

### 退出条件

- 常见 MP4/WebM 在三种桌面浏览器稳定播放。
- 不支持的容器/Codec 返回可解释的候选失败，而不是黑屏。

## 7. Phase 4：WebCodecs CustomMediaPipeline

目标：建立逐帧、可 seek、可处理的自定义视频管线。

状态：实现完成；本机 TypeScript/Vitest/构建验收已通过，真实 Chrome/Firefox/macOS Safari smoke matrix 待具备浏览器与设备的 CI 环境执行。

### 任务

1. Demux Worker 输出带时间戳和关键帧标记的包。
2. 实现 VideoDecoder Adapter 和 Decoder Queue。
3. 实现 frame queue、背压、丢帧和 End Of Stream。
4. 实现 seek epoch、关键帧定位和 decoder reset。
5. 实现 H.264、VP8、VP9、AV1 的 WebCodecs 配置转换。
6. 保持视频管线与音频时钟接口独立。

### 退出条件

- 能逐帧输出 `VideoFrame`。
- 暂停、恢复、seek、连续 seek 不产生旧 epoch 画面。
- 主线程不会因为解码队列增长而无界占用内存。

### 已交付约束

- 复用 Phase 2 Demux Worker 协议与压缩 packet，不复制 Range/容器实现。
- H.264 avcC、VP8、完整 VP9/AV1 RFC6381 配置 allowlist；Phase 4 范围外 Codec 稳定拒绝。
- 默认 8 Frame、8 decode queue、1 秒 buffered duration、低水位 3 的有界背压。
- pull-based `readVideoFrame()` 与明确 VideoFrame close 所有权。
- seek reset/reconfigure、关键帧起始、preroll drop、连续 epoch 原子失效。
- Demux EOS 后 flush，flush output 继续入队，queue 耗尽后才 ended/null。
- Phase 4 不创建音频、时钟、Renderer、WASM、MSE 或流媒体管线。

## 8. Phase 5：音频时钟与 AudioWorklet

目标：让自定义视频管线具备可长时间稳定的音频输出。

状态：实现完成；本机 TypeScript/Vitest/构建验收通过。真实 Chrome、Firefox、macOS Safari 最新两个稳定版本及 30 分钟 drift/CORS Range/autoplay smoke 需外部浏览器矩阵执行，当前标记 pending。

### 任务

1. 实现 WebCodecs `AudioDecoder` Adapter。
2. 实现 PCM 标准化、采样率转换和声道布局。
3. 实现 AudioWorklet Processor 和有界 PCM ring buffer。
4. 以 AudioContext 时钟驱动视频显示。
5. 实现缓冲欠载、过量、seek、暂停和音量控制。
6. 建立无音频文件的墙钟回退。

### 退出条件

- AAC/Opus/MP3 样本可以连续播放 30 分钟而不明显漂移。
- 在非跨源隔离环境中使用 MessagePort 缓冲仍能播放。
- 音频解码失败时错误边界明确，不能静默播放错误数据。

### 已交付约束

- AAC/Opus/MP3 AudioDecoder 配置来自 Probe 的 codec/codecPrivate/sampleRate/channels；不猜测扩展名、MIME 或未知布局。
- AudioData → Float32 PCM → stateful resampler → bounded ring/MessagePort/SAB → AudioWorklet → GainNode；SAB 只在隔离能力确认后启用。
- AudioContext sample clock 只按实际消费 sample frame 推进；无音频使用 monotonic wall clock；seek/连续 epoch/EOS drain/close 都覆盖统一生命周期。
- Phase 5 建立 `VideoFrameScheduler` 的 wait/present/drop 契约，但不创建 Renderer，不改变 `readVideoFrame()` pull/ownership。

## 9. Phase 6：WebGPU/WebGL2/Canvas2D 渲染器

目标：提供高级帧处理能力，同时保证没有 WebGPU 时仍可观看。

状态：实现完成；公共 API、三种 Renderer、rAF scheduler、Core/SDK 集成、fake API 测试与本机 TypeScript/Vitest/构建验收已交付。真实 Chrome/Chromium、Firefox、macOS Safari 最新两个稳定版本和 30 分钟 drift/CPU/内存/功耗 smoke 待外部浏览器矩阵执行，当前标记 pending。

### 任务

1. 实现 WebGPU Renderer 和设备丢失重建。
2. 实现 WebGL2 Renderer。
3. 实现 Canvas2D 最小降级渲染器。
4. 定义 VideoFrame → Texture 的色彩、旋转、裁剪和尺寸策略。
5. 添加滤镜接口，但先实现少量可验证滤镜。
6. 记录 HDR 是否保真，不对不支持的环境虚假宣称 HDR。

### 退出条件

- WebGPU、WebGL2、Canvas2D 依次降级。
- 滤镜开启时自动切换自定义路径，关闭后可回到 NativeMediaPipeline。
- Renderer close 后释放 GPU 资源和 VideoFrame。

### 已交付约束

- `auto` 使用 WebGPU -> WebGL2 -> Canvas2D；显式 preference 初始不可用时稳定失败。WebGPU device lost 先原地重建，失败再 fallback；WebGL2 context lost 先等待 restore/rebuild。
- 固定 WebGPU/WGSL、WebGL2/GLSL 与 Canvas2D `drawImage` 路径，支持 none/grayscale/brightness/contrast/saturate、crop、0/90/180/270 rotation、contain/cover/fill、DPR 和 16,384/texture 双重尺寸上限。
- SDR BT.709/sRGB、full/limited/unknown range 与保守 HDR 统计；WebGL2/Canvas2D 不声明 HDR 保真，未知 metadata 不猜测。
- rAF loop 同时最多一个 read Promise 和一个 retained frame，继续使用 Phase 5 AudioContext sample clock/MediaWallClock 与 VideoFrameScheduler wait/present/drop。pause/resume/rate/seek/epoch/EOS 不创建额外解码并发。
- `readVideoFrame()` 即时 pull/epoch/外部所有权不变；Renderer 仅对传入 `render(frame)` 的 frame 负责，并在所有路径恰好 close 一次。
- caller canvas 复用；container 只增加 owned canvas 且不清 children；caller video 在 Custom 生命周期内被 canvas 替换并在 teardown 恢复，不创建隐藏 HTMLVideo。
- Core/SDK 暴露 renderer kind/state/stats、稳定事件及 filter/transform API；事件不携带 Frame、texture、像素、PCM、URL 或原始平台错误。
- Phase 6 只实现 load-time Native/Custom path selection。运行时关闭滤镜并自动迁回 Native 尚未实现；Native 上调用 `setVideoFilter()` 稳定返回 `RENDERER_BACKEND_UNAVAILABLE`，应用需重新 load。
- Phase 7 AI postprocess 与 Phase 8 subtitle overlay 保持独立后续边界。

## 10. Phase 7：AI 后处理（插帧与超分）

目标：在已解码的 `VideoFrame` 之上提供帧变换层，失败必须降级为正常播放。

与解码后端正交——AI 消费解码产物，不属于任何解码分支。依赖 Phase 4（帧队列）、Phase 5（音频时钟）、Phase 6（WebGPU 渲染器）全部完成。

契约层已在 Phase 0/1 落地：`packages/postprocess` 存在 passthrough 骨架，类型与能力探测已就绪。本阶段实现真实算子。

### 任务

1. 实现超分 WGSL：RT4KSR 通用档 + Anime4K-WebGPU 动画档。
2. 实现运行时 governor：按帧预算动态升降档位。
3. 实现插帧 WGSL：RIFE，含前瞻、epoch、seek 与 EOS 处理。
4. 实现拉取式帧源——呈现循环按音频时钟从后处理链拉取帧，不用推送式滤镜。
5. 把 Phase 10 的 manifest schema、加载器和哈希校验提前到本阶段（发布渠道仍留在 Phase 10）。
6. 完成模型许可证与专利审查，不得推迟到发布阶段。

### 测试

- WebGPU 不可用、fallback adapter、设备丢失三种情况均干净回退 passthrough。
- 档位变化作为 SDK 事件上报，不静默降级。
- 连续 seek 不出现旧 epoch 的插帧结果。

### 退出条件

- 管线顺序为 色彩转换 → 插帧 → 超分 → 滤镜 → 渲染 → 字幕覆盖。
- AI 失败降级为正常播放而非中断。
- 每个模型权重有许可证、来源和哈希记录。
- HTMLVideo 原生路径明确不支持 AI，且在候选阶段就排除，不在运行时才失败。

详见 `docs/ai/` 与 `ADR-0003`。

## 11. Phase 8：SRT/ASS 字幕内核

目标：交付可复用的字幕解析与渲染内核。菜单与样式编辑器属 Phase 9 的 UI 包，本阶段只做内核。

### 任务

1. 实现 SRT、ASS/SSA 解析器。
2. 接入内嵌字幕包和外挂字幕 URL/File。
3. 实现轨道枚举、切换和关闭的引擎 API。
4. 定义字幕样式数据模型与持久化接口，按播放域名分作用域。
5. 让字幕覆盖层同时适配 NativeVideo、WebGPU、WebGL2 和 Canvas2D。
6. 对未实现的 ASS 动画、绘图和卡拉 OK 明确降级。

### 退出条件

- 字幕由媒体时钟驱动，seek 后立即显示正确 cue。
- SRT/ASS 输入不会执行 HTML 或脚本。
- 多条重叠 cue 按稳定顺序渲染。
- 内核不含任何 DOM 控件——菜单、字体选择器、拖拽句柄都不在本阶段。

## 12. Phase 9：UI 包

目标：让开发者装上即用，不必自己写控制条。

引擎渲染到 `<canvas>` 时浏览器的 `controls` 属性无效，不提供 UI 包等于开发者必须从零写控件。决策依据见 `ADR-0004`。

### 任务

1. 建立 `packages/ui`，用框架无关的原生 DOM 实现，不依赖 React。
2. 实现控制条：左组播放/下一集/音量，右组字幕/画中画/剧场/设置/全屏。
3. 实现进度条与悬停预览。
4. 实现字幕菜单（轨道页 + 字体页）与样式编辑器，含拖拽调节位置和大小。
5. 实现设置、统计、关于三个浮层面板。
6. 实现主题：全部可调值走 CSS 自定义属性，类名统一 `mxp-` 前缀。
7. 独立分发 `style.css`，不注入 `<style>`，不用 CSS-in-JS。
8. 让 `@mx-player-max/react` 与 `@mx-player-max/vue` 封装 SDK + UI。

### 测试

- 同一套 UI 在 NativeMediaPipeline（`<video>`）与 CustomMediaPipeline（`<canvas>`）下行为一致。
- 键盘可完整操作，焦点顺序稳定，控件有 `aria-label`。
- 不引入 UI 包时 SDK 产物体积不变。

### 退出条件

- 引擎不反向依赖 UI，依赖方向单向。
- 外观参考 MX-Player-Pro 的交互模式，不复制其源文件与演示站视觉。
- 字幕样式按域名分作用域持久化，存储不可用时静默回退默认值。

## 13. Phase 10：WASM Decoder Manager

目标：在 WebCodecs 不支持或不适合时提供模块化软件解码。

### 任务

1. 建立 Codec Decoder Registry 和 manifest。
2. 接入 OpenH264、libde265、dav1d、libvpx、VVdeC 插件。
3. 实现 FFmpeg 最后兜底插件。
4. 实现单线程、SIMD、多线程变体选择。
5. 实现 WASM 哈希校验、懒加载、Cache Storage 和版本失效。
6. 为每个二进制补许可证和供应链资料。

### 退出条件

- 非隔离页面自动使用单线程。
- 隔离页面优先使用多线程，初始化失败自动回退。
- 未选中的 Codec 不下载对应 WASM。
- 所有发布二进制完成许可证审查。

## 14. Phase 11：浏览器平台优化

目标：在通用策略正确后加入平台增强，而不是反过来依赖 User-Agent。

### Chromium

- WebGPU 外部纹理和 Worker MediaSource 能力探测。
- 记录 WebCodecs 硬件/软件选择结果。

### WebKit

- 原生 HLS、HEVC/HDR、AirPlay/PiP 能力增强。
- 为未来 HLS/DASH 接入 ManagedMediaSource。

### Gecko

- `fastSeek` 和标准播放质量指标。
- Firefox 专属帧统计只进入诊断数据。

### 退出条件

- 浏览器策略测试覆盖平台特性缺失和版本变化。
- 删除或禁用平台特性不会破坏通用路径。

## 15. Phase 12：SDK、演示站与发布

目标：让第三方可以通过 npm、jsDelivr 或一行 `<script>` 接入，并让 Docker 演示展示真实引擎能力。

### 任务

1. 完成原生 SDK API、React 适配器和 Vue 适配器。
2. 增加 UMD/IIFE 构建产物。`tsc` 只出 ESM，必须引入 Rollup 或 esbuild 才能产出 `<script src>` 可用的单文件，全局名 `MXPlayerMax`。
3. 补齐发布元数据：`exports` 条件导出、`unpkg`、`jsdelivr`、`sideEffects: false`，UI 包额外导出 `./style.css`。
4. 演示站消费 `@mx-player-max/ui`，并加入真实 Probe、Backend Decision、Decoder、Renderer 和 Subtitle 面板。
5. GSAP 动画只服务于产品叙事，不能阻塞播放器初始化。
6. Docker 演示站启用 COOP/COEP。
7. GitHub Actions 构建、测试、打包、生成 manifest 并用 `pnpm publish -r` 发布。`workspace:*` 依赖必须由 pnpm 改写为真实版本号，直接 `npm publish` 会产出装不上的包。
8. 发布固定版本的 jsDelivr ESM 与 UMD 两套接入示例，并提供 SRI 哈希。

### 退出条件

- npm、jsDelivr、UMD `<script>`、自托管 WASM 四种接入方式均有文档。
- 无构建工具的页面能用一行 `<script>` 得到可播放且带控件的播放器。
- Demo 可以展示为什么选择某个后端。
- Demo 不依赖 MX-Player-Pro 的实现文件或演示站视觉布局。

## 16. Phase 13：质量、安全和性能固化

### 任务

- 三浏览器自动化回归。
- Codec/容器/音频/字幕样本矩阵。
- 断网、Range 错误、坏文件、内存压力和设备丢失测试。
- 首帧、首音、seek、Dropped Frames、漂移和内存基线。
- WASM 哈希、许可证、CSP、CORS/CORP 和日志隐私审计。

### 最终发布门禁

- 所有 P0/P1 浏览器回归通过。
- 无未解释的内存增长和音画漂移。
- 所有公开包有 API 文档和变更记录。
- 所有 WASM 产物有来源、哈希和许可证资料。
- Docker 镜像可构建，非隔离环境可以单线程运行。

## 17. 每阶段的 Git 工作方式

每个阶段使用独立分支和小 PR：

```text
feat/phase-1-capabilities
feat/phase-2-demux
feat/phase-3-native-pipeline
```

PR 必须只覆盖一个阶段，合并前完成类型检查、单元测试、文档和阶段验收记录。禁止为了通过阶段验收顺手修改无关 UI 或 Codec。
