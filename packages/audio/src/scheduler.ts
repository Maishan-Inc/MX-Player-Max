import type { AudioClockSnapshot, Micros, VideoFrameScheduleDecision } from '@mx-player-max/types'
import { ErrorCodes } from '@mx-player-max/types'
import { audioError } from './errors'

export interface VideoFrameSchedulerOptions { earlyThreshold?: Micros; lateDropThreshold?: Micros }

export class VideoFrameScheduler {
  readonly #early: Micros
  readonly #late: Micros
  #lateDrops = 0
  #lastDrift: Micros = 0

  constructor(options: VideoFrameSchedulerOptions = {}) {
    this.#early = validThreshold(options.earlyThreshold ?? 5_000, 'earlyThreshold')
    this.#late = validThreshold(options.lateDropThreshold ?? 50_000, 'lateDropThreshold')
  }

  get lateDrops(): number { return this.#lateDrops }
  get lastDrift(): Micros { return this.#lastDrift }

  decide(frameTimestamp: Micros, clock: AudioClockSnapshot): VideoFrameScheduleDecision {
    if (!Number.isSafeInteger(frameTimestamp) || frameTimestamp < 0) throw audioError(ErrorCodes.AUDIO_OPERATION_FAILED, 'Video frame timestamp is invalid', false)
    const drift = frameTimestamp - clock.mediaTime
    if (!Number.isSafeInteger(drift)) throw audioError(ErrorCodes.AUDIO_OPERATION_FAILED, 'Video clock drift overflowed', false)
    this.#lastDrift = drift
    if (drift > this.#early) return { action: 'wait', drift, wait: drift }
    if (drift < -this.#late) { this.#lateDrops += 1; return { action: 'drop', drift, wait: 0 } }
    return { action: 'present', drift, wait: 0 }
  }
}

function validThreshold(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 5_000_000) throw audioError(ErrorCodes.AUDIO_INVALID_QUEUE_CONFIG, `The scheduler ${name} is invalid`, false)
  return value
}
