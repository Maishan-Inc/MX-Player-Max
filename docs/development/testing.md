# 测试与验收方案

## 单元测试

覆盖 Range 合并与取消、容器元素解析、Codec 配置转换、能力评分、epoch 丢弃、帧队列、音频 ring buffer、媒体时钟、SRT/ASS 解析、字幕样式边界和错误码。

## 浏览器测试

桌面 Chrome/Chromium、Firefox、macOS Safari 的最新两个稳定大版本都要执行：

- 原生 MP4/WebM 播放。
- MKV 自定义解封装。
- H.264/AAC、VP8/VP9/Opus、AV1 样本。
- WebGPU、WebGL2、Canvas2D 降级。
- 跨源隔离与非隔离 WASM。
- 本地文件、CORS/Range 远程文件和网络失败。
- SRT/ASS 内嵌/外挂、轨道切换和 seek 同步。

## 性能指标

记录首帧、首音、首个字幕、Seek 延迟、缓冲前向、Dropped Frames、音画漂移、解码吞吐、Worker 峰值内存、WASM 下载量和长时间播放稳定性。测试必须区分硬件解码、软件解码、单线程和多线程。

## 媒体样本

样本目录按 `container/codec/profile/bit-depth/audio/subtitle` 命名，所有样本保存来源和许可。禁止把未知版权视频直接提交仓库。

