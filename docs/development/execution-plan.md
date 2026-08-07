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

## 2. 阶段总览

```text
Phase 0 规范与脚手架              已完成
Phase 1 公共类型与能力探测        下一阶段
Phase 2 Range Loader 与容器抽象
Phase 3 NativeMediaPipeline
Phase 4 WebCodecs CustomMediaPipeline
Phase 5 音频时钟与 AudioWorklet
Phase 6 WebGPU/WebGL2/Canvas2D
Phase 7 SRT/ASS 字幕
Phase 8 WASM Decoder Manager
Phase 9 浏览器平台优化
Phase 10 SDK、演示站与发布
Phase 11 质量、安全和性能固化
```

## 3. Phase 0：规范与脚手架

状态：已完成。

### 已交付

- `AGENTS.md` 工程规范。
- 架构、Codec、音频、字幕、WASM、浏览器和安全文档。
- pnpm Monorepo 与 14 个包。
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

## 8. Phase 5：音频时钟与 AudioWorklet

目标：让自定义视频管线具备可长时间稳定的音频输出。

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

## 9. Phase 6：WebGPU/WebGL2/Canvas2D 渲染器

目标：提供高级帧处理能力，同时保证没有 WebGPU 时仍可观看。

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

## 10. Phase 7：SRT/ASS 字幕

目标：完成 MX-Player-Pro 字幕能力的可复用核心，但不复制其演示站视觉。

### 任务

1. 实现 SRT、ASS/SSA 解析器。
2. 接入内嵌字幕包和外挂字幕 URL/File。
3. 实现轨道切换、语言/名称显示和字幕关闭。
4. 实现字体、字号、位置、颜色、描边和样式持久化。
5. 让字幕覆盖层同时适配 NativeVideo、WebGPU、WebGL2 和 Canvas2D。
6. 对未实现的 ASS 动画、绘图和卡拉 OK 明确降级。

### 退出条件

- 字幕由媒体时钟驱动，seek 后立即显示正确 cue。
- SRT/ASS 输入不会执行 HTML 或脚本。
- 多条重叠 cue 按稳定顺序渲染。

## 11. Phase 8：WASM Decoder Manager

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

## 12. Phase 9：浏览器平台优化

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

## 13. Phase 10：SDK、演示站与发布

目标：让第三方可以通过 npm 或 jsDelivr 接入，并让 Docker 演示展示真实引擎能力。

### 任务

1. 完成原生 SDK API、React 适配器和 Vue 适配器。
2. 演示站加入真实 Probe、Backend Decision、Decoder、Renderer 和 Subtitle 面板。
3. GSAP 动画只服务于产品叙事，不能阻塞播放器初始化。
4. Docker 演示站启用 COOP/COEP。
5. GitHub Actions 构建、测试、打包、生成 manifest 和发布 npm。
6. 发布固定版本 jsDelivr ESM 接入示例。

### 退出条件

- npm、jsDelivr、自托管 WASM 三种接入方式均有文档。
- Demo 可以展示为什么选择某个后端。
- Demo 不依赖 MX-Player-Pro 的实现文件或视觉布局。

## 14. Phase 11：质量、安全和性能固化

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

## 15. 每阶段的 Git 工作方式

每个阶段使用独立分支和小 PR：

```text
feat/phase-1-capabilities
feat/phase-2-demux
feat/phase-3-native-pipeline
```

PR 必须只覆盖一个阶段，合并前完成类型检查、单元测试、文档和阶段验收记录。禁止为了通过阶段验收顺手修改无关 UI 或 Codec。

