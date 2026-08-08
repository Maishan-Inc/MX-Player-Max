# Phase 5 验收记录

日期：2026-08-08

## 实现状态

Phase 5 已实现 `Demux Worker → audio DemuxPacket → EncodedAudioChunk → AudioDecoder → AudioData → Float32 PCM → 有界 transport → AudioWorklet → AudioContext sample clock`。音视频共享一个 Phase 2 Demux Worker session；Phase 4 `readVideoFrame()` 的即时 pull、epoch 和调用方 VideoFrame 所有权保持不变。Phase 5 不创建 Renderer，因此 `normal`/`low-power` 仍不宣称 Custom 完整播放。

本机代码、fake API 自动化、类型检查、测试和构建验收完成。真实 Chrome/Firefox/macOS Safari、硬件 AudioDecoder/AudioWorklet、CORS Range 与 30 分钟 drift 尚无当前环境证据，全部标记 pending。

## 公共 API 与默认值

- `MXPlayerOptions.customAudio`：decode queue 16、PCM 2,000,000 微秒、低水位 500,000 微秒、启动 150,000 微秒、MessagePort pending 8、operation timeout 10,000 ms、latencyHint interactive；输出采样率可选 8,000–192,000 Hz。所有字段均校验硬上限。
- `CustomAudioStats`：decode/render/drop/underrun/overflow、queue/buffer、采样率/声道、transport/output state/EOS。
- `AudioClockSnapshot`：source/mediaTime/contextTime/renderedFrames/sampleRate/rate/running/underrun/epoch。
- `MediaEngine`/`MXPlayer`：只读 `customAudioStats`、`audioClock`。
- `audiostatechange`、`audiounderrun`、`clockupdate` 只携带统计、缓冲和时钟，不携带 AudioData/PCM/packet。
- 新增并使用稳定 `CUSTOM_AUDIO_*`、`AUDIO_*`、`WEBCODECS_AUDIO_*` 错误码；公开 message 不包含 DOMException name 或浏览器原始 message。

## AudioDecoder 与 Codec 矩阵

配置只来自 `MediaCapabilityReport.query.audio`、对应 `TrackInfo.codec`/`codecPrivate`/sampleRate/channels。capability codec 必须与 track codec 一致；不从文件名、扩展名或 MIME 推导。

| Codec | Phase 5 状态 | private data 规则 |
|---|---|---|
| AAC | 已实现 | 完整 `mp4a.40.*`，需要兼容 AudioSpecificConfig；MP4 esds/Matroska CodecPrivate 提供 ASC |
| Opus | 已实现 | 探测得到 `opus`；只接受 OpusHead 或规范转换的 MP4 dOps |
| MP3 | 已实现 | 探测得到 `mp3`；禁止伪造 description |
| AC-3/E-AC-3/DTS/TrueHD/AC-4/Vorbis/FLAC/PCM/对象音频 | 不在 Phase 5 | 稳定拒绝，不加载 WASM/FFmpeg |

`AudioDecoderRuntime` 与 encoded chunk factory 可注入。Adapter 覆盖同步异常、error/dequeue、nullable duration、flush/reset/close 和 generation；reset 后必须重新 configure，旧 generation AudioData 立即 close。

## PCM、重采样、Worklet 与背压

AudioData 通过 `copyTo(..., f32-planar)` 转换为明确声道顺序的 interleaved Float32，copy 后在 finally 立即 close。Phase 5 只支持 mono/stereo；未知多声道布局不猜测 downmix。流式线性 resampler 保存跨 block fractional phase 与边界 frame，48 kHz→44.1 kHz 长时测试样本误差不超过 1 frame；质量限制为线性插值，不面向高质量离线转换。

PCM ring 固定容量，overflow 返回 `AUDIO_BUFFER_OVERFLOW`；underrun 零填充且不重复消费。跨源隔离且 capability 确认 SAB 时使用 Atomics ring，否则使用有界 transferable MessagePort、sequence/epoch/consumed ack。输出图固定为 AudioWorkletNode → GainNode → destination，音量/静音使用平滑 GainParam，不为 block 创建节点。Worklet process 无网络、Promise、timer、console 或 unbounded queue。

## 时钟、同步与播放控制

有音频时媒体时间锚定首个可播放 PCM PTS，只由实际消费 sample frame 推进；decode/入队/AudioContext currentTime 单独增长不会推进媒体时间。pause 冻结、resume 恢复输出，underrun 维持最后采样时间并标记 buffering。无音频使用 `performance.now()` 墙钟，支持 pause/resume/seek/rate，无 polling 和 Date.now。

`VideoFrameScheduler` 按 PTS 与主时钟输出 wait/present/drop，并累计 late drop；它是 Phase 6 呈现契约，不关闭已经交付给调用方的 Frame。倍速改变 Worklet 消费率和时钟映射，不靠提高 decode 并发；Phase 5 未实现 time-stretch，音高随倍速改变，不声明 preservesPitch。

## Seek、epoch、EOS 与关闭

seek 提升统一 epoch，停止旧 pump，清空视频 queue/PCM/MessagePort，reset/reconfigure 两个 decoder，再调用同一 Demux Worker seek。视频保持 keyframe/preroll 规则；音频 target 前 block 丢弃，跨越 target 的 block 按 sample ceil 精确裁剪。旧 packet/AudioData/VideoFrame/ack/error/underrun/EOS 不影响新 epoch。

Demux EOS 并行 flush 两个启用的 decoder并接收 flush output；只有 VideoDecoder EOS、video queue 耗尽、AudioDecoder EOS 且 PCM 已实际消费完才发一次 ended。close/换源关闭 decoder、stale AudioData、AudioContext、AudioWorkletNode、GainNode、Worker、ring、Port/listener、timer 和 pending Promise；close 后事件被 epoch/closed 门禁屏蔽。已经交付的 VideoFrame 仍归调用方。

## 自动化覆盖与测试样本

测试使用 fake AudioDecoder、EncodedAudioChunk、AudioData、AudioContext、AudioWorkletNode/Processor、GainNode、Worker、MessagePort、SharedArrayBuffer transport、可控 Promise；不访问真实站点。媒体数据由测试代码构造，不含第三方样本或许可证风险。

覆盖 AAC/ASC、OpusHead/dOps、MP3、未知/缺字段/不兼容 private data、AudioData close、PCM planar→interleaved、seek crop、流式 resample 连续性、ring wrap/overflow/underrun、SAB/MessagePort、倍速跨 block、双 decoder 路由/背压、pause/resume、gain/mute、autoplay reject、sample/wall clock、scheduler、连续 epoch、双 flush、drain ended、换源和 close。

2026-08-08 最终全仓实际通过 **263** 项测试：types 13、audio 32、capabilities 16、decoder-webcodecs 57、demux 43、platform 3、postprocess 6、strategy 9、core 82、sdk 2。decoder-wasm、renderers、subtitles、React 和 Vue 当前没有测试文件，Vitest 以 `--passWithNoTests` 验证包级命令可执行；不得把它们记作测试通过数，也不得沿用 Phase 4 的 194 数量。

## 四项阶段验收

| 命令 | 2026-08-08 结果 | 记录 |
|---|---|---|
| `pnpm typecheck` | passed | 16 个参与 workspace 项目的 build 与 strict TypeScript typecheck 均退出 0 |
| `pnpm test` | passed | 263 tests passed；无失败、跳过或真实站点访问 |
| `pnpm build` | passed | 全部可构建包与 demo production build 退出 0 |
| `git diff --check` | passed | 无 whitespace error；Windows 工作树仅报告预期的 LF→CRLF 提示 |

补充静态审计：TypeScript 源码无 `any`；无 ScriptProcessor、`decodeAudioData()`、AudioBufferSourceNode、AudioEncoder/VideoEncoder、`Date.now()`、`setInterval()` 或敏感 `console.*`；跨包 import 只使用公共包入口。源码中的 `.mp3` 仅用于 MP4 sample-entry 四字符码映射，不读取文件名或扩展名。PCM ring、Worklet MessagePort 队列、decoder queue、Demux pending request 与 operation Promise 均有硬上限；AudioData、Worker、Port、AudioContext、listener 和 timeout 均有 stale/epoch/close 清理路径。

## 浏览器 smoke matrix

| 环境 | 状态 | 待验证内容 |
|---|---|---|
| Chrome/Chromium 最新两个稳定大版本 | pending | File/CORS Range、AAC/Opus/MP3 AudioDecoder、AudioWorklet、SAB/MessagePort、autoplay、seek/underrun/close、30 分钟 drift |
| Firefox 最新两个稳定大版本 | pending | 具体 audio isConfigSupported/configure、AudioWorklet、SAB/MessagePort、seek/flush/drain、30 分钟 drift |
| macOS Safari 最新两个稳定大版本 | pending | AudioDecoder API/Codec 实际矩阵、AudioWorklet、autoplay、MessagePort/SAB、seek/close、30 分钟 drift |

本机 Vitest 不替代真实浏览器、声卡时钟、硬件解码器、用户手势策略、跨源隔离响应头或 CORS/Range 服务器证据。

## 外部验证项

- 三浏览器最近两个稳定大版本真实 File/CORS Range 与 AAC/Opus/MP3 smoke。
- 真实 AudioContext device rate、SAB/MessagePort、autoplay、underrun 和 30 分钟 drift/CPU/内存/功耗代理指标。
- Phase 6 Renderer 使用 `VideoFrameScheduler` 的实际 wait/present/drop 呈现回归。
- 多声道、time-stretch、WASM/FFmpeg、HLS/DASH、直播、录制、DRM 和空间/对象音频均仍在范围外。
