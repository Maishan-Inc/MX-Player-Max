# Chrome、Firefox、Safari 浏览器最优策略

## 1. 基本原则

浏览器不是解码器选择器，媒体格式和播放目标才是第一输入。浏览器与设备能力决定候选是否可用，以及候选之间的性能评分。

```text
媒体格式/Codec + 播放意图
          ↓
候选后端
          ↓
当前浏览器与设备能力
          ↓
平台专属增强
          ↓
最终评分
```

禁止使用 `Chrome = WebCodecs`、`Safari = HTMLVideo`、`Firefox = WASM` 这种硬编码映射。

## 2. 标准检测层

Phase 1 将能力数据分为两层：

1. `CapabilitySnapshot` 只记录浏览器/系统/API/渲染器/WASM 运行环境，不回答某个 Codec 是否可播放。
2. `MediaCapabilityReport` 针对一个规范化媒体配置记录 HTMLVideo、MediaCapabilities、WebCodecs 视频和音频的独立结果。

所有具体结果使用 `supported | unsupported | unknown`。配置字段不足或 API 抛错必须返回 `unknown`，不得通过浏览器名称、文件后缀或常见支持矩阵提升为 `supported`。

### 原生播放

使用 `HTMLMediaElement.canPlayType()` 进行快速粗筛，再使用 `navigator.mediaCapabilities.decodingInfo()` 获取 `supported`、`smooth` 和 `powerEfficient`。Codec 字符串必须包含真实 profile、level、bit depth、width、height、framerate 和 bitrate。

### WebCodecs

使用 `VideoDecoder.isConfigSupported()` 与 `AudioDecoder.isConfigSupported()` 验证具体配置。不能只判断 `VideoDecoder` 构造函数存在，因为浏览器可能支持 API 但不支持具体 Codec 配置。

### 渲染器

按以下顺序探测：WebGPU、WebGL2、Canvas2D。WebGPU 不能用时不应该让自定义解码整体失败，而是降低滤镜和色彩管线能力。

### WASM

只在选择 WASM 后检测 `WebAssembly.validate`、SIMD、Threads、`crossOriginIsolated`、`SharedArrayBuffer`、Worker 和内存上限。多线程构建不能在未隔离页面中强行启动。

## 3. Chromium 专属增强

Chromium 的优势是 WebCodecs、WebGPU 和部分 Worker MediaSource 能力组合较完整。当前文件型媒体路径中，优先利用：

- WebCodecs 视频/音频逐帧解码。
- WebGPU 外部纹理或高效纹理上传。
- WASM SIMD/Threads（页面允许时）。
- 未来流媒体场景的 Dedicated Worker MediaSource/MediaSourceHandle。

Worker MediaSource 不属于首阶段文件播放器的必需能力。没有它时，Demux Worker 仍然可以通过自定义 Range 管线工作。

Phase 11 实现只在 `CapabilitySnapshot.workerMediaSource` 与
`webGpuFeatures.importExternalTexture` 已实际探测成功时输出对应增强。Chromium 的
WebCodecs + WebGPU 小幅加分还要求媒体级 WebCodecs 报告为 supported；关闭任一可选能力
只会移除这项加分，不会移除 WebCodecs/WebGL2/Canvas2D 通用候选。

## 4. WebKit/Safari 专属增强

WebKit 适合优先利用系统原生媒体能力：

- 原生 HLS 和系统级网络/功耗策略。
- 系统 HEVC、HDR、AirPlay、FairPlay 和原生 PiP 能力。
- `ManagedMediaSource` 可作为未来 HLS/DASH 的省电流媒体后端。
- `fastSeek()` 可用于原生路径的快速近似定位。

对 MP4/H.264/H.265/AAC 等普通文件，如果 `decodingInfo` 显示平滑且低功耗，Safari 的 HTMLVideo 候选应获得更高分。对 MKV 或冷门 Codec，必须回到 WebCodecs/WASM，不能因为 Safari 有原生 HLS 就强行使用原生路径。

Phase 11 分别探测固定 HLS/HEVC `canPlayType()`、HDR display media query、
ManagedMediaSource、AirPlay 和标准/WebKit PiP。HEVC/HDR/HLS 偏好只作用于已经存在且媒体级
Native 报告支持的 HTMLVideo 候选；单个增强信号不能创建 Native 或 MSE/HLS 候选。

## 5. Gecko/Firefox 专属增强

Firefox 的核心路径仍然是标准 API和能力检测：

- WebCodecs 具体 Codec 配置检测。
- WebGPU 可用时启用自定义 GPU 渲染。
- `fastSeek()` 用于原生快速定位。
- `getVideoPlaybackQuality()` 作为通用播放质量指标。
- `mozDecodedFrames`、`mozPresentedFrames`、`mozPaintedFrames`、`mozFrameDelay` 仅作为诊断和回归数据，不参与硬编码后端选择。

Firefox 当前不应被假设支持 Worker MediaSource。流媒体插件需要单独检测 `MediaSource.canConstructInDedicatedWorker` 与 `MediaSource.handle`。

Phase 11 把标准 `getVideoPlaybackQuality()` 与 `mozDecodedFrames`、`mozPresentedFrames`、
`mozPaintedFrames`、`mozFrameDelay` 分开记录。后者只出现在诊断快照，不参与评分。

## 6. 评分模型

建议分数由以下因素组成：

```text
support                 不支持则淘汰
hardware/power          +40
smooth                  +30
zero-copy               +20
startup                 +10
advanced-frame-access   +20（按需求）
memory-risk             -20
known-platform-risk     -100
```

普通播放的额外权重是功耗和硬件解码；滤镜/编辑器的额外权重是逐帧访问和 WebGPU；HDR 场景优先保留原生色彩路径，除非自定义渲染器已经完成色彩管理。

## 7. 快照和缓存

能力快照按浏览器品牌、版本、操作系统、GPU 标识、Codec 配置和 SDK 版本缓存。缓存只用于减少探测，不得绕过初始化失败回退。平台 Bug 黑名单必须带版本范围、Issue 链接、失效日期和测试样本。

Phase 11 将该要求实现为 `PlatformIssueRule`。规则必须是负向评分，非法、正向、版本无效或
过期规则被忽略，并且只能匹配现有候选。首条内建规则对应 Firefox Bugzilla #1918769，
覆盖已验证的 130-145 版本 H.264 WebCodecs configure 风险；规则降低优先级，但不把
`isConfigSupported()` 结果改写为 unsupported，初始化 try/catch 与原子回退仍然必须保留。

WebCodecs 没有标准接口报告最终选中了硬件还是软件实现。Phase 11 的诊断记录器只保存
decoder adapter 明确提供的 `requestedPreference`/`selected`，否则记录 `unknown`；不得从
`powerEfficient` 或 config supported 推断硬件选择。

实现上，环境快照和媒体报告使用不同缓存键。键包含 capability schema、SDK 版本、规范化浏览器/系统、跨源隔离状态；媒体报告键额外包含 WebGPU 快照与规范化 Codec 查询。默认缓存为内存加可用时的 `sessionStorage`，`forceRefresh` 可绕过缓存。缓存内容损坏或存储不可用时必须退回实时探测。

缓存记录的写入时间不进入公共快照。原因数组统一排序，策略排序不依赖异步 API 完成顺序。

## 8. 选型伪代码

```ts
const candidates = registry.createCandidates(media, intent)
const viable = await capabilityProbe.filter(candidates, media)
const enhanced = platformPolicy.adjust(viable, media, intent)
const selected = score(enhanced).best()
return backendLoader.start(selected)
```

“毫秒级”只承诺本地能力判断和策略评分。远程文件的容器/Codec 探测时间取决于 Range 请求和网络 RTT，必须通过并行探测、最小 Range、缓存和预读降低等待。

## 9. Phase 8 字幕兼容说明

字幕内核不按浏览器名称选择实现。SRT/ASS 解析、轨道排序和 epoch 位于平台无关代码；浏览器只提供 DOM、Fetch、ResizeObserver、Fullscreen 和媒体时钟能力。

| 环境 | Native 字幕时钟 | Custom 字幕时钟 | Overlay | 外挂 URL |
|---|---|---|---|---|
| Chrome/Chromium 桌面 | `HTMLVideo.currentTime` | AudioContext sample clock / MediaWallClock | video/canvas 宿主；ResizeObserver/fullscreen 待真实 smoke | HTTPS + CORS |
| Firefox 桌面 | 同上 | 同上 | 同一 DOM 实现；字体 fallback/resize 待真实 smoke | HTTPS + CORS |
| macOS Safari 桌面 | 同上 | AudioDecoder 可用时 AudioContext，否则实际所选媒体墙钟路径 | WebKit fullscreen/字体/ResizeObserver 待真实 smoke | HTTPS + CORS |

`textContent`、Fetch CORS、ResizeObserver 和 Fullscreen API 的真实布局/安全表现仍需在最新两个稳定大版本执行。Vitest fake DOM 只验证代码契约，不作为三浏览器通过证据。PGS/VobSub、系统原生 TextTrack 菜单和完整 libass 不在 Phase 8 兼容声明内。

## 10. Phase 9 UI 兼容说明

UI 不读取 browser、decoder 或 renderer 名称。Core 把 Native HTMLVideo 与 Custom clock/queue/presentation 归一化为同一个 `PlaybackSnapshot`，UI 只按 capability 控制显示和禁用状态。

| 能力 | Native `<video>` | Custom `<canvas>` | 不支持时 |
|---|---|---|---|
| 播放/暂停/seek/音量/倍速 | SDK 公共命令 | 同一 SDK 命令 | 按 snapshot capability 禁用 |
| played/buffered | HTMLMediaElement ranges 归一化 | clock progress + bounded horizon | 未知值显示安全占位 |
| fullscreen | 共享宿主容器 | 共享宿主容器 | 控件禁用 |
| PiP | 经验证的原生 video PiP | Phase 9 不支持 | 控件禁用 |
| preview | 隔离 media element/canvas | 可选宿主 provider | 图片安静隐藏，seek 保持可用 |
| subtitles | Phase 8 video clock + overlay | Phase 8 AudioContext/墙钟 + overlay | 轨道/状态 API 决定界面 |

Playwright 配置运行 Chromium desktop/mobile、Firefox 与 WebKit 的 DOM/CSS/交互断言，并提交 Chromium desktop/mobile baseline。它们不等价于真实 latest-two-stable 或 macOS Safari 验证。

| 环境 | 自动化 | 真实浏览器状态 |
|---|---|---|
| Chromium desktop/mobile | Playwright behavior + screenshot | Chrome/Chromium 最新两个稳定大版本 pending |
| Firefox desktop | Playwright behavior/layout | Firefox 最新两个稳定大版本 pending |
| Playwright WebKit | behavior/layout | macOS Safari 最新两个稳定大版本 pending；不得用 WebKit run 替代 |

真实环境仍需验证实际 Codec/媒体画面、CORS canvas preview、PiP/fullscreen、font fallback、DPR/resize、触摸/键盘和长时间资源清理。精确命令、截图与 pending 项记录在 `development/phase-9-acceptance.md`。

## 11. Phase 11 实现状态

`@mx-player-max/platform` 已交付以下公共边界：

- `detectPlatformEnhancements()` 与可注入 `PlatformRuntimeAdapter`。
- `createPlatformPolicy()`、每候选唯一 adjustment 和可审计 `PlatformIssueRule`。
- `createPlatformDiagnostics()`、标准/Gecko 帧统计与显式 WebCodecs 加速观测。
- Firefox #1918769 版本回归夹具和规则过期/版本变化/缺特性单元测试。

这些自动化验证 API 合约和降级行为，不构成 Chrome、Firefox、macOS Safari 最新两个稳定
大版本的真实 Codec、AirPlay、系统 PiP、HDR display、ManagedMediaSource 或 external
texture 通过证据。真实环境矩阵记录在 `development/phase-11-acceptance.md`。
