import type { EngineError, Micros } from '@mx-player-max/types'

export type CustomPipelineEvent =
  | { type: 'ready' }
  | { type: 'playing' }
  | { type: 'paused' }
  | { type: 'seeking' }
  | { type: 'seeked'; resume: 'ready' | 'playing' }
  | { type: 'frameavailable'; queuedFrames: number; bufferedDuration: Micros }
  | { type: 'ended' }
  | { type: 'error'; error: EngineError }
