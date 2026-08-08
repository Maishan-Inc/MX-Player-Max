# @mx-player-max/audio

Phase 5 音频边界：`AudioData.copyTo()` → interleaved Float32 PCM → 状态保持的线性流式重采样 → 有界 PCM ring → `AudioWorkletNode → GainNode → destination`。

所有权：decoder 输出的 `AudioData` 转移给 PCM 层，copy 完立即 `close()`；stale/preroll/非法/close 后迟到的数据也立即关闭，公共事件不广播 `AudioData` 或 PCM。Phase 5 只启用 mono/stereo；未知多声道布局拒绝，不猜测 downmix。

默认限制：decode queue 16、PCM 2,000,000 微秒、低水位 500,000 微秒、启动缓冲 150,000 微秒、MessagePort pending 8 blocks、operation timeout 10 秒；配置值有硬上限，overflow 返回 `AUDIO_BUFFER_OVERFLOW`，underrun 输出静音并记 stats。重采样保留跨 block fractional phase，长期样本误差有界；当前倍速改变消费率，不实现保音调 time-stretch，不声明 `preservesPitch`。

跨源隔离且能力快照确认 `SharedArrayBuffer` 时使用 SAB/Atomics ring；否则使用有界 transferable MessagePort，带 sequence/epoch/consumed ack。AudioWorklet `process()` 不访问网络、不等待 Promise、不打印日志。AudioContext resume 被浏览器阻止时返回 `AUDIO_AUTOPLAY_BLOCKED`。

有音频时 `AudioSampleClock` 仅按实际消费 sample frames 推进；pause 冻结，resume 建立新运行状态，seek reset anchor/counter/epoch。无音频使用可暂停、可 seek、可调速的 `MediaWallClock` (`performance.now()`)。`VideoFrameScheduler` 只输出 wait/present/drop 契约，不创建 Renderer；Phase 6 才呈现画面。
