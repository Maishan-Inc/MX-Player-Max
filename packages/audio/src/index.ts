export { AudioPipelineError, audioError } from './errors'
export { DEFAULT_CUSTOM_AUDIO_OPTIONS, resolveCustomAudioOptions } from './options'
export type { ResolvedCustomAudioOptions } from './options'
export { normalizeAudioData, PcmStreamProcessor, trimPcmBefore } from './pcm'
export type { AudioDataLike, PcmBlock } from './pcm'
export { StreamingLinearResampler } from './resampler'
export {
  PcmRingBuffer,
  SharedPcmRingBuffer,
  SHARED_AVAILABLE_FRAMES,
  SHARED_CLOSED,
  SHARED_EPOCH,
  SHARED_PAUSED,
  SHARED_READ_FRAME,
  SHARED_RENDERED_FRAMES,
  SHARED_UNDERRUNS,
  SHARED_WRITE_FRAME,
} from './ring-buffer'
export type { PcmReadResult, SharedPcmRingDescriptor } from './ring-buffer'
export { MessagePcmTransport } from './message-transport'
export type { AudioMessagePort, MessagePcmTransportCallbacks } from './message-transport'
export { AudioSampleClock, MediaWallClock } from './clock'
export type { MediaClock, MonotonicNow } from './clock'
export { VideoFrameScheduler } from './scheduler'
export type { VideoFrameSchedulerOptions } from './scheduler'
export { AudioWorkletOutput, browserAudioOutputRuntime } from './output'
export type {
  AudioContextLike,
  AudioOutputCallbacks,
  AudioOutputCapabilities,
  AudioOutputLike,
  AudioOutputRuntime,
  AudioParamLike,
  AudioWorkletNodeLike,
  AudioWorkletOutputOptions,
  GainNodeLike,
} from './output'
export type {
  AudioWorkletInputMessage,
  AudioWorkletOutputMessage,
  WorkletConsumedMessage,
  WorkletPcmMessage,
  WorkletPlaybackMessage,
  WorkletResetMessage,
  WorkletSharedInitMessage,
  WorkletStateMessage,
  WorkletUnderrunMessage,
} from './worklet-protocol'
