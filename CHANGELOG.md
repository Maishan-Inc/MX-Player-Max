# Changelog

## Unreleased

### Added

- **运行时 Native ↔ Custom 切换**：`MediaEngine.switchRenderMode({ pipeline, customVideo? })`
  （SDK 同名方法）在两条管线之间迁移已载入的媒体，宿主不必重新 `load()`。Phase 6 只做 load-time
  选择，于是开一个滤镜、或者从自定义档退回原生档，都要宿主自己再 `load()` 一次——观众因此丢掉播放
  位置和自己加的外挂字幕轨。渲染器与解码器仍在会话创建时固定，所以切换在内部依然是重建；区别是
  引擎自己完成重建并把会话状态带过去。
  连续性的定义（也是单测断言的东西）：位置用 seek 恢复到旧管线所在处；**session epoch 严格递增**
  ——重建对所有以 epoch 为键的消费者就是一个新会话，假装它没变会让上一会话的帧和 PCM 漏进来；
  外挂字幕轨按加入顺序重新加入（引擎为此记账，因为字幕控制器随管线一起销毁），并把原先选中的那条
  重新选上（轨道 id 按控制器重新分配，所以映射到新 id）；仅在切换前正在播放时才恢复播放。
  失败时回滚：恢复切换前的选项并重新载入，因此被拒绝的切换留下的是一个还在播的会话，而不是空播放器。
  `setVideoFilter()` 在原生会话上不再抛 `RENDERER_BACKEND_UNAVAILABLE`，而是带着该滤镜迁到自定义管线。
  浏览器用例故意用**无音轨**样本：自定义管线的视频泵以音频时钟为闸门，带音轨的样本会让这条用例
  依赖机器能不能出声，而最需要这份覆盖的恰恰是最出不了声的环境。chromium 与 firefox 都实测通过；
  Playwright WebKit 既放不了 WebM、也没有 `VideoDecoder`，因此按这两项能力探测跳过。

- 决策轨迹现在记录「原生候选因 intent 被排除」，UI 据此给出可操作的提示。自定义档下遇到引擎编码范围
  之外的编码时，失败只剩汇总码 `STRATEGY_NO_VIABLE_BACKEND`，读起来像「这文件没救了」——可实际上切回
  原生档就能播。策略层现在在「原生本可播、只是 intent 不允许」时产出一条 exclusion，用新的
  `STRATEGY_NATIVE_EXCLUDED_BY_INTENT`，**不复用编码范围的错误码**：媒体本身没问题，借用一个
  「不支持」的码会把一条可用路径说成坏的。轨迹机制无需改动，它本来就把 exclusion 记成
  `status: 'skipped'` 的 attempt。
  UI 侧新增 `nativePathAvailableInstead()` 与 `troubleshootNativeModeAvailable` 文案（四语言齐备），
  故意**不**并入 `CAUSE_BY_CODE`：那样它会赢得「第一个可识别错误码」的竞争、把真正的原因（引擎拒绝的
  那个编码）挡掉。因此报告与状态栏都是「原因在前、建议在后」。
  原生本来就不通时不给这条提示——例如 Chromium 下的 HEVC，`canPlayType` 对裸 `hvc1` 与完整
  `hvc1.2.4.L120.B0` 都返回空串，此时提示会是假话，单测钉住了这一点。

- 语料里没有播放覆盖的样本补上了端到端用例，`expectedPaths` 按实测修正。此前
  `mp4-av1-main-8bit-aac` 与 `mp4-hevc-main10-10bit-aac` 没有被任何测试引用过，
  `mp4-h264-baseline-8bit-aac` 只出现在 fault 路由与 Range/MIME 契约里，`mkv-vp8-p0-8bit-opus`
  的 `native`、`mkv-h264-baseline-8bit-aac-embedded-ass` 的 `native`、
  `webm-vp8-p0-8bit-video-only` 的 `wasm` 都是无用例背书的声明——其中三条还是错的。新增六条用例：
  MP4 H.264 与 AV1 各自的原生 + 自定义两条路径、Matroska VP8 的原生路径、内嵌字幕样本的原生路径、
  语料这条 VP8 样本真正走一遍 libvpx WASM 回退（模式内摘掉 `VideoDecoder` 构造函数，
  与既有 WASM 验收路由同法，因为 WASM 只在 WebCodecs 候选造不出来时才排得上），
  以及 HEVC「每条路径都干净拒绝」。
  **用例的 skip 条件一律是浏览器能力探测**（`VideoDecoder.isConfigSupported` / `canPlayType` /
  `AudioContext` 能否 running），不是验收结果的 `status === 'unsupported'`：后者会连
  `STRATEGY_NO_VIABLE_BACKEND`、`AUDIO_AUTOPLAY_BLOCKED` 一起放过，而回归恰好就长这样。

- 语料清单与验收模式表现在互相校验。`verify-media-manifest.mjs` 读
  `apps/demo/src/media-acceptance-modes.json`，双向比对：语料声明的每条 `expectedPaths` 都必须有
  模式认领，模式认领的样本与路径也必须是语料声明过的。加上这条规则时它立刻抓出一条真实缺口——
  `mkv-h264-baseline-8bit-aac-embedded-ass` 声明了 `native` 却没有任何模式跑它，于是补了
  `mkv-embedded-subs-native`。验收模式表因此从代码里的三个 `Set` 变成一份数据。

- 语料补上第四条 Matroska 夹具 `mkv-vp9-p0-8bit-opus.mkv`（VP9 profile 0 + Opus）与两个验收模式
  `mkv-vp9-native` / `mkv-vp9`。三条既有 Matroska 样本全是 H.264 或 VP8，于是「Matroska + 需要从
  关键帧推导 codec 字符串」这个组合一条用例都没有覆盖：EBML 不给 VP9 轨任何 CodecPrivate，profile、
  level 与 bit depth 只能从第一个关键帧的 uncompressed header 里读出来。当初把这条夹具从 VP9 改成
  VP8 的理由——裸 `vp09` 在任何容器里都没有自定义路径——已经被 `vp09.PP.LL.DD` 推导本身消掉。
  `expectedPaths` 是量出来的，不是从 WebM VP9 那条抄的：Chromium 对
  `video/x-matroska; codecs="vp9,opus"` 依然返回空串，但对推导出的 `vp09.00.11.08` 返回 `probably`，
  媒体元素也真解出画面（Chromium 32 帧、Firefox 35 帧），所以 `["native","webcodecs"]` 两条都成立。
  两条用例的 skip 只由浏览器探测决定，随后无条件断言 `videoCodec === 'vp09.00.11.08'`——把 EBML 的
  推导抽掉后它们在两个浏览器上都**转红**而不是 skip（自定义档 `STRATEGY_NO_VIABLE_BACKEND`、
  原生档 `NATIVE_NOT_SUPPORTED`）。夹具以 `-bitexact` 生成，否则 matroska 复用器每次写一个随机
  SegmentUID，两次生成的哈希不同，`quality:media` 会直接拒收。

- 语料补上 AV1 与 10-bit VP9 的 Matroska 组合：新增夹具 `mkv-av1-p0-8bit-opus.mkv`
  （AV1 Main 8-bit + Opus）与 `mkv-vp9-p2-10bit-opus.mkv`（VP9 profile 2 10-bit + Opus），各配
  原生 + 自定义两条验收模式与四条用例。此前 13 条样本里没有任何 AV1 的 Matroska 覆盖，
  10-bit VP9 也只有 WebM 一半。两条的 `expectedPaths` 都是量出来的：
  Chromium 151 与 Firefox 153 对 `video/x-matroska` 配裸 `av01` / 裸 `vp09` 一律返回空串，
  配推导出的 `av01.0.00M.08` / `vp09.02.11.10` 都返回 `probably`，媒体元素也真解出画面，
  所以 `["native","webcodecs"]` 两条都成立；四条用例在两个浏览器全部通过
  （`media-webkit-automation` 按能力探测跳过——Playwright WebKit 没有 WebCodecs）。
  10-bit 那条在 Firefox 自定义管线整条脚本 45 s，仍是语料里最慢的一档。

### Changed

- `mp4-hevc-main10-10bit-aac` 的 `expectedPaths` 从 `["native"]` 改成 `[]`，并新增
  `noRouteReason` 记录实测依据。原来那条声明从未被用例验证，而且在两个浏览器上都是错的，
  错法还不一样：Chromium 里裸 `<video>` 报 `readyState 4`、音频照走，但 `videoWidth` 是 0、
  一个像素都没有，视频轨被静默丢掉；Firefox 对完整的 `hvc1.2.4.L120.B0` 回答 `probably`，
  实际解码时报 `MEDIA_ERR_DECODE`。因此**没有**给 `expectedPaths` 加按浏览器的结构：那样只会把
  Firefox 的「声称」记成一条「路径」，同样是假的。清单改为用一个空数组加一段实测说明表达
  「哪条路都不通」，用例则钉住每条路径都以能力错误码干净拒绝、不产生任何像素。
  `verify-media-manifest.mjs` 要求空 `expectedPaths` 必须带 `noRouteReason`，
  免得它和「没写完」无法区分。

- Matroska 进入媒体语料矩阵：新增 `mkv-h264-baseline-8bit-aac.mkv` 与 `mkv-vp8-p0-8bit-opus.mkv`
  两条夹具，以及 `mkv-native` / `mkv` / `mkv-vp8` 三个验收模式和四条浏览器用例（chromium 与
  firefox 都通过）。容器此前有 `MatroskaContainerAdapter` 但没有任何夹具，端到端从未被跑过。
  Matroska 夹具必须用 `-bitexact` 生成：否则复用器每次写随机 `SegmentUID`，哈希不可复现，
  语料校验会拒收。

- 内嵌字幕轨拿到了真实容器的端到端覆盖：新增夹具 `mkv-h264-baseline-8bit-aac-embedded-ass.mkv`
  （`basic-style.ass` 以 `S_TEXT/ASS` 流拷贝进 Matroska）、验收模式 `mkv-embedded-subs`，以及一条
  chromium 与 firefox 都跑的用例。`embedded-<trackId>` 这条路径此前只有单测，所有验收模式都走
  `addSubtitleTrack` 的外挂文件，容器解复用出来的字幕从未被端到端跑过。语料清单新增
  `embeddedSubtitleTracks`，`verify-media-manifest.mjs` 校验它引用的字幕 id 存在、格式一致且已列入
  `subtitleIds`。这条夹具不能用 `-shortest`：字幕流 2.60 s 就结束，会把视频和音频一起截断到那里。

- Demo 接上渲染模式切换：启动器的 `playback-intent` 选择器（ADR-0006 保留的那个）与播放器设置面板
  现在是同一份状态的两个视图，都写 `DemoRenderMode` 适配器，因此不会互相打架。映射抽成
  `apps/demo/src/render-mode.ts` 的纯函数：`native` → `intent: normal`；`custom-webgpu` →
  `ai-enhance` + `renderer: webgpu`（策略层只在这个 intent 下算 `aiPlan`）；`custom-fallback` →
  `filters` + `renderer: webgl2`。选择器三个 option 值保持不变，文案改为直接点明管线。
- Demo 现在给引擎配置 `aiModelBaseUrl`。新增的 vite 中间件按显式白名单从
  `packages/postprocess/assets/weights/**` 提供权重（dev 与 preview 都装），权重不进 `public/`
  因此不会进入 Pages 产物；`--mode pages` 下 `resolveAiModelBaseUrl` 返回 `undefined`，让 Pages
  照旧报 `model-unavailable`，而不是指向一个 404 的模型根目录、把开关显示成可用再点崩。

- 播放器设置面板新增「渲染模式」三档选择：`native`（原生 `<video>`）/ `custom-webgpu`
  （WebGPU 自定义管线，AI 增强只在这一档可用）/ `custom-fallback`（WebGL2 自定义管线）。
  渲染路径在会话创建时固定，切换等于用不同引擎选项重新 `load()`，所以这一节走宿主适配器
  `RenderModeAdapter`（与 `TheaterModeAdapter` 同形的 get/set/subscribe），UI 只呈现与上报；
  没有提供适配器时整节不渲染，不会出现点了没反应的控件。对应 `features.renderMode`（默认开启）
  与 `renderMode` / `renderModeNative` / `renderModeWebGpu` / `renderModeFallback` /
  `renderModeHint` 标签，四语言文案齐备。宿主在别处改档时已打开的面板会重绘。

- AI 后处理运行时开关：`MediaEngine.setAiPostProcess({ interpolation?, superResolution? })` 与
  `PlaybackSnapshot.ai`（`{ tier, interpolation, superResolution }`，每个 stage 带
  `enabled/available/unavailableReason`）。stage 懒构造，第一次开启超分才拉取并校验模型；
  原生或非 WebGPU 会话以 `RENDERER_AI_UNSUPPORTED` 拒绝，`PlaybackChangeReason` 新增 `ai`。
- 播放器设置面板新增「AI 增强」一节，插帧与超分两个独立开关（`features.aiPostProcess`，默认开启），
  不可用时保持可见但禁用并给出原因（渲染路径 / 缺模型根目录 / 无 WebGPU 适配器 / 尚未实现），
  四语言文案齐备。两个开关的可用性都取决于「WebGPU 自定义会话 + 配置了 `aiModelBaseUrl`」。
- 真实 WGSL 执行门禁：`pnpm quality:webgpu`（27 个 kernel 通过 Dawn/Tint 编译，含每个 packed kernel
  的 `rgba32float` 变体，加 packed 2d-array 存储往返）、`pnpm quality:webgpu:numerics`（kernel 对
  CPU 参考）、`pnpm quality:webgpu:oracle`（shipped `Rt4kSrGraphExecutor` 对上游 RT4KSR forward，
  端到端 `max |delta| = 3.7e-3`）。
  `packages/postprocess/tools/generate_rt4ksr_reference.py` 生成逐层参考张量。
- **RIFE 4.25 插帧推理**：`packages/postprocess` 现在真正执行 Practical-RIFE 4.25 的 IFNet。
  `GpuGraphLayer` 的单输入线性链扩展为带类型的节点图 `GpuGraphNode`（`input`/`fill`/`conv`/
  `transposed-conv`/`pixel-shuffle`/`resize`/`warp`/`gather`/`add`/`blend`），尺寸以「padded 帧
  尺寸 ÷ divisor」符号化表达；新增 `PACKED_GATHER`（concat/slice/按段缩放，packed 存储纹理只能
  整 texel 写入，所以 concat 必须 gather 而不是 scatter）与 `PACKED_FILL`；`PACKED_INPUT` 增加
  source 边界，按上游 `F.pad(..., value=0)` 在右/下补零。`ResConv` 的 `beta` 与 `IFNet` 全部
  40 个残差卷积在建图时折进权重与偏置（`GpuNodeGraph.derivedTensors`），不再上传。
  新增 `RifeGraphExecutor`：155 个节点录进单个 command encoder、单次 submit、单次 fence，
  uniform 单缓冲多 256 字节对齐槽位，激活默认存 `rgba32float`（见下）。
  `pnpm quality:webgpu:rife` 从算子级扩展到整图：`encode`/`block0..4` 的 `flow`/`mask`/`feat`/
  `warped0`/`warped1`/`mask.sigmoid` 全部收敛到 `1.8e-4` 以内，最终 `output` 为 `2.0e-3`
  （`rgba8unorm` 半个 8-bit 步长，即该链下限）。门禁另有两个开关：`--mutate=leaky-slope`
  把 LeakyReLU 斜率从 0.2 改成 0.05 并**要求**比较失败（当前偏到 `9.1e-1`），
  `--activation=rgba16float` 测半精度变体。
- `RifeExecutorOptions.activationFormat`：IFNet 的 flow 是以像素为单位的位移，半精度 ulp 在 `|5|`
  处已是 4e-3 像素，而五个 block 互相反馈各自的 warp，同一 fixture 上 `rgba16float` 会让 `output`
  偏到 `1.4e-1`。因此默认 `rgba32float`——出厂默认即门禁验证过的配置；代价是 1080p 激活池约
  1040 MiB（半精度约 520 MiB），`RifeGraphExecutor.activationTextures/activationBytes` 可读。
- `AiPipeline.attachStages()` 与 `AiPipeline.consumedThrough`：stage 仍然懒构造，但先开一个再开
  另一个不会重建管线（governor 历史与 epoch 保留）；`consumedThrough` 告诉消费者解码队列真正
  可以释放到哪一帧 —— 插帧在两帧之间的每个相位都要重读较早那帧，所以不能按刚呈现的帧释放。
- `CustomMediaPipeline.setVideoLookahead()`：把 `AiPipeline.lookaheadFrames` 接到解码队列低水位上。
  `lowWaterMark` 为 0 时队列本可停在单帧，插帧的 `peekNext` 永远拿不到后继帧而死锁；
  `customVideo.maxDecodedFrames` 不足 `lookahead + 2` 时请求以 `CUSTOM_INVALID_QUEUE_CONFIG` 拒绝。

### Fixed

- Matroska 的 AV1 轨道现在从 CodecPrivate 推导完整的 `av01.P.LLT.DD` codec 字符串。
  FFmpeg 9.0 给 `V_AV1` 轨写的 CodecPrivate 就是一条 `av1C` 配置记录（本仓库夹具实测 17 字节，
  以 `0x81` marker/version 开头），而 EBML 适配器把它整个忽略、只发布裸 `av01`——裸 `av01` 被
  Chromium 与 Firefox 的 `VideoDecoder.isConfigSupported` 和 `canPlayType` 一致拒绝（实测两者对
  `av01.0.00M.08` 都回 supported/`probably`、对裸 `av01` 都回 false/空串），于是一条其实能播的
  Matroska AV1 文件在任何档位都报 `STRATEGY_NO_VIABLE_BACKEND` / `NATIVE_NOT_SUPPORTED`。
  修法与 A7 的 VP9 同构、但更简单：`av1C` 不用碰帧，profile、level、tier、bit depth 四个字段
  就躺在记录的前三个字节里。读取器抽到 `packages/demux/src/containers/av1.ts` 供两个容器共用，
  MP4 侧行为逐字不变（同一份记录从 `av1C` box 里读）；Matroska 侧缺 CodecPrivate 或记录非法时
  保留裸 `av01`，与 VP9 关键帧推导失败时保留裸 `vp09` 的回落策略一致。四条新用例
  （AV1-in-Matroska 两条路径 × 两浏览器）全部通过；变异验证：撤掉 EBML 侧的推导后四条全部转红，
  轨道退回裸 `av01`。顺带实测出一个容易踩的坑：`VideoDecoder` 在 Chromium 151 / Firefox 153 的
  **页面全局**里并不存在，只在 Worker 作用域暴露（`typeof VideoDecoder` 在主线程是
  `undefined`），探测要进 Worker 做——这也解释了引擎为什么把 WebCodecs 解码放进 Worker。

- 浏览器造不出 `VideoFrame` 时，WASM 候选不再排出来、也不再穿着「MXWF 描述符非法」的码失败。
  libvpx 解进线性内存后要把三个平面包成一个 `VideoFrame` 交出去，Playwright 的 WebKit 没有这个
  构造函数。此前策略层只看「声明过解码器」就排出候选，于是这条路径被选中、走到 `ready`、真的解码进
  了 WASM 内存，最后在交付那一步报 `WASM_FRAME_ABI_INVALID`——排查的人会去查 WASM 模块和帧 ABI，
  而描述符每个字段都是合法的，真实原因是浏览器没有 WebCodecs。实测轨迹：
  `{ status: 'failed', errorCode: 'WASM_FRAME_ABI_INVALID', backend: 'wasm', renderer: 'canvas2d',
  attemptErrorCodes: [], stateTransitions: ['ready', 'error'] }`。
  两处修好：`CapabilityContext` 新增 `wasmFrameOutput`，形状照 `wasmDecoders` 与 `webCodecsCodecs`
  两条先例——由 `@mx-player-max/decoder-wasm-vpx` 的 `describeWasmFrameOutput()` 提供，声明格式的唯一
  解释器 `decoderFrameOutputUsable()` 放在 `types`，引擎在构造 context 时传入（`core` 只多一个实参）。
  能力位缺失时不再产出 WASM 候选，宿主不声明时行为与从前完全一致。`abi.ts` 那处换成新的
  `WASM_FRAME_OUTPUT_UNAVAILABLE`：`WASM_FRAME_ABI_INVALID` 留给「模块与宿主对帧布局的理解不一致」，
  借用它会把浏览器能力缺口说成 ABI 问题。构造函数名只写在一处（`WASM_FRAME_OUTPUT_CONSTRUCTOR`），
  声明与帧工厂因此不可能对「哪个构造函数必须存在」产生分歧，单测钉住这一点。
  候选是**withheld 而不是静默消失**：策略层记一条 exclusion 带上后端本会报的码，否则失败只剩汇总码
  `STRATEGY_NO_VIABLE_BACKEND`，复制出来的报告里这条候选会整个不见。轨迹机制无需改动，它本来就把
  exclusion 记成 `status: 'skipped'` 的 attempt，而验收采集器只收 `status === 'failed'` 的码
  （见 3ca101f），所以断言 `attemptErrorCodes` 的用例一条都没动。
  有 `VideoFrame` 的浏览器行为不变，这是刻意的：`wasm-vp8` 验收模式靠打瘸 `VideoDecoder` 构造函数、
  保留 `isConfigSupported` 来让 WebCodecs 候选建出来再失败，`VideoFrame` 在那里是存在的，
  新能力位不该把它一起挡掉。实测 `media-chromium` 与 `media-firefox` 各 26 passed / 0 skipped，
  `wasm-vp8` 仍是 `backend: 'wasm'`、`status: 'passed'`；`media-webkit-automation` 仍
  7 passed / 19 skipped / 0 failed。WebKit 下直接跑 `wasm-vp8` 模式实测：`WASM_FRAME_ABI_INVALID`
  + `backend: 'wasm'` + `stateTransitions: ['ready','error']` 变为 `STRATEGY_NO_VIABLE_BACKEND`
  + `backend: null` + `['error']`，WASM 模块一次都没去取；`attemptErrorCodes` 两边都是 `[]`。
  变异验证：去掉策略层那处判定，「缺能力位时不产出候选」转红；把 `abi.ts` 的码换回
  `WASM_FRAME_ABI_INVALID`，「浏览器能力缺口不报描述符非法」转红。

- 媒体浏览器用例不再在 Playwright WebKit 上报一批假失败。这个 project 的用例从 10 条长到 26 条，
  新增的里面有 10 条红，原因不在引擎：Playwright 的 WebKit 构建没有 WebCodecs
  （`VideoDecoder` / `AudioDecoder` / `VideoFrame` 全是 `undefined`），也没有 `AudioContext`
  （连 `webkitAudioContext` 都没有），而且 `canPlayType` 对**任何**类型都回 `probably`——
  `video/x-matroska`、HEVC、裸 `vp09` 一律 `probably`，媒体元素随后再拒绝或干脆卡住。
  三类实测表现：`rendersAudio` 探针把 `new AudioContext()` 写在 `try` 之外，`ReferenceError` 直接
  逃出 `page.evaluate`，4 条用例是崩在探针里而不是跳过；Matroska 在 WebKit 下既不 `loadeddata`
  也不 `error`（10 s 后仍 readyState 0），引擎报 `NATIVE_METADATA_TIMEOUT`，2 条原生用例判成 failed；
  `canPlayType` 说谎让 VP9 原生与 HEVC 两条用例带着错的前提往下跑；libvpx WASM 回退能走到 `ready`
  再报 `WASM_FRAME_ABI_INVALID`，真实原因是没有 `VideoFrame` 构造函数。
  探针集中到 `tests/browser/media/capabilities.ts`，每条需要解码能力的用例先问浏览器、再**无条件**
  断言。原生路径不问 `canPlayType`，而是把该用例要放的那条夹具真加载一遍，要求 `loadeddata`
  且 `videoWidth > 0`——宽度是答案的一部分：Chromium 在 HEVC 上能到 readyState 4 却静默丢掉视频轨，
  那时宽度是 0。自定义路径问 `VideoDecoder` / `AudioDecoder` 在不在以及 `isConfigSupported`，
  WASM 回退问 `VideoFrame`，有音轨的用例再问 `AudioContext` 能否进入 `running`。
  **超时一律不当 unsupported**：`MEDIA_ACCEPTANCE_TIMEOUT_*` 与 `NATIVE_METADATA_TIMEOUT` 按错误码
  分不出「浏览器放不了」和「引擎真卡死」，所以跳过只由探针决定，`media-acceptance.ts` 的能力分类
  一个字都没放宽。顺带把 13 处 `test.skip(result.status === 'unsupported')`（12 条用例）换成探针 +
  无条件断言：那种写法会放过回归自己会报的码，A7 的 VP9 推导和 A1 的坏 worklet 都栽在这上面过。
  HEVC 拒绝那条在 WebKit 里跳过，理由不是「拒绝需要解码能力」——不需要——而是两条：这条用例钉的是
  **引擎自己的编码范围**在拒绝 HEVC，WebKit 没有 WebCodecs，它的拒绝与那个范围无关；更要紧的是
  它的媒体元素对放不了的文件不给确定答复，同一条 HEVC 夹具一轮回 `MEDIA_ERR_SRC_NOT_SUPPORTED`、
  下一轮 45 s 都不落地（引擎报 `NATIVE_METADATA_TIMEOUT`），实测让它在 WebKit 里跑就是一轮过、
  一轮红，所以按「浏览器有没有 WebCodecs」跳过。
  实测：`media-webkit-automation` 由 7 passed / 9 skipped / **10 failed** 变为
  7 passed / 19 skipped / **0 failed**，连续两轮一致。`media-chromium` 每轮 26 passed / 0 skipped；
  `media-firefox` 0 failed，通过数随本机音频状态在 26 与 18 之间摆（少的那 8 条是有音轨的用例，
  按 `AudioContext` 探针跳过），两种状态都实测到过。

- 构建产物里的 worklet 不再请求一个不存在的 sourcemap。`packages/audio` 整包开着
  `sourceMap`，于是 `worklet-processor.js` 末尾带 `//# sourceMappingURL=worklet-processor.js.map`；
  但这个文件是被打包器当 URL 资源整体拷进 `dist/assets/` 的，`.map` 不会跟着走，所以浏览器每次加载
  都留下一条 404。运行时无影响，但会误导排查——上一轮就被它带偏过。worklet 入口现在用单独的
  `tsconfig.worklet.json` 编译（只有这一个文件 `sourceMap: false`），其余源文件的 sourcemap 不变。
  资源从 6337 字节变成 6292 字节，发布清单里的 sha256/sha384/integrity 随之更新——
  该清单是生成物，不在版本控制里，所以没有需要手改的记录。
  `generate-manifest.mjs` 对 `type: "audio-worklet"` 的自包含断言只匹配带说明符的
  `import` / `export ... from` / `import(`，末尾留下的 `export {};` 不会误报，那条护栏未改动。
  实测（构建产物 + preview，CDP 抓全部执行上下文含 worker/worklet）：worklet 的 `.map` 请求彻底消失，
  唯一剩下的 404 是无关的 `favicon.ico`；自定义管线 `audioClock.source` 仍是 `audio-context`、
  渲染 11179 帧、验收 `passed`。

- 自定义管线不会再因为 `AudioContext` 起不来而无声挂死。`AudioContext.resume()` 在自动播放策略
  拦截时是 reject，但在**没有可用音频输出设备**的机器上它既不 resolve 也不 reject，上下文永远停在
  `suspended`。`AudioController.play()` 此前裸 await 它，于是 `play()` 永不落地；而音频时钟又是视频
  泵的起播闸门（`#startIfReady()` 要求缓冲到 `startBufferDuration`），整个会话就卡在 `ready`：
  没有错误码、没有事件、诊断面板上什么都看不出来。现在这次 await 走 `#withTimeout`，超出音频的
  `operationTimeoutMs` 就报可恢复的 `AUDIO_AUTOPLAY_BLOCKED`——正是自动播放被拦时本来就会报的那个
  原因。这个缺陷是在本机 headless Firefox 上暴露的：当时那个上下文进不了 `running`，`resume()`
  三秒内不落地，修复前 `webcodecs-audio` 这条已提交用例只表现为 120 s 的 Playwright 超时、结果对象
  都发布不出来，修复后几秒内就报出真实原因。**2026-08-25 补记**：同一台机器上这个条件是**间歇**的
  ——同一天既测到连续 5 次 `resume()` 在 1 ms 内 resolve、上下文进入 `running`，也测到连续 3 次
  25 s 都不落地。修复本身与哪一侧无关：自动播放被拦时同样走这条路径。Chromium 不受影响。

- MP4 视频轨此前拿不到自己的编码配置盒。`VisualSampleEntry` 的载荷是 8 字节 `SampleEntry`
  （`reserved[6]` 加 `data_reference_index`）再接 70 字节视觉字段，子盒因此从载荷第 78 字节开始；
  解析却把这 78 字节从**盒起点**算起，只跳过了 70 字节，落在 `compressorname` 中间，于是
  `avcC` / `av1C` / `hvcC` / `vpcC` 一个都找不到，每条 MP4 视频轨都只带裸编码 id、没有
  `codecPrivate`。裸 id 在哪儿都不被接受（`avc1` 让 `VideoDecoder.isConfigSupported` 返回
  false、`canPlayType` 只给 `maybe`；`av01` 与 `hvc1` 直接是 false 与空串），所以语料里三条 MP4
  样本一条都放不出来：`mp4-h264-baseline-8bit-aac` 与 `mp4-av1-main-8bit-aac` 的
  `expectedPaths: ["native", "webcodecs"]` 是从未被用例验证过的声明。同一位置的宽高读取用的是
  `entry.dataStart + 24`，本来就把那 8 字节算进去了，所以宽高一直是对的、子盒一直是错的；音频分支
  的 `entry.start + 36` 同样算进去了，只有视频这一处漏了。这个缺陷躲过了单测，因为
  `packages/demux/tests/fixtures/mp4.ts` 的 `visualSampleEntry()` 也只铺 70 字节，读写两边一起错。
  修好之后 `mp4-h264-baseline-8bit-aac` 得到 `avc1.42C01E`、原生与自定义两条路径都实测通过。

- MP4 的 AV1 轨现在从 `av1C` 推出完整的 `av01.P.LLT.DD`。`av01.` 早就在
  `WEBCODECS_CODEC_SCOPE` 里、`video-config.ts` 的 `AV1_CODEC` 也早就要求完整字符串，
  也就是说 AV1 一直是设计内的，只是被上面那个偏移挡住、连带缺了这一步推导。`av1C` 第二字节装
  `seq_profile` 与 `seq_level_idx`、第三字节装 tier 与位深标志，四个字段齐全，不必碰任何 OBU。
  `twelve_bit` 只在高位深 profile 2 下有意义，其余情况按规范当 0 读，免得一个杂散比特凭空造出
  12-bit 流。marker/version 不对、profile 保留值、记录被截断时保留裸 `av01`，与 `vpcC` 的处置一致。
  语料这条样本实测得到 `av01.0.00M.08`（文件声明的 `seq_level_idx` 是 0，不是 4）。

- 策略层不再排出注定失败的候选。能力探测回答的是**浏览器**能不能解码，而引擎自己的 WebCodecs
  后端覆盖面更窄：Chrome 的 `AudioDecoder` 配合容器 CodecPrivate 能解 Vorbis，于是 `flower.webm`
  （VP8 + Vorbis）会先被排进 `webcodecs` 候选、被选中，再在管线初始化时以
  `WEBCODECS_AUDIO_NOT_SUPPORTED` 硬失败。`CapabilityContext` 新增 `webCodecsCodecs`
  （照 `wasmDecoders` 的先例），`@mx-player-max/decoder-webcodecs` 以 `WEBCODECS_CODEC_SCOPE`
  公布自己接受的编码族与两声道上限，引擎构造 context 时传进去；范围之外的编码不再产出候选。
  声明格式只有一个解释器 `codecWithinDecoderScope()`（在 types 里），
  `packages/decoder-webcodecs/tests/codec-scope.test.ts` 把声明与两个 config 构造器的实际行为
  逐个编码比对，两边漂移就转红。

- 撤下候选不会把原因一起丢掉。`StrategyEvaluation` 新增 `exclusions`，决策轨迹把它记成
  `status: 'skipped'` 的 attempt 并带上后端本会报的错误码，所以 A5 的归因文案照旧
  （「这个音频编码在此处无法解码」），报告的 `candidates` 行显示
  `webcodecs-custom:WEBCODECS_AUDIO_NOT_SUPPORTED` 而不是 `none`。真正尝试过的失败优先于被撤下的
  候选来解释失败。实测 `flower.webm` 切自定义档：错误码从 `STRATEGY_ALL_CANDIDATES_FAILED` 变成
  `STRATEGY_NO_VIABLE_BACKEND`，逐候选原因不变，原生档仍正常播放。

- VP9 现在能走自定义管线，原生路径也才真正通。EBML 解复用此前把 VP9 轨道报成裸 `vp09`
  （`V_VP9` 在 WebM/Matroska 里没有 CodecPrivate，容器元数据里根本没有 profile/level/bitDepth），
  而 `VideoDecoder.isConfigSupported({ codec: 'vp09' })` 与
  `canPlayType('video/webm; codecs="vp09, opus"')` 都拒绝这个字符串，于是两个 VP9 样本连一个候选
  都建不出来，一律 `STRATEGY_NO_VIABLE_BACKEND`。**原生路径此前同样不通**：语料里那句
  `expectedPaths: ["native"]` 从来没有用例验证过，去掉推导后实测原生也拿不到候选。现在解复用读
  第一个 Cluster 里该轨道的第一个关键帧的 uncompressed header，取 profile 与 bit depth，再按 VP9
  level 表用帧尺寸和帧率推出 level，产出 `vp09.PP.LL.DD`；读不出关键帧、帧不是关键帧、或者头部
  校验不过时保留裸 id，所以探测的成败与此前完全一致。MP4 侧不需要解码帧，`vpcC` 直接给出这三个
  字段。两个语料样本的 `expectedPaths` 改回 `["native", "webcodecs"]`，由四条浏览器用例背书：
  profile 0 自定义、profile 2（10-bit）自定义、两个 profile 的原生、以及裸 `vp09` 仍被浏览器拒绝。
  这三条用例按浏览器自身的 VP9 探测结果决定是否 skip，而不是按验收结果的 `unsupported`——推导
  一旦回退，报出来的正是 `unsupported` 会放过的那个错误码。

- 媒体验收 harness 的每个脚本化步骤有了名字和独立预算，超时的错误码从一律的
  `MEDIA_ACCEPTANCE_FAILED` 变成 `MEDIA_ACCEPTANCE_TIMEOUT_<step>`。预算从 15 s 提到 25 s
  （等首条 cue 从 3 s 提到 5 s）：本机无 GPU，Firefox 下 10-bit VP9 与 Matroska H.264 走自定义管线
  整条脚本要 41–45 s，单步 15 s 会间歇性把慢跑读成失败。`media-*` 三个 project 的用例超时统一到
  180 s。**出厂默认值未改动**，这些都是验收 harness 的参数。

- Matroska 里的 ASS/SSA 块现在按 CodecPrivate 的 `Format:` 行取字段（减去 Start/End、前置
  ReadOrder），不再假定固定的九字段布局。`Format:` 行更短时——FFmpeg 原样拷贝这类脚本就会这样——
  每个块都被判为字段不全，整条轨道一条 cue 都出不来。规范格式下的行为逐字不变。

- `media-firefox` 上带音轨的自定义路径间歇失败（`WEBCODECS_WORKER_FAILED` / `CUSTOM_SEEK_FAILED`，
  偶尔 45 s 内拿不到终态）。不是解码缺陷：本机无 GPU，Firefox 走自定义管线比 Chromium 慢约 60%，
  脚本化验收会撞上引擎默认的 10 s worker/configure/flush/seek 预算。验收 harness 通过公开选项
  `customVideo.operationTimeoutMs` / `customAudio.operationTimeoutMs` 把该预算提到 30 s，
  `media-firefox` project 的用例超时提到 120 s，harness 内层等待提到 90 s；**出厂默认值未改动**。
  改后连续三轮 3/3、两个媒体 project 全量 30/30 通过。

- 播放失败不再只显示笼统的「播放出错」。引擎对失败只给汇总码（候选全试过是
  `STRATEGY_ALL_CANDIDATES_FAILED`，连候选都建不出来是 `STRATEGY_NO_VIABLE_BACKEND`），真实原因
  只存在于 `decisionTrace` 的逐候选 `attempts[].errorCode` 里，而 UI 此前读不到这份轨迹。现在
  `PlayerUiPlayer` 的 telemetry 带上 `decisionTrace`，`playbackFailureCause()` 把候选错误码归成
  五类——视频编码 / 音频编码 / 声道数 / 容器 / 无可用路径——控制栏状态文案与排查报告共用同一份
  判定，四语言齐备。陈旧轨迹（`sessionEpoch` 不匹配）会被忽略，无法归类时回落到原文案。排查报告
  的环境段新增 `videoCodec`、`audioCodec`（带声道数）与 `candidates`（`候选 id:结果`），复制出来
  的报告自带真实原因。

- 媒体语料里 VP9 样本的路径声明修正为仅 `native`。EBML 解复用把 VP9 轨道报成裸 `vp09`，而
  `VideoDecoder.isConfigSupported({ codec: 'vp09' })` 返回 `false`、`video-config.ts` 要求完整的
  `vp09.PP.LL.DD`，所以 VP9 在任何容器里都走不了自定义管线——两个 WebM VP9 样本实测都是
  `STRATEGY_NO_VIABLE_BACKEND` 且候选数为 0。原先 `["native", "webcodecs"]` 的声明从未被用例
  验证过；新增用例把「裸 `vp09` 不被接受」钉住，补齐 codec 字符串推导后需要一并更新语料。

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
  不再被验证层拒绝。
- `Rt4kSrGraphExecutor` 把整张图录进单个 command encoder 并只提交一次（此前每 pass 一次
  submit + fence，22 层等于每帧 22 次 CPU↔GPU 往返），uniform 改为单缓冲多槽位；
  `uploadTensorStore` 只上传图实际绑定的张量（RT4KSR 51→44，RIFE 198→118）。
- `PackedTexturePool` 复用槽位时允许把层数更多的空闲纹理借给更窄的请求（视图只覆盖前 `groups`
  层），IFNet 的激活池因此从 70 个纹理降到 62 个。

### Removed

- 三个占位 kernel `BILINEAR_WARP_WGSL`、`RIFE_FLOW_WGSL`、`RIFE_IFBLOCK_WGSL` 及其唯一消费者
  ——旧的 `WebGpuInterpolationStage`。它们把输入帧当作光流纹理绑定，并用
  `modelWeights[0] * 1e-8` 假装用到了权重；真实的 `RifeGraphExecutor` 上线后再留着它们只会
  让代码库说谎。`WebGpuInterpolationStage` 现在必须拿到已校验的 MXAI 模型才能构造。

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
