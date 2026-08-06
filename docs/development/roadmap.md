# 分阶段开发流程

## 阶段 0：规范与脚手架

交付 Monorepo、包边界、公共类型、CI 基础、Docker 演示站、文档和许可证清单模板。验收：所有包能被发现，根目录类型检查和空测试命令可执行。

## 阶段 1：公共类型与能力探测

实现 `SourceDescriptor`、`TrackInfo`、`MediaDescriptor`、`CapabilitySnapshot`、`BackendCandidate`、错误码和事件契约。实现浏览器/设备/渲染器/WASM 探测与缓存。验收：三浏览器返回结构一致的快照。

## 阶段 2：Range Loader 与容器抽象

实现本地文件读取、远程 CORS/Range、取消、重试、缓存和最小探测。实现 Container Adapter 接口，先接入 Matroska，随后 MP4/WebM。验收：能读取轨道、Codec 配置、duration、关键帧和字幕包。

## 阶段 3：NativeMediaPipeline

实现普通播放、原生进度、seek、音量、倍速、全屏、HDR 保留、错误转换和基础字幕覆盖。验收：常见 MP4/WebM 在 Chrome、Firefox、Safari 正常播放。

## 阶段 4：WebCodecs CustomMediaPipeline

实现视频/音频 Decoder Adapter、Packet Buffer、Frame Queue、AudioWorklet、Media Clock 和 seek epoch。优先接入 H.264/AAC/VP8/VP9/AV1/Opus。验收：自定义管线首帧、音画同步和轨道切换稳定。

## 阶段 5：WebGPU/WebGL2/Canvas2D 渲染器

实现视频色彩、旋转、裁剪、滤镜接口、HDR 能力标记和渲染器降级。验收：WebGPU 不可用时仍可播放，滤镜功能明确降级。

## 阶段 6：WASM Decoder Manager

建立 Codec 插件注册、单线程/SIMD/多线程选择、WASM 哈希校验、懒加载、缓存和失败回退。先接入 libvpx、dav1d、libde265、OpenH264，再接入 VVdeC 和 FFmpeg 兜底。

## 阶段 7：字幕与播放器 UI

接入 SRT/ASS 内嵌和外挂字幕、轨道菜单、字体和样式编辑器。演示站使用全新信息架构和 GSAP 动画，不复制 MX-Player-Pro 的布局。

## 阶段 8：平台策略和发布

实现 Chromium/WebKit/Gecko 可插拔优化、Issue 黑名单、npm 发布、jsDelivr 入口、Docker 多线程演示和版本化 WASM manifest。

## 阶段 9：质量与扩展

建立媒体样本矩阵、三浏览器自动化、性能回归、内存压力、网络异常、许可证审查和安全审计。之后再进入 HLS/DASH、PGS/VobSub、移动端和 DRM 子项目。

