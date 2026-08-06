# MX-Player-Max 工程规范

## 1. 项目身份

MX-Player-Max 是面向桌面 Chrome/Chromium、Firefox 和 Safari 的模块化 Web 媒体引擎与播放器 SDK。项目目标不是只做一个页面播放器，而是建立可以复用于视频编辑器、监控回放、云游戏串流和在线转码预览的媒体能力层。

当前仓库从零开始，采用 pnpm Monorepo，SDK 对外提供原生 JavaScript/TypeScript API，并预留 React 与 Vue 适配层。演示站点是独立应用，使用 Docker 部署，不以 GitHub Pages 作为运行环境。

## 2. 已确认的产品决策

- 首阶段优先完成架构、接口和可替换模块，不追求一次性接入全部 Codec。
- 交付形态为 Monorepo SDK + 独立高端演示站。
- 演示站使用 GSAP，但视觉设计不得复制 MX-Player-Pro 的页面结构和样式。
- 首阶段桌面优先：Chrome/Chromium、Firefox、macOS Safari 的最新两个稳定大版本；移动端在桌面管线稳定后进入兼容阶段。
- 首阶段处理本地文件与支持 CORS/HTTP Range 的远程文件；HLS/DASH/直播只保留扩展接口。
- 普通播放优先使用 HTMLVideo 原生路径。
- 需要逐帧、滤镜、AI 或 WebGPU 的场景使用 WebCodecs/WASM 自定义路径。
- HTMLVideo 与自定义帧管线保持双渲染路径，不强制把原生视频转换为 VideoFrame。
- 自定义路径统一输出 `VideoFrame`，音频统一输出 `AudioData` 或 PCM。
- WebGPU 为首选自定义渲染器，WebGL2 和 Canvas2D 作为降级渲染器。
- 对外只发布一个 SDK 版本；WASM 内部按需包含单线程与多线程构建产物，由运行时自动选择。
- 进入 WASM Decoder 后才判断单线程/多线程，不在 HTMLVideo 或 WebCodecs 选择阶段加载 WASM。
- 字幕首阶段支持内嵌/外挂 SRT、ASS/SSA 文本轨，提供轨道切换、字体、字号、位置、颜色、描边和本地样式保存；PGS/VobSub 后续加入。

## 3. 强制架构边界

```text
Source / Range Loader
        ↓
Container Demuxer
        ↓
Codec & Track Metadata
        ↓
Decoder Strategy Engine
  ├─ NativeMediaPipeline (HTMLVideo + 原生音频)
  └─ CustomMediaPipeline
       ├─ WebCodecs Decoder
       └─ WASM Decoder Manager
        ↓
VideoFrame / AudioData / SubtitleCue
        ↓
Renderer + AudioWorklet + Subtitle Overlay
```

每个模块只负责一个边界：

- `types`：公共数据契约，不包含平台逻辑。
- `capabilities`：探测浏览器、设备、Codec、WebGPU、WASM 能力，不负责选择业务后端。
- `strategy`：根据媒体信息、播放需求和能力评分选择后端。
- `demux`：容器解析、Range 读取、轨道和压缩包输出，不做解码。
- `decoder-*`：只实现对应解码后端，并输出统一帧/音频数据。
- `renderer-*`：只消费帧，不知道文件格式和解码器细节。
- `audio`：PCM 缓冲、AudioWorklet 输出、音频主时钟和漂移修正。
- `subtitles`：字幕解析、轨道管理、样式和覆盖层渲染。
- `sdk`：组合模块并暴露稳定公共 API。

禁止在 `core` 内直接写浏览器名称分支、Codec 解码实现或 UI 组件。浏览器专属行为必须进入 `platform-*` 或策略插件。

## 4. 浏览器与能力检测规则

媒体格式和播放需求决定候选后端；浏览器只提供能力约束和优化提示。禁止实现如下硬编码：

```text
Chrome = WebCodecs
Safari = HTMLVideo
Firefox = WASM
```

必须按以下顺序执行：

1. 识别容器、视频 Codec、音频 Codec、分辨率、帧率、位深和 HDR 信息。
2. 读取缓存的浏览器能力快照。
3. 使用 `canPlayType`、`MediaCapabilities.decodingInfo`、`VideoDecoder.isConfigSupported` 和 `AudioDecoder.isConfigSupported` 验证候选。
4. 根据硬件解码、低功耗、无拷贝、启动时间和高级处理需求评分。
5. 只初始化最终后端；失败后按候选顺序原子回退。

浏览器专属优化可以改变评分或启用可选能力，但不能跳过实际能力检测：

- Chromium：WebCodecs、WebGPU 外部纹理、Worker MediaSource/MediaSourceHandle 作为自定义和未来流媒体优化。
- WebKit：原生 HLS、HEVC/HDR、ManagedMediaSource、AirPlay/FairPlay/系统 PiP 作为原生路径优化。
- Gecko：WebCodecs、`fastSeek` 和 Firefox 专属帧统计作为能力与诊断增强，不把私有统计当解码后端。

## 5. WASM 规则

- WASM 解码器按 Codec 插件化，优先接入专用解码器，FFmpeg 作为最后兜底。
- 对外只有一个 SDK 版本；内部可以同时存在 `single` 与 `threaded` 变体。
- 仅在选定 WASM 后检查 `crossOriginIsolated`、`SharedArrayBuffer`、WASM Threads、SIMD 和 Worker 能力。
- 多线程初始化失败必须自动回退单线程，不能让播放器整体失败。
- WASM、Worker 和 AudioWorklet 必须支持按需加载和版本化缓存。
- 每个 WASM 包必须记录来源、版本、许可证、编译选项和是否包含专利风险说明。
- 在未完成许可证与专利审查前，不得把 FFmpeg、OpenH264、libde265、VVdeC 等二进制产物标记为可发布。

## 6. 音视频同步规则

`NativeMediaPipeline` 由 HTMLVideo 负责音画同步。`CustomMediaPipeline` 使用 AudioContext 时钟作为有音频内容时的主时钟，没有音频时才使用媒体墙钟。视频渲染器按时钟决定显示、等待或丢帧。任何 seek、轨道切换、解码器 reset 都必须提升 epoch，丢弃旧 epoch 的异步消息。

音频不得在主线程中为每个小块创建独立播放节点。优先使用 AudioWorklet + PCM ring buffer，未跨源隔离时使用 MessagePort 缓冲降级。

## 7. 远程媒体安全要求

远程文件必须支持 HTTPS、CORS、GET Range、`206 Partial Content`、`Content-Range` 和稳定的 `Content-Length` 或可处理的未知长度。播放器不代理远程视频，不上传用户本地文件。

所有 URL、Range、Content-Range、Codec 私有数据和字幕输入都要校验边界。禁止把远程媒体响应当作可信 HTML、脚本或 SVG 执行。字幕文本默认按纯文本渲染，ASS 特效只在明确实现的白名单范围内解析。

## 8. TypeScript 与包规范

- 开启 `strict`、`noUncheckedIndexedAccess` 和 `exactOptionalPropertyTypes`。
- 禁止 `any`；第三方不完整类型必须建立最小本地声明。
- 公共 API 必须有显式返回类型和稳定错误码。
- 包之间只能通过公共入口依赖，不得跨包引用内部文件。
- 每个包必须有 `README.md`、`package.json`、`tsconfig.json`、`src/index.ts` 和测试目录。
- Worker、AudioWorklet、WASM loader 和 UI 适配层不得反向依赖演示站。

## 9. 测试与验收

每个解析器、能力探测器、策略评分器、字幕解析器、时钟和缓冲区都必须有单元测试。浏览器测试至少覆盖 Chrome、Firefox、Safari 桌面最新两个稳定大版本，并为每个 Codec 保存最小可再现媒体样本和探测结果。

性能验收至少记录：首帧时间、首音时间、Seek 延迟、缓冲前向、Dropped Frames、音画漂移、CPU、内存和功耗代理指标。跨源隔离环境与非隔离环境都必须有测试。

## 10. 开发顺序

1. 阅读本文件和对应 `docs/` 文档。
2. 先修改公共类型、接口或测试夹具。
3. 再实现服务无关的核心逻辑。
4. 再实现 Worker、WASM 和浏览器适配器。
5. 最后实现演示站 UI、GSAP 动画和文档示例。
6. 运行类型检查、单元测试和三浏览器回归测试。

## 11. 提交与完成标准

提交信息使用 `feat(core): ...`、`feat(decoder): ...`、`fix(browser): ...`、`docs(architecture): ...` 等格式。完成一个功能必须同时更新公共 API 文档、测试、变更记录和必要的浏览器兼容说明。

