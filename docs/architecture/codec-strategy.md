# Codec、容器与解码器策略

## 1. 容器与 Codec 分离

容器决定如何读取和解封装，Codec 决定如何解码。MKV、MP4、WebM 不能直接当作 Codec 名称传入解码器。Demuxer 必须输出带 Codec 配置、时间戳、关键帧和私有数据的轨道描述。

首阶段容器优先级：MP4、WebM、Matroska/MKV。AVI、MPEG-TS、FLV、MOV 特殊变体作为后续插件。

## 2. 视频 Codec 优先级

| Codec | 优先级 | 说明 |
|---|---|---|
| H.264/AVC | HTMLVideo → WebCodecs → OpenH264 WASM → FFmpeg | 需要正确处理 avcC/Annex-B 和 profile/level。|
| H.265/HEVC | HTMLVideo → WebCodecs → libde265 WASM → FFmpeg | Safari 原生路径可能最优，但必须实测。|
| H.266/VVC | HTMLVideo（未来）→ WebCodecs（未来）→ VVdeC WASM → FFmpeg | 首期以插件接口和样本验证为主。|
| AV1 | HTMLVideo → WebCodecs → dav1d WASM → FFmpeg | 需要处理 sequence header、10-bit 和 HDR 元数据。|
| VP9 | HTMLVideo → WebCodecs → libvpx WASM → FFmpeg | WebM/MKV 常见。|
| VP8 | HTMLVideo → WebCodecs → libvpx WASM → FFmpeg | 低风险基础 Codec。|
| MPEG-2 | HTMLVideo → WebCodecs → FFmpeg | 常见于 MPEG-TS/DVD 来源。|
| WMV/VC-1/RealVideo/Indeo | FFmpeg | 作为冷门兼容层，不进入主路径。|

实际优先级由 `MediaCapabilities`、`VideoDecoder.isConfigSupported`、播放意图和平台策略共同评分。

## 3. 解码器插件契约

每个解码器插件必须声明：

- Codec ID 与配置格式。
- 支持的容器私有数据。
- 输入压缩包格式。
- 输出色彩空间、像素格式和时间戳单位。
- 单线程、SIMD、多线程变体。
- 内存上限和初始化成本。
- 许可证、专利和发布限制。

FFmpeg 不作为默认主力解码器。它是兼容层，只有没有更小、更明确或更可靠的专用解码器时才加载。

## 4. WASM 构建矩阵

```text
codec/
  single/decoder.wasm
  simd/decoder.wasm
  threaded/decoder.wasm
  manifest.json
```

对外只有一个 SDK 版本。运行时先选择 Codec 插件，再选择 `threaded`、`simd` 或 `single`。不支持多线程时只下载单线程文件。

## 5. 许可证与供应链

每个二进制必须有 `NOTICE`、上游 commit、编译参数和许可证清单。FFmpeg 配置必须明确 LGPL/GPL 组件，OpenH264、VVdeC、libde265 等必须单独评估发行义务和专利风险。未经审查不得发布到公共 CDN。

