# Phase 1 验收记录

日期：2026-08-07

## 实现状态

公共类型、环境快照、具体媒体能力报告、缓存、确定性策略评分和 score-only 平台策略已实现。实现没有 Range Loader、媒体请求、真实解码器、WASM 二进制或 MSE 管线。

当前状态：代码与本机自动化验收通过；Chrome/Firefox/macOS Safari 最新两个稳定大版本的真实浏览器 smoke matrix 尚待浏览器 CI/设备环境执行，因此 Phase 1 的跨浏览器退出门禁尚未完全关闭。

## 本机自动化覆盖

- `@mx-player-max/types`：3 tests；`@mx-player-max/capabilities`：14 tests；`@mx-player-max/strategy`：9 tests；`@mx-player-max/platform`：3 tests。全仓 `pnpm test` 通过，已有 postprocess 测试 6 项也保持通过。
- 无 DOM/navigator 时返回结构完整的降级快照。
- 浏览器家族/主版本和操作系统规范化。
- WebGPU adapter 成功/失败降级、WebGL2、Canvas2D 和 Worker MediaSource 信号。
- WASM SIMD 与 Threads 内联探针；非跨源隔离环境不报告 Threads。
- HTMLVideo、MediaCapabilities、VideoDecoder 和 AudioDecoder 的支持、不支持、配置不完整及异常分支。
- 内存/sessionStorage 缓存契约、SDK/schema 隔离、损坏缓存、并发去重、force refresh 与调用方修改隔离。
- 普通播放、滤镜、HDR、无渲染器、无 WebCodecs、显式 WASM 声明和非隔离 WASM 策略。
- 相同输入的稳定排序、输入不变，以及平台策略不能创建候选。

## 零副作用检查

能力包只使用本地特性 API。代码路径中没有媒体 `src` 赋值、`fetch`、远程 URL、decoder 构造、GPU device 请求或 WASM 资源加载。`VideoDecoder.isConfigSupported` 与 `AudioDecoder.isConfigSupported` 只调用静态配置检查。

## 浏览器 smoke matrix

| 环境 | 状态 | 要验证的结果 |
|---|---|---|
| Chrome/Chromium 最新两个稳定大版本 | 待执行 | 快照 schema 一致，MP4/H.264/AAC 具体配置报告，隔离/非隔离差异 |
| Firefox 最新两个稳定大版本 | 待执行 | 快照 schema 一致，WebCodecs 具体配置结果，WebGPU/WebGL2 降级 |
| macOS Safari 最新两个稳定大版本 | 待执行 | 快照 schema 一致，原生/MediaCapabilities 结果，WebCodecs/WebGPU 可用性 |

浏览器结果只能记录实际 API 返回值，不以预期支持矩阵替代运行结果。

## 延后范围

- Phase 2：文件/远程 Range 读取、容器识别和轨道元数据生产。
- Phase 3/4：HTMLVideo 与 WebCodecs 真实播放/解码管线。
- Phase 10：WASM decoder registry、二进制、变体加载和许可证审查。
- Phase 11：更细的平台优化和带版本范围的 quirk/blacklist。
