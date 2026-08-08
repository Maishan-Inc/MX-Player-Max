import type { AudioClockSnapshot, Micros } from '@mx-player-max/types'
import { ErrorCodes } from '@mx-player-max/types'
import { audioError } from './errors'

export interface MediaClock {
  readonly snapshot: AudioClockSnapshot
  play(): void
  pause(): void
  seek(time: Micros, epoch: number): void
  setPlaybackRate(rate: number): void
  close(): void
}

export interface MonotonicNow { now(): number }

export class AudioSampleClock implements MediaClock {
  readonly #contextTime: () => number
  #sampleRate: number
  #anchorTime = 0
  #renderedFrames = 0
  #playbackRate = 1
  #running = false
  #underrun = false
  #epoch = 0
  #closed = false

  constructor(sampleRate: number, contextTime: () => number) {
    if (!positive(sampleRate)) throw audioError(ErrorCodes.AUDIO_OPERATION_FAILED, 'Audio clock sample rate is invalid', false)
    this.#sampleRate = sampleRate
    this.#contextTime = contextTime
  }

  get snapshot(): AudioClockSnapshot {
    const contextSeconds = this.#safeContextTime()
    return {
      source: 'audio-context', mediaTime: this.#mediaTime(), contextTime: contextSeconds === null ? null : Math.round(contextSeconds * 1_000_000),
      renderedFrames: this.#renderedFrames, sampleRate: this.#sampleRate, playbackRate: this.#playbackRate,
      running: this.#running, underrun: this.#underrun, epoch: this.#epoch,
    }
  }

  setAnchor(time: Micros, sampleRate = this.#sampleRate): void {
    validateMicros(time)
    if (!positive(sampleRate)) throw audioError(ErrorCodes.AUDIO_OPERATION_FAILED, 'Audio clock sample rate is invalid', false)
    this.#anchorTime = time
    this.#sampleRate = sampleRate
    this.#renderedFrames = 0
    this.#underrun = false
  }

  updateRenderedFrames(total: number): void {
    if (!Number.isSafeInteger(total) || total < this.#renderedFrames) throw audioError(ErrorCodes.AUDIO_OPERATION_FAILED, 'Rendered audio sample count is invalid', false)
    const advanced = total > this.#renderedFrames
    this.#renderedFrames = total
    if (advanced) this.#underrun = false
  }

  noteUnderrun(value: boolean): void { this.#underrun = value }
  play(): void { this.#ensureOpen(); this.#running = true }
  pause(): void { this.#ensureOpen(); this.#running = false }
  seek(time: Micros, epoch: number): void { this.#ensureOpen(); validateEpoch(epoch); this.#anchorTime = time; this.#renderedFrames = 0; this.#epoch = epoch; this.#underrun = false }
  setPlaybackRate(rate: number): void { this.#ensureOpen(); validateRate(rate); this.#playbackRate = rate }
  close(): void { this.#running = false; this.#closed = true }

  #mediaTime(): Micros {
    const value = this.#anchorTime + Math.round(this.#renderedFrames * 1_000_000 / this.#sampleRate)
    return Number.isSafeInteger(value) && value >= 0 ? value : Number.MAX_SAFE_INTEGER
  }

  #safeContextTime(): number | null {
    try { const value = this.#contextTime(); return Number.isFinite(value) && value >= 0 ? value : null } catch { return null }
  }
  #ensureOpen(): void { if (this.#closed) throw audioError(ErrorCodes.AUDIO_OPERATION_FAILED, 'Audio clock is closed', false) }
}

export class MediaWallClock implements MediaClock {
  readonly #time: MonotonicNow
  #mediaAnchor: Micros = 0
  #timeAnchorMs = 0
  #playbackRate = 1
  #running = false
  #epoch = 0
  #closed = false

  constructor(time: MonotonicNow = { now: () => performance.now() }) { this.#time = time; this.#timeAnchorMs = this.#now() }

  get snapshot(): AudioClockSnapshot {
    return { source: 'wall-clock', mediaTime: this.#current(), contextTime: null, renderedFrames: 0, sampleRate: null, playbackRate: this.#playbackRate, running: this.#running, underrun: false, epoch: this.#epoch }
  }

  play(): void { this.#ensureOpen(); if (this.#running) return; this.#timeAnchorMs = this.#now(); this.#running = true }
  pause(): void { this.#ensureOpen(); if (!this.#running) return; this.#mediaAnchor = this.#current(); this.#running = false }
  seek(time: Micros, epoch: number): void { this.#ensureOpen(); validateMicros(time); validateEpoch(epoch); this.#mediaAnchor = time; this.#timeAnchorMs = this.#now(); this.#epoch = epoch }
  setPlaybackRate(rate: number): void { this.#ensureOpen(); validateRate(rate); this.#mediaAnchor = this.#current(); this.#timeAnchorMs = this.#now(); this.#playbackRate = rate }
  close(): void { this.#running = false; this.#closed = true }

  #current(): Micros {
    if (!this.#running) return this.#mediaAnchor
    const elapsed = Math.max(0, this.#now() - this.#timeAnchorMs)
    const value = this.#mediaAnchor + Math.round(elapsed * 1_000 * this.#playbackRate)
    return Number.isSafeInteger(value) ? value : Number.MAX_SAFE_INTEGER
  }
  #now(): number { const value = this.#time.now(); if (!Number.isFinite(value) || value < 0) throw audioError(ErrorCodes.AUDIO_OPERATION_FAILED, 'Monotonic clock returned an invalid value', false); return value }
  #ensureOpen(): void { if (this.#closed) throw audioError(ErrorCodes.AUDIO_OPERATION_FAILED, 'Wall clock is closed', false) }
}

function positive(value: number): boolean { return Number.isSafeInteger(value) && value > 0 }
function validateMicros(value: number): void { if (!Number.isSafeInteger(value) || value < 0) throw audioError(ErrorCodes.AUDIO_OPERATION_FAILED, 'Media time is invalid', false) }
function validateEpoch(value: number): void { if (!Number.isSafeInteger(value) || value < 0) throw audioError(ErrorCodes.AUDIO_OPERATION_FAILED, 'Clock epoch is invalid', false) }
function validateRate(value: number): void { if (!Number.isFinite(value) || value <= 0 || value > 16) throw audioError(ErrorCodes.AUDIO_OPERATION_FAILED, 'Playback rate is invalid', false) }
