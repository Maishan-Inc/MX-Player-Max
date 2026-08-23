# Changelog

## Unreleased

### Added

- AI 后处理运行时开关：`MediaEngine.setAiPostProcess({ interpolation?, superResolution? })` 与
  `PlaybackSnapshot.ai`（`{ tier, interpolation, superResolution }`，每个 stage 带
  `enabled/available/unavailableReason`）。stage 懒构造，第一次开启超分才拉取并校验模型；
  原生或非 WebGPU 会话以 `RENDERER_AI_UNSUPPORTED` 拒绝，`PlaybackChangeReason` 新增 `ai`。
- 播放器设置面板新增「AI 增强」一节，插帧与超分两个独立开关（`features.aiPostProcess`，默认开启），
  不可用时保持可见但禁用并给出原因（渲染路径 / 缺模型根目录 / 无 WebGPU 适配器 / 尚未实现），
  四语言文案齐备。插帧当前恒为 `not-implemented`，不会把未验证输出交给用户。
- 真实 WGSL 执行门禁：`pnpm quality:webgpu`（17 个 kernel 通过 Dawn/Tint 编译 + rgba16float 存储往返）、
  `pnpm quality:webgpu:numerics`（kernel 对 CPU 参考）、`pnpm quality:webgpu:oracle`（shipped
  `Rt4kSrGraphExecutor` 对上游 RT4KSR forward，端到端 `max |delta| = 3.7e-3`）。
  `packages/postprocess/tools/generate_rt4ksr_reference.py` 生成逐层参考张量。
- RIFE 4.25 算子与 oracle：新增 `PACKED_TRANSPOSED_CONVOLUTION`、`PACKED_RESIZE`、`PACKED_WARP`、
  `PACKED_PIXEL_SHUFFLE_2`、`PACKED_MASK_BLEND` 五个 kernel，卷积的 LeakyReLU 斜率改为可配置；
  `packages/postprocess/tools/generate_rife_reference.py` 从 vendored 归档还原上游 `IFNet` 并逐 stage
  导出参考张量，`pnpm quality:webgpu:rife` 对其验证 `Head`（含 `ConvTranspose2d`）`8.9e-4`、
  `grid_sample` 反向 warp `1.2e-3`、`align_corners=False` 双向 resize `5.1e-4`。IFBlock body、
  五级 flow 累积、graph IR 与最终 blend 仍未实现，门禁会显式列出。

### Fixed

- 自定义管线带音轨时音频时钟不前进，约 4 秒后以不可恢复的 `AUDIO_BUFFER_OVERFLOW` 结束会话。
  处理器在暂停期间不消费任何数据，而 `startBufferDuration`（150 ms）恰好能填满 MessagePort 队列
  （`maxMessagePortPendingBlocks` 默认 8），于是第一个 `consumed` 回执之前到达的那一块必然撞上
  `enqueue` 里的硬失败。现在 `AudioOutputLike` 增加 `canAccept(frames)`，控制器把塞不进去的块
  暂存并对上游报高水位，`consumed`/`underrun` 时再交付；只有暂存量超过解码队列预算才算真正越界。
  暂存的帧计入 `bufferedFrames` 与 `drained`，seek 与 close 时清空。
- MessagePort 传输初始化时补发 `reset`，把处理器的 epoch 对齐到会话 epoch。共享内存路径靠
  `shared-init` 携带 epoch，而 MessagePort 路径没有这条消息，处理器会丢弃 epoch 不匹配的
  `pcm` 与 `playback`——非 0 epoch 的会话（例如换源后的第二个会话）会静默播不出声音。
- 发布的 AudioWorklet 模块改为自包含单文件。`worklet-processor.js` 原先 `import './ring-buffer'`
  （`moduleResolution: "Bundler"` 保留了无扩展名说明符），而打包器只会把这一个文件当作 URL 资源
  拷出去，浏览器的 `addModule()` 因此 404，任何带音轨的自定义管线会话都以
  `AUDIO_WORKLET_LOAD_FAILED` 失败——只在生产构建里复现，dev 服务器看不到。共享头槽位下标改为在
  worklet 内声明，`shared-header-layout.test.ts` 守住与 `ring-buffer.ts` 的一致性以及「不得出现
  运行时 import」；`generate-manifest.mjs` 对清单里 `type: "audio-worklet"` 的资源做同样断言。
- 媒体验收不再把 `STRATEGY_ALL_CANDIDATES_FAILED` 无条件归类为 `unsupported`。该汇总码区分不了
  「浏览器不支持」与「资源坏了」，坏掉的 worklet 因此会让本该拦住它的用例直接 skip。现在按决策
  轨迹里的逐候选错误码判定，并把 `engineErrorCode` 与 `attemptErrorCodes` 透出到结果中。
  新增 `webcodecs-audio` 验收模式，用带 Opus 音轨的样本在**构建产物**上覆盖自定义音频路径
  （原有 `webcodecs` 模式的样本无音轨，所以从未走到 AudioWorklet）；该模式跑完整的
  播放 / seek / ended / 换源脚本，并断言 `audioRenderedFrames > 0`。

- RT4KSR 图按上游 `RT4KSR_Rep.forward` 重写：移除推理时不可达的 `hfb`/`gamma` 分支，激活改为
  block 后的 GELU，`fea_conv` 边框按 `expand_conv` 的 per-channel bias 填充并补回 pad 前 identity，
  `head`/`tail` 不再多加激活；pixel unshuffle/shuffle 通道序改为 `torch.nn.PixelShuffle` 语义。
- 12 个 shipped WGSL kernel 中有 8 个此前无法通过真实 Dawn/Tint 编译（混类型向量构造、2d-array
  `textureLoad` 签名），已全部修正。
- postprocess 上传 CPU `VideoFrame` 的目标纹理补上 `RENDER_ATTACHMENT`，`copyExternalImageToTexture`
  不再被验证层拒绝；RIFE stage 的 bind group layout 与着色器绑定号对齐。
- `Rt4kSrGraphExecutor` 把整张图录进单个 command encoder 并只提交一次（此前每 pass 一次
  submit + fence，22 层等于每帧 22 次 CPU↔GPU 往返），uniform 改为单缓冲多槽位；
  `uploadTensorStore` 只上传图实际绑定的张量（RT4KSR 51→44，RIFE 198→118）。

- 控制栏锁定（`features.lockControls`，默认开启）：全屏或剧场模式下播放器左侧中部出现 `Lock`/`LockOpen`
  按钮，锁定后控制栏、状态层与浮层一并收起，指针与键盘不再影响播放，只有锁图标可点；锁图标 5 s
  无操作后淡出并隐藏光标，指针移动重新唤出，退出全屏/剧场自动解锁。根节点公开 `data-mxp-locked`
  与 `data-mxp-lock-chrome`。
- 字幕弹窗改为贴控制栏的三页弹窗（字幕 / 选择字体 / 字幕样式）+ 编辑模式，形态对齐 MX-Player-Pro：
  字体页给出六个 CJK 优先字体栈并逐行渲染样张，齿轮进入编辑模式后画面上出现虚线参考框，中心拖拽
  移动位置、上下句柄改变字号，底部细条显示提示、当前数值、恢复默认与完成。弹窗与编辑模式共同持有
  一次播放挂起，两者都关闭后才恢复，播放按钮在挂起期间禁用。
- 右键菜单每项配一个 Lucide 图标，可勾选项保留左侧勾选位使标签对齐。
- Demo 播放器右下角改为具体媒体参数（分辨率、帧率、位深/HDR、视频与音频编码、声道、采样率、容器、
  所选后端），取代原来的播放意图字样；`apps/demo/src/media-summary.ts` 负责把公共 `MediaDescriptor`
  格式化为该读数。

- 播放器 chrome 四语言文案包（`en`、`zh-CN`、`zh-TW`、`ja`）与 `locale` 选项：类型强制每个包
  完整，`auto` 依次读取 `<html lang>`、`navigator.languages`、`navigator.language`，`zh-Hans*` 与
  `zh-Hant/TW/HK/MO` 分别归入简繁包；`labels` 仍可在包之上逐条覆盖。公共入口导出
  `PLAYER_UI_LOCALES`、`PLAYER_UI_LOCALE_CODES`、`playerUiLabels`、`matchPlayerUiLocale`、
  `resolvePlayerUiLocale`、`detectPlayerUiLocale`。
- 播放器右键菜单：循环播放、迷你播放器、复制视频网址、复制当前时间的视频网址、复制嵌入代码、
  复制调试信息、排查播放问题、详细统计信息。菜单挂在共享宿主上，因此 video/canvas 区域的右键
  也能命中；分三组并自动折叠空组，支持方向键/Home/End/Tab 循环与 Escape 关闭，再次右键移动到
  新位置。循环走公共 SDK 契约（`ended` 时 `seek(0)` + `play()`），Native 与 Custom 行为一致。
- 迷你播放器：仅在宿主与根节点写 `data-mxp-mini`，由样式表把宿主停靠到视口角落，不开新窗口、
  不移动引擎 surface，Escape 退出，`destroy()` 与 `detach()` 归还宿主属性。
- 详细统计信息非模态浮层：视频 ID/sCPN、视口/帧数、当前/最佳分辨率、音量/归一化、编解码器、
  色彩、连接速度、网络活动、缓冲健康度、调试串、日期共 11 行，每秒刷新且跟随 `playbackchange`；
  连接速度与网络活动是缓冲前沿 × 声明码率的派生估算（SDK 不暴露字节计数器），日期按所选 locale
  用 `Intl.DateTimeFormat` 渲染。浮层自带 `--mxp-stats-*` token，停靠迷你播放器时隐藏。
- 排查播放问题浮层与「复制调试信息」：在同一批公共遥测上给出丢帧比例、缓冲饥饿、引擎错误码、
  音频时钟缺失与 WASM 软解 findings，并输出可复制的 JSON 环境报告。
- `PlayerUiShareOptions`：`videoUrl`/`pageUrl`/`embedUrl`/`timeParam`/`embedWidth`/`embedHeight`/
  `title`。UI 不从引擎内部推导媒体地址；嵌入代码对 URL 与标题做 HTML 属性转义，无法解析的地址
  原样返回。
- Demo 四语言化：`apps/demo/src/i18n.ts` 承载全部文案（含代码示例内的注释），顶栏加入语言切换器，
  选择持久化到 `localStorage` 并同步 `<html lang>`、`document.title` 与 description meta。
  `landing.ts` 与 `diagnostics.ts` 改为返回与语言无关的 reason/tone，由展示层映射文案。

### Changed

- 播放器图标集对齐 MXAnime-CMS 内置 MX-Player：PiP 改用 `PictureInPicture2`，剧场模式改用
  `RectangleHorizontal`。
- 图标按钮去掉悬停与开启态的白色圆形底色：悬停只提高不透明度，开启态在图标下画一条 `--mxp-accent`
  细线。
- 自动隐藏延迟默认 2500 ms 改为 5000 ms，并与 MXAnime-CMS 对齐：指针离开播放器立即收起，全屏且
  控制栏收起时隐藏光标。鼠标点击留下的焦点不再算作交互（否则点完播放控制栏永不收起），键盘焦点
  仍然保持控制栏可见；焦点进入播放器区域本身会重新显示控制栏。
- 任一被处理的快捷键都会重新显示控制栏，避免按键作用在已隐藏的控件上。
- 字幕入口离开主浮层状态机：`settings | statistics | about | null` 仍互斥，字幕弹窗与编辑条独立存在。
- Demo 挂载外挂字幕时把文件名作为轨道名传给 SDK，弹窗因此显示 `probe.srt` 而不是内部轨道 id。
- 字幕编辑模式的拖拽对齐 MX-Player-Pro：参考框只上下移动（横向位置改由样式页决定），上下句柄改为按
  指针到参考框中心的距离比例缩放字号，两条边对称，替换原先按像素线性增减的做法。

- Demo 顶栏品牌改为 FREEANIME.ORG 式字标：`MX Player Max` 单行显示、中间词反色 chip、区分大小写，
  移除旧的 `MX` 方块与 `Modular web media engine` 副标题。
- Demo 顶栏获得独立层叠上下文，语言下拉不再被播放器 surface 遮挡。

### Fixed

- 进度条卡死：已播放填充原先渲染 `played` 快照区间，一次 seek 之后填充会停在旧区间里不再前进，
  看起来像进度条卡住；现在填充是跟随播放头的连续一条，缓冲仍按真实区间分段。
- 拖拽进度条时填充不再等 seek 落地才移动：本地拖拽位置立刻生效，快照确认到目标位置或 1.2 s 无人
  应答后交回快照。
- 控制栏自动隐藏倒计时被 `playbackchange` 重置：`playbackchange` 每秒到达数次且每次都会重排倒计时，
  5 s 的窗口永远走不完，控制栏因此从不自动收起。倒计时现在只由真实交互重排。

- Demo 入场动画的 `will-change` 由常驻 CSS 改为动画期间的作用域规则：常驻 `will-change: transform`
  会让每个 section 成为 fixed 定位的包含块，迷你播放器因此停靠到 section 而不是视口。

- Phase 10.2 libvpx VP8 三个 WASM 变体完成项目所有者授权及许可证/专利审核；运行时默认审核门禁
  直接接受 approved manifest，single/SIMD 以固定 SHA-256 进入 npm、Release、Browser Manifest
  与 Pages 白名单，threaded 因缺少 pthread host glue 保持技术性排除。
- 手动 `deploy-demo.yml` GitHub Pages 流程：相对 base Demo、仓库子路径 Chromium smoke、
  manifest 白名单 `/sdk/` Browser 产物、Artifact-only 模式及 Pages 未启用提示；Docker 继续承担
  COOP/COEP、WASM Threads 和自定义响应头验证。
- Phase 13 可重复质量语料：7 个合成媒体与 2 个字幕 fixture、来源/许可证/FFmpeg 命令、
  SHA-256/FFprobe 校验，以及不提交 30 分钟大文件的 seed-loop 生成策略。
- Native/WebCodecs Playwright 媒体工程，覆盖非空像素、播放生命周期、连续 seek、字幕 cue、换源、
  video/canvas 像素统计一致性、resize/DPR、offline、Range/MIME/404、截断和损坏文件稳定错误码；
  WebKit 明确为 automation-only。
- Postprocess kernel/packed RT4KSR/RIFE 数值 oracle、GPU fallback/device-lost、quality SDK event、
  stale epoch 和 10,000-cycle bounded texture/tensor pool 回归。
- 隔离/非隔离性能 collector、版本化阈值和四份 Chromium/Firefox automation smoke baseline；
  未暴露的首音/漂移/CPU/内存/功耗指标保存 `null + reason`，长跑文件哈希由 collector 实算，
  缺字段或复用 seed hash 的证据会被拒绝，30 分钟门禁不由短跑关闭。
- AI/WASM 供应链来源/hash/license/build-options 审计、真实浏览器 pending schema、统一 508-test
  机器计数与文档漂移 CI；
  Docker 增加 CSP、隔离 80/非隔离 8080 双运行时静态合同。

- Phase 10.2 libvpx `v1.15.2` VP8 垂直切片：真实 single/SIMD/threaded WASM 资产、
  MXWF I420 帧 ABI v1、真实媒体样本、WebAssembly compile/instantiate runtime 和供应链资料。
- 后端无关 `@mx-player-max/decoder-worker` 控制面，以及 VP8 WASM Worker 对 Phase 2 packet、
  Phase 4 epoch/reset/flush/有界队列/背压/pull reader 的复用。
- Core 仅在显式 `wasmBaseUrl` 下声明 approved VP8，支持 WebCodecs 初始化失败原子回退 WASM；
  非隔离 single 和隔离 threaded -> SIMD 回退均通过真实 Chromium 渲染，Firefox single 通过。
- Browser release manifest 发布审核通过且哈希锁定的 single/SIMD，因 host glue 缺失显式排除
  threaded，并继续禁止未完成许可与专利审查的新增二进制进入 publishable assets。

- Phase 12 Demo 公开 API 诊断工作台：Probe、Decision、Runtime、Subtitles 四面板及 empty/loading/ready/failed 状态，只消费 SDK getter/event；source/intent 切换清理旧 epoch，未知能力保留 pending verification，GSAP 与 reduced-motion 不阻塞播放器生命周期。
- Phase 12 Docker 演示站冻结依赖安装，区分 HTML、版本化静态资源和媒体缓存，并增加 COOP/COEP/nosniff、MIME、Range、404 与 `crossOriginIsolated` smoke。
- Phase 12 CI/Release workflow：普通 CI 增加浏览器、包元数据和 release script 门禁；发布拆分为 validate/package/consumer-smoke/artifact/publish，生产 publish 需要显式 tag、input、受保护 environment 和 npm token。

- Phase 11 `@mx-player-max/platform`：可注入 Chromium/WebKit/Gecko 增强探测，覆盖 Worker MediaSource、WebGPU external texture、原生 HLS/HEVC、HDR display、ManagedMediaSource、AirPlay/PiP、fastSeek、标准播放质量和仅诊断使用的 Firefox 帧计数。
- 可审计 `PlatformIssueRule`：浏览器/半开版本范围、HTTPS Issue、失效日期、回归样本、负向评分和候选匹配；内建 Firefox Bugzilla #1918769 H.264 WebCodecs configure 风险规则，不改写能力支持状态。
- `PlatformDiagnostics` 显式记录 WebCodecs 硬件偏好/实际选择，并在标准 API 无法确认时保留 `unknown`，不从 `powerEfficient` 或配置支持结果推断硬解。
- Phase 10 `@mx-player-max/decoder-wasm` Manager 契约：严格且不可变的 manifest/review 校验、Codec/轨道受限的插件 Registry、审核后的策略声明、能力驱动的 threaded/SIMD/single 变体选择、HTTP(S) URL 边界、内存/Cache Storage、SHA-256 验证、并发去重、Abort 和原子回退。
- Phase 9 独立可选的 `@mx-player-max/ui`：原生 DOM + TypeScript 控制条、进度/缓冲/连续 seek、160x90 可取消预览、状态层、单一浮层状态机、自动隐藏、快捷键、ARIA、字幕轨道与样式编辑，以及独立 `style.css`。
- Native/Custom 共用的 `PlaybackSnapshot`、播放范围、能力、展示模式、安全错误摘要、`playbackchange` 事件和受预算/epoch/AbortSignal 保护的公共预览契约。
- React/Vue SDK + UI 薄组件、播放器 workbench Demo，以及 Chromium desktop/mobile、Firefox 和 Playwright WebKit 的交互与截图自动化。
- UI 生命周期支持创建、重复 attach、重新挂载、全量配置更新和幂等销毁；所有异步 UI 操作检查生命周期与媒体 session epoch。
- Phase 8 SRT/ASS/SSA 字幕内核：有界纯文本解析、内嵌 packet 与 File/HTTPS 来源、稳定轨道生命周期/epoch、Native/Custom 媒体时钟调度、安全 DOM Overlay 和按 origin/local-file 作用域的样式存储。
- `SubtitleCue`/style/source/track/clock/store 公共契约、稳定 `SUBTITLE_*` 错误码、字幕事件，以及 Core/SDK 轨道、选择、外挂字幕、样式与 Overlay API。
- ASS Script Info、V4/V4+ Styles、Events Format/Dialogue 映射、白名单基础样式/位置和未支持 libass 特效的显式降级诊断；新增解析、安全、来源、轨道、时钟、Overlay、Core 和 SDK 自动化测试。

- Phase 7 AI post-processing：pull-based `AiPipeline`、RIFE temporal stage、RT4KSR x2 packed full-channel graph、bounded WebGPU texture/tensor pools、WGSL warp/convolution/layernorm/pixel-unshuffle/pixel-shuffle kernels、frame-budget governor、MXAI manifest/Cache Storage/SHA-256 loader，以及真实 Practical-RIFE 4.25 和 RT4KSR x2 上游权重与 MXAI 派生产物。
- Core render loop now accepts CPU or GPU-resident frames with exact-release ownership; `ai-enhance` strategy excludes Native/WASM AI candidates and reports passthrough when WebGPU is unavailable.

- Phase 6 WebGPU/WebGL2/Canvas2D Renderer：能力驱动的自动选择与 runtime fallback、固定 shader/filter 资源、crop/rotation/fit/DPR/尺寸校验、保守 SDR/HDR 状态、device/context loss recovery 和确定性资源清理。
- Custom rAF presentation loop：单 in-flight frame read、Phase 5 VideoFrameScheduler wait/present/drop、AudioContext sample clock/MediaWallClock 同步，以及 pause/resume/rate/seek/epoch/EOS 生命周期。
- `VideoRendererPreference`、`VideoFilterOptions`、`VideoTransformOptions`、Renderer capabilities/state/stats/events、稳定 `RENDERER_*` 错误码，以及 Core/SDK `rendererKind`/`rendererState`/`rendererStats`/`setVideoFilter`/`setVideoTransform` API。
- Phase 6 fake GPU/WebGL2/Canvas2D/VideoFrame/rAF/clock/factory 测试和 renderer target ownership 集成测试。

- Phase 5 `AudioDecoder`/`AudioWorklet` 管线：AAC/Opus/MP3 配置、AudioData 所有权、Float32 PCM、流式重采样、有界 ring、SAB/MessagePort、AudioContext/墙钟、underrun、seek sample 裁剪、双 decoder EOS drain、音频统计与时钟 API。
- `CustomAudioOptions`、`CustomAudioStats`、`AudioClockSnapshot`、`customAudioStats`/`audioClock` 代理和稳定 `AUDIO_*`/`WEBCODECS_AUDIO_*` 错误码；新增 Phase 5 单元与集成测试。

- Phase 4 `CustomMediaPipeline`：复用 Phase 2 Demux Worker，提供 H.264/VP8/VP9/AV1 VideoDecoder adapter、有界 FrameQueue、三重背压、pull-based `readVideoFrame()`、seek epoch/preroll、EOS flush 和完整 close 清理。
- `CustomVideoOptions`、`DecodedVideoFrame`、`CustomVideoStats`、`frameavailable` 事件，以及稳定 `CUSTOM_*`/`WEBCODECS_*` 错误码。
- Dedicated Worker/MessagePort 可选 VideoDecoder 协议，VideoFrame 使用 transferable 返回且旧 epoch Frame 立即关闭。
- `MediaEngine`/`MXPlayer` 的 `customVideoStats` 与 `readVideoFrame()` 代理；Native 路径明确返回 `CUSTOM_FRAME_ACCESS_UNAVAILABLE`。
- Phase 3 `NativeMediaPipeline`：基于 Phase 2 Probe、能力报告和既有策略的 HTMLVideo 原生文件播放路径，支持 File、CORS/Range 远程 MP4/WebM、统一事件/状态、播放控制、全屏/PiP、Object URL 和 requestVideoFrameCallback 统计。
- `MediaEngine`/`MXPlayer` 原生播放公共 API 与稳定 `ENGINE_*`/`NATIVE_*` 错误码。

- Phase 2 byte-range, retry, cache, compressed packet, container adapter, and demux worker contracts.
- Abortable File range reads and strict HTTP 206 loading with Content-Range, length, ETag, retry, concurrency, and LRU validation.
- Bounded Matroska/WebM EBML parsing with tracks, Codec private data, blocks, lacing, Cues, and controlled no-Cues seek fallback.
- MP4/ISO BMFF probing and sample demux for faststart/tail-moov files, 32/64-bit boxes, sample tables, sync samples, and basic fMP4 recognition.
- Session/epoch-aware demux Worker lifecycle with transferable packet buffers and stale-message suppression.
- Versioned static `CapabilitySnapshot` and media-specific `MediaCapabilityReport` contracts.
- Concrete HTMLVideo, MediaCapabilities, WebCodecs, WebGPU, WebGL2, Canvas2D, WASM SIMD, and WASM Threads probes.
- SDK/schema-isolated capability caching with force refresh and injectable adapters.
- Deterministic backend ranking and score-only Chromium/WebKit/Gecko platform policies.
- Typed engine event map and Phase 1 capability/strategy error codes.

### Changed

- 播放器 chrome 改为单色视觉，对齐 MXAnime-CMS 内置 MX-Player：白色强调（light 主题为黑）、控制栏
  `--mxp-scrim` 底部遮罩、36 px 圆形按钮、3 px 全宽细进度轨（hover/focus 5 px、无独立 thumb）、
  毛玻璃深色浮层与 126 px 等宽时间码。DOM 与 `controller.ts` 不变，样式契约由「禁止任何渐变」收窄为
  「仅允许 `--mxp-scrim` 一处」，`--mxp-control-size` 基线 40 px → 36 px，win32 chromium UI baseline
  已重新生成。详见 `ADR-0006`。
- Demo 由四宫格 workbench 改为落地页：顶栏（品牌、runtime 状态、主题切换、Repository）、可拖放的
  播放区、URL 表单、本地媒体与字幕入口、播放意图、能力条、为什么选择、接入示例、工作原理、诊断面板、
  FAQ 与页脚，布局与排版对齐 MX-Player-Pro 落地页结构，品牌/文案/代码示例/图标均为 Max 自有，
  新增 dark/light 主题切换并同步给播放器 UI。
- `AGENTS.md`、`ADR-0004`、execution-plan、roadmap、ui-package、player-ui 与两个 README 同步这次
  视觉决策反转；`ADR-0006` 记录取代范围与后果。

- `pnpm test:browser` 保留 UI/媒体项目并发，但在它们完成后串行运行 Chromium 与 Firefox 性能项目，
  避免跨浏览器资源竞争污染性能门槛并导致默认命令偶发失败。
- Range/container probe 保留协议与损坏错误码，不再把错误 200、Content-Range、断连或截断全部折叠为
  `NATIVE_NOT_SUPPORTED`；公共 SDK error 事件移除内部 cause，避免泄漏 URL、路径和平台错误。
- Engine 创建的 Custom canvas 继承宿主尺寸，AI governor options 生效，seek 后迟到的 postprocess
  结果按 epoch 释放，纹理/张量池提供只读 bounded diagnostics。

- Video-only Custom playback now anchors its wall clock to the first deliverable frame, preventing real software-decoder startup latency from dropping every initial frame as late.

- Phase 12 集成与分发文档现覆盖 npm SDK/UI、Browser ESM/IIFE、jsDelivr 固定版本模板、SRI、React/Vue peer、Decision Trace 隐私边界、CORS/Range、COOP/COEP 和未审查 WASM/真实浏览器边界。
- Phase 12 验收记录固定自动化命令、17 个 tarball、Browser Manifest/SRI、Playwright 16/16 结果，以及 Docker/真实浏览器/真实发布的 pending 边界。
- `MXPlayer.ready` 现在始终返回当前 load promise，并新增可重复 `load()`、`playback` 与 `requestPreview()` SDK 代理。
- Native 与 Custom 都从同一公共快照驱动 UI；Custom 仅在宿主提供预览 provider 时报告 preview capability，Native 预览使用与活动播放元素隔离的有界媒体元素和 canvas。
- 原生能力探测在 MediaCapabilities 配置不完整但 `canPlayType()` 明确返回 `probably` 时保留 Native 支持；`maybe` 仍为 `unknown`。
- `HttpRangeLoader` 只把强 ETag 写入 `If-Range`，弱 ETag 仍可用于响应一致性比较。
- A non-`none` load-time filter promotes normal/low-power playback to the Custom `filters` intent; strategy reasons now record renderer selection/fallback chain, and WebGPU candidates require a usable texture limit.
- Custom readiness now waits for decoder/audio and Renderer/output target initialization. Caller canvas/container/video ownership is preserved, and renderer teardown is included in source replacement/seek/close lifecycle.
- `readVideoFrame()` remains an immediate pull ownership boundary; only a frame explicitly passed to `render(frame)` transfers ownership to the Renderer.

- H.264 capability query 可从兼容 Matroska avcC 安全规范化真实 RFC6381 Codec，不生成 SPS/PPS，也不从扩展名或 MIME 猜测。
- Container probing now uses source bytes and bounded Range reads rather than extensions; unknown Codec IDs remain explicit instead of being guessed.
- Strategy selection now requires a capability context and only creates verified or explicitly declared candidates.
- WASM runtime support no longer implies that a WASM Codec decoder exists.
