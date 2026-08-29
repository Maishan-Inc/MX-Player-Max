# 渲染模式切换 + Matroska + 失败归因 验收记录

日期：2026-08-23；2026-08-25 复测全部门禁，并补上 `media-webkit-automation` 的浏览器能力探测；2026-08-27
把最后两条按 project 名自限的 WASM 用例改为按浏览器能力探测，并让原生探针分辨「夹具没被服务」与
「浏览器解不动」；2026-08-28 补上计划 §7 第 2 项缺的那次手工核对——native 档下两个 AI 开关灰显，
同日补回该项另一半的 MKV（VP9+Opus）夹具与两条用例；2026-08-29 补上语料缺的 AV1-in-Matroska 与
10-bit VP9-in-Matroska 两条夹具、四条用例，并修掉 EBML 适配器忽略 AV1 CodecPrivate 的缺陷

对应计划：[`docs/superpowers/plans/2026-08-23-render-mode-switch-and-mkv-ai-plan.md`](../superpowers/plans/2026-08-23-render-mode-switch-and-mkv-ai-plan.md)

范围：该计划的 A 组（A1、A1b、A2、A3、A4、A5、A7、A8），加上运行时渲染模式切换与决策轨迹的
intent 排除记录，以及 2026-08-25 的 WebKit 能力探测。B 组（AI 开关端到端、性能证据、真实浏览器
矩阵）仍为 **pending**，原因见文末环境事实——本机只有软件 WebGPU 适配器。

逐包测试数以生成证据
[`evidence/current-test-counts.json`](evidence/current-test-counts.json) 为准，不在本文件手工维护。
`pnpm test` 会重新执行全部 workspace 测试并与该文件比对，数量变化需显式 `pnpm test:update-counts`
并审查 diff。

## 自动化结果

下表为 2026-08-25 的实测结果，每一行都是这一轮亲手跑出来的。浏览器相关的四行在 2026-08-27
随能力探测改动重跑，标注了当天的日期。

| 命令 | 结果 |
|---|---|
| `pnpm build` | passed；20 个 workspace package/app 完整构建 |
| `pnpm test` | passed；总数见 `evidence/current-test-counts.json`，与生成计数一致 |
| `pnpm test:update-counts` | 已重新生成 `evidence/current-test-counts.json`；2026-08-25 这轮无需再生成，`pnpm test` 与该文件一致 |
| `pnpm quality:acceptance-drift` | passed |
| `pnpm quality:media` | passed；13 个媒体 + 2 个字幕 fixture，SHA-256 与字节数一致（含 6 条 Matroska；2026-08-29 加入 `mkv-av1-p0-8bit-opus.mkv` 与 `mkv-vp9-p2-10bit-opus.mkv` 后重跑） |
| `pnpm test:browser` | passed；89 passed / 23 skipped / 0 failed，9 个 project，38.5 min（2026-08-28 重测）。这一轮 `media-firefox` 在**有**音频那一侧；无音频那一侧会少 8 条 passed、多 8 条 skipped。相比 2026-08-27 的 77 passed / 29 skipped，多出的 12 条是新增两条 MKV VP9 用例在 `media-chromium` 与 `media-firefox` 各跑起来的 4 条，加上 `media-firefox` 这轮音频可用的 8 条；`media-webkit-automation` 把这两条按能力探测跳过，所以 skipped 是 −8+2 |
| `pnpm test:browser --project=media-chromium --project=media-firefox` | passed；0 failed。2026-08-29 加入四条新用例（AV1-in-Matroska 与 10-bit VP9-in-Matroska 各两条路径）后重跑，`media-chromium` 32 passed / 0 skipped、`media-firefox` 32 passed / 0 skipped（这一轮音频可用，全部四条新用例都跑了起来）；`media-firefox` 仍视本机音频状态而定，无音频那一侧会跳掉所有带 `rendersAudio` 探针的用例——四条新用例里的两条自定义用例也在其中，见下「音频输出能力是间歇的」一节。10-bit VP9 in Matroska 的自定义用例在 Firefox 整条脚本 45 s，仍是语料里最慢的一档 |
| `pnpm test:browser --project=media-webkit-automation` | passed；7 passed / 25 skipped / 0 failed（2026-08-29 重跑）。25 条 skip 全部由浏览器能力探测决定，四条新用例也在其中——两条自定义没有 WebCodecs，两条原生的 `playsNatively` 在这里收场，见下「Playwright WebKit」一节 |
| `pnpm test:browser --project=chromium-desktop --project=chromium-mobile` | passed；12 passed / 0 skipped（2026-08-27 重测；原先的 2 条 skip 是 WASM 用例按 project 名自限，改按浏览器 WebCodecs 探测后 `chromium-mobile` 也跑，两条都过） |
| `pnpm test:browser --project=firefox-simulated --project=webkit-simulated` | passed；10 passed / 2 skipped（2026-08-27 重测；2 条 skip 都落在 `webkit-simulated`，由 WebCodecs 探测决定——Playwright WebKit 没有 `VideoFrame`，libvpx 的 plane 出不了线性内存。`firefox-simulated` 现在两条 WASM 用例都跑。同一条命令另有一次把 `webkit-simulated` 的 `ui.spec.ts` overlay 用例跑成 1 failed，重跑即过，整套 `pnpm test:browser` 那一轮也是 0 failed，属本机 WebKit 抖动，不是本次改动引入的） |
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
| A7 补（2026-08-28） | 第 4 条 Matroska 夹具 `mkv-vp9-p0-8bit-opus.mkv`（VP9+Opus，`-bitexact`）与验收模式 `mkv-vp9-native` / `mkv-vp9`。A4 当初把这条从 VP9 改成 VP8，理由是裸 `vp09` 在任何容器里都没有自定义路径；A7 的推导消掉了那个理由，而「Matroska × 需要从关键帧推导 codec 字符串」在此之前一条用例都没覆盖，这一条同时兑现计划 §7 第 2 项里 MKV（VP9+Opus）那一半 | `media-paths.spec.ts` 两条用例，skip 只由 `playsNatively('mkv-vp9-p0-8bit-opus.mkv')` 与 `decodesWithWebCodecs({ video: 'vp09.00.11.08', audio: 'opus' })` 决定，随后无条件断言 `videoCodec: 'vp09.00.11.08'`。`expectedPaths` 是量出来的而不是照抄 WebM 那条：两条路径在 Chromium 与 Firefox 都通，所以是 `["native","webcodecs"]`。变异验证：把 EBML 的 VP9 推导抽掉后四条（两浏览器 × 两路径）全部**转红**而不是 skip——轨道退回裸 `vp09`，自定义档报 `STRATEGY_NO_VIABLE_BACKEND`、原生档报 `NATIVE_NOT_SUPPORTED` |
| 语料扩展（2026-08-29） | 两条 Matroska 夹具（均 `-bitexact`）：`mkv-av1-p0-8bit-opus.mkv`（AV1 Main 8-bit + Opus，语料里第一条 AV1 的 Matroska 样本）与 `mkv-vp9-p2-10bit-opus.mkv`（VP9 profile 2 10-bit + Opus，补齐 10-bit VP9 的 Matroska 一半），各配 `*-native` / 自定义两个验收模式 | `media-paths.spec.ts` 四条用例，skip 只由 `decodesWithWebCodecs({ video: 'av01.0.00M.08' | 'vp09.02.11.10', audio: 'opus' })` 与 `rendersAudio` / `playsNatively` 探针决定，随后无条件断言 `videoCodec`。`expectedPaths` 是量出来的（见下「AV1 与 10-bit VP9 的 Matroska 实测」），两条都是 `["native","webcodecs"]`；chromium 与 firefox 各 32 passed，webkit-automation 按探测跳过 |
| AV1 CodecPrivate 推导（2026-08-29） | EBML 适配器此前忽略 `V_AV1` 轨的 CodecPrivate、只发布裸 `av01`，而 FFmpeg 9.0 写进去的正是一条 `av1C` 记录（夹具实测 17 字节，`0x81` 开头）——profile/level/tier/bit depth 全在记录里却没人读，于是一条能播的 Matroska AV1 文件在任何档位都报无路径。读取器抽到 `containers/av1.ts` 供 MP4 与 EBML 共用，MP4 侧行为逐字不变；Matroska 侧缺记录或记录非法时保留裸 `av01`，回落策略与 VP9 关键帧推导一致 | `packages/demux/tests/codec-av1.test.ts` 两条新用例（Matroska CodecPrivate 推导出 `av01.0.00M.08`；无 CodecPrivate 保留裸 `av01`）；上面四条浏览器用例里的 AV1 两条同时是它的端到端护栏——撤掉推导后转红而不是 skip。顺带量出的一个事实：`VideoDecoder` 在 Chromium 151 / Firefox 153 的页面全局是 `undefined`，只在 Worker 作用域暴露，所以 WebCodecs 探测必须进 Worker 做 |
| 任务 4 | 轨迹记录「原生候选因 intent 被排除」，UI 给出「切回原生档」提示 | `strategy.test.ts` 6 条（三种自定义 intent 产出 exclusion、两种原生 intent 不产出、原生本就不通时不产出）；`player-ui-menu.test.ts` 4 条（归因顺序、无候选时不提示、陈旧轨迹忽略、状态栏文案） |
| 任务 5 | 运行时 Native ↔ Custom 切换（`switchRenderMode`） | `packages/core/tests/render-mode-switch.test.ts` 5 条（双向切换、epoch 递增与位置连续、同档 no-op、未载入时拒绝、失败回滚）；`tests/browser/media/render-switch.spec.ts` 真切一次并断言渲染器 native→canvas2d、位置不回退、字幕轨存活（chromium 与 firefox 都通过） |
| A8 | 引擎自身的编码范围传进策略层，范围外不产出候选；撤下的候选以 `skipped` attempt 保留原因 | `packages/strategy/tests/strategy.test.ts` 7 条（三类范围外、两种 intent 的候选 id、范围内仍排出、未声明时行为不变、纯视频轨）；`packages/decoder-webcodecs/tests/codec-scope.test.ts` 24 条声明与构造器逐编码比对；`packages/core/tests/decision-trace.test.ts` 的 skipped attempt 索引；`player-ui-menu.test.ts` 2 条归因优先级与报告行 |
| 2026-08-25 | 媒体浏览器用例改为「先探浏览器能力，再无条件断言」，探针集中在 `tests/browser/media/capabilities.ts` | 三个 media project 的 26 条用例；探针问的是浏览器（媒体元素能否解出这条夹具、`VideoDecoder` / `AudioDecoder` / `VideoFrame` / `AudioContext` 在不在、`AudioContext` 能否 running），不是验收结果的 `status === 'unsupported'`，因此 A7 与 A1 那两类「回归表现为 skip 而不是转红」的陷阱在整个目录里都堵上了 |
| 2026-08-27 | 两条 libvpx WASM 用例（`packages/ui/tests/playwright/wasm-decoder.spec.ts`）从按 project 名自限改为复用同一份 `hasWebCodecs` 探针；`playsNatively` 在解码之前先确认 `/quality-media/` 真的把这条夹具发了出来 | 语料一旦停止被服务，8 条调用 `playsNatively` 的用例加 `render-switch` 那条、一共 9 条会转红而不是跳过——实测把夹具名换成不存在的一条，`media-chromium` 与 `media-webkit-automation` 都以 `Corpus fixture is not served: GET /quality-media/... answered 404 with 0 bytes` 失败；改动前媒体元素对 404 报的是 `MEDIA_ERR_SRC_NOT_SUPPORTED`（Chromium 与 Firefox 都实测过），与「浏览器拒收这个编码」同一个码，探针只会答 false 然后跳过。WASM 那两条的 skip 现在只在没有 `VideoFrame` 的浏览器出现，`chromium-mobile` 与 `firefox-simulated` 由此各多跑起来 |

## 手工核对（构建产物 + preview）

| 场景 | 观察 |
|---|---|
| 设置面板切 WebGPU 档 | 启动器同步为 `frame-access`，反向亦同步；诊断面板渲染器 `webgpu` |
| 切 WebGL2 档 | 渲染器 `webgl2`，AI 两个开关灰显并给出渲染路径原因 |
| MKV（H.264+AAC）在 native 档下的两个 AI 开关（2026-08-28） | 构建产物 + `vite preview`，headless Chromium（`channel: 'chromium'` + `--enable-unsafe-webgpu`，`locale: zh-CN`，1280×800）载入 `/quality-media/mkv-h264-baseline-8bit-aac.mkv`。native 档：后端 `html-video`、渲染器 `native`、主时钟原生媒体时钟、读出行 `H.264/AVC · 320×180 · 30 fps · AAC · 1ch · 48 kHz · MATROSKA`；设置面板的 AI 区块里超分辨率与插帧两行都是灰的——`input[type=checkbox]` 的 `disabled: true`、`checked: false`、`cursor: not-allowed`，每行下面各跟一条原因文案，两条都是渲染路径那一条「把渲染模式切换到 WebGPU 自定义管线后才能开启。」（AI 区块在这个视口下位于面板折叠线以下，要滚到底才看得见）。在同一个面板里把渲染模式切到 WebGPU 档后：后端 `webcodecs`、渲染器 `webgpu`、主时钟 `audio-context`、启动器同步为 `frame-access`，两个开关**仍然**灰显，但两条文案都换成「此设备没有可用的 WebGPU 适配器。」——即 `device-capability`，因为本机适配器是 `google/swiftshader`、`isFallbackAdapter: true`。三轮结果逐字一致；唯一没跑完的那次是在产物正被重新构建时启动的，超时发生在载入阶段，与开关判定无关。全程无 page error。这一项不需要 GPU：`packages/core/src/index.ts:840` 的判定只看「渲染器不是 WebGPU 或拿不到 `decodedFrameSource`」，与适配器无关；同一对文案的单元覆盖在 `packages/ui/tests/player-ui-menu.test.ts` 与 `packages/core/tests/playback-snapshot.test.ts`，这里补的是端到端的一次实看 |
| 「三档都能正常播放**且有声音**」里的听觉部分 | **本机核不到，没有用耳朵验过。** MMDevices `Render` 下三个端点这一轮仍然都是 `DeviceState = 4`（NOTPRESENT），没有可听的输出端点。替代证据全在自动化里，钉的是「音频真的被渲染出去了」而不是「听见了」：`mkv` 模式断言 `audioClockSource === 'audio-context'` 且 `audioRenderedFrames > 0`，`mkv-vp8` 模式断言 `audioRenderedFrames > 0`（两条都在 `tests/browser/media/media-paths.spec.ts`）。真正的听觉验收留给有音频输出端点的机器 |
| `/models/weights/rt4ksr/rt4ksr_x2.mxai` | 200，612953 字节；`/models/../package.json` 取不到仓库文件 |
| `flower.webm`（VP8 + Vorbis）切自定义档 | 状态文案指出音频编码不支持，报告含 `WEBCODECS_AUDIO_NOT_SUPPORTED`、`audioCodec: vorbis 2ch`；A8 之后候选不再产出，错误码由 `STRATEGY_ALL_CANDIDATES_FAILED` 变为 `STRATEGY_NO_VIABLE_BACKEND`，逐候选原因不变 |
| HEVC MP4 切自定义档 | 状态文案指出没有可用路径，报告含 `videoCodec: hvc1`、`candidates: none` |

## 已知限制与未完项

- **AI 两个开关在本机无法端到端验收。** WebGPU 只能拿到 `google/swiftshader`
  （`GPUAdapterInfo.isFallbackAdapter === true`），引擎据此一律报 `device-capability`。
  归入计划的 B 组，需换有真实 GPU 的机器。不可验的是**把它们打开**；灰显与原因文案这一侧已经在上面的
  手工核对里实看过。同一个判定顺序（`renderer-path` → `device-capability` → `model-unavailable`）还有
  一个推论：Pages 那条「宿主未配置 AI 模型根目录」的文案在本机也永远出不来，因此计划 §7 第 5 项同样
  归 B 组，理由写在计划里。
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
| WebCodecs | Chromium 与 Firefox：`VideoDecoder` 支持 vp8 / avc1.42C01E / vp09.PP.LL.DD / av01.0.00M.08，裸 `vp09` / 裸 `av01` 不支持；`AudioDecoder` 支持 opus / mp4a.40.2。Playwright WebKit：整套 WebCodecs 都不存在。**注意作用域**：`VideoDecoder` 在两个浏览器的页面全局是 `undefined`，只在 Worker 里暴露（2026-08-29 实测），探测要进 Worker 做 |
| Chrome 原生 Matroska | `avc1+mp4a` → `probably`；`vp8+opus` → `probably`；`vp9+opus` → 空串；`vp09.00.11.08+opus` → `probably`（2026-08-28 补测，Firefox 对 `vp9+opus` 与推导串都回 `probably`）；`av01+opus` → 空串、`av01.0.00M.08+opus` → `probably`、`vp09.02.11.10+opus` → `probably`（2026-08-29 补测，Chromium 与 Firefox 一致） |
| 原生 VP9 codec 字符串 | `video/webm; codecs="vp09, opus"` → 空串；`codecs="vp09.00.11.08, opus"` → `probably`（Chromium 与 Firefox 都是）。换成 `video/x-matroska` 同样成立：抽掉 EBML 推导后引擎在两个浏览器都报 `NATIVE_NOT_SUPPORTED`，推导串则 `probably` 且真解出画面（Chromium 32 帧 / Firefox 35 帧，2026-08-28 实测） |
| AV1 与 10-bit VP9 的 Matroska 实测（2026-08-29） | 探针（headless Playwright + demo preview 服务）量出：两浏览器对 `video/x-matroska` 配裸 `av01` / 裸 `vp09` 一律回空串，配 `av01.0.00M.08` / `vp09.02.11.10` 都回 `probably`；Worker 内 `VideoDecoder.isConfigSupported` 对两条完整串（AV1 带不带 `av1C` description 都一样）回 `supported: true`、对裸 `av01` 回 `false`；媒体元素真解出两条夹具的画面（Chromium 到 `loadeddata` 时已有解码帧；Firefox 到 `loadeddata`，帧数在播放中才前进）。因此两条样本的 `expectedPaths` 都是量出来的 `["native","webcodecs"]`，四条用例在两浏览器全部通过 |
| Playwright WebKit | Version/26.5、AppleWebKit 605.1.15；`canPlayType` 对任何类型都回 `probably`；只有 H.264 MP4 能真解出画面（且不稳定），Matroska 永远拿不到 metadata |
| 浏览器版本 | Playwright chromium 151.0.7922.34、firefox 153.0、webkit 26.5 |
| 工具链 | ffmpeg 9.0、pwsh 7、Playwright chromium（`channel: 'chromium'` + `--enable-unsafe-webgpu`） |
