import type { AudioClockSnapshot, CustomAudioStats, EngineError, Micros } from '@mx-player-max/types'

export type CustomPipelineEvent =
  | { type: 'ready' }
  | { type: 'playing' }
  | { type: 'paused' }
  | { type: 'seeking' }
  | { type: 'seeked'; resume: 'ready' | 'playing' }
  | { type: 'frameavailable'; queuedFrames: number; bufferedDuration: Micros }
  | { type: 'audiostatechange'; stats: CustomAudioStats }
  | { type: 'audiounderrun'; stats: CustomAudioStats }
  | { type: 'clockupdate'; clock: AudioClockSnapshot }
  | { type: 'buffering'; bufferedAhead: Micros }
  | { type: 'ended' }
  | { type: 'error'; error: EngineError }
