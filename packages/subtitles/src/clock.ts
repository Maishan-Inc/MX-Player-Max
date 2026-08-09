import type { SubtitleClockSnapshot, SubtitleCue } from '@mx-player-max/types'

export interface SubtitleClock {
  snapshot(): SubtitleClockSnapshot
  subscribe(listener: () => void): () => void
  close(): void
}

export type SubtitleClockReader = () => SubtitleClockSnapshot

export class NativeSubtitleClock implements SubtitleClock {
  readonly #video: HTMLVideoElement
  readonly #listeners = new Set<() => void>()
  readonly #eventTypes = ['play', 'playing', 'pause', 'seeking', 'seeked', 'timeupdate', 'ratechange', 'ended', 'durationchange'] as const
  #epoch = 0
  #closed = false
  readonly #notify = (): void => { if (!this.#closed) for (const listener of [...this.#listeners]) listener() }

  constructor(video: HTMLVideoElement) {
    this.#video = video
    for (const type of this.#eventTypes) video.addEventListener(type, this.#notify)
  }

  snapshot(): SubtitleClockSnapshot {
    const current = Number.isFinite(this.#video.currentTime) && this.#video.currentTime >= 0 ? Math.round(this.#video.currentTime * 1_000_000) : 0
    const rate = Number.isFinite(this.#video.playbackRate) && this.#video.playbackRate > 0 ? this.#video.playbackRate : 1
    return { source: 'native-media', mediaTime: Number.isSafeInteger(current) && current >= 0 ? current : 0, playbackRate: rate, playing: !this.#video.paused && !this.#video.ended, ended: this.#video.ended, epoch: this.#epoch }
  }

  subscribe(listener: () => void): () => void { this.#listeners.add(listener); return () => this.#listeners.delete(listener) }
  setEpoch(epoch: number): void { if (Number.isSafeInteger(epoch) && epoch >= 0) { this.#epoch = epoch; this.#notify() } }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    for (const type of this.#eventTypes) this.#video.removeEventListener(type, this.#notify)
    this.#listeners.clear()
  }
}

export class CallbackSubtitleClock implements SubtitleClock {
  readonly #read: SubtitleClockReader
  readonly #listeners = new Set<() => void>()
  #closed = false

  constructor(read: SubtitleClockReader) { this.#read = read }
  snapshot(): SubtitleClockSnapshot { return this.#read() }
  subscribe(listener: () => void): () => void { this.#listeners.add(listener); return () => this.#listeners.delete(listener) }
  notify(): void { if (!this.#closed) for (const listener of [...this.#listeners]) listener() }
  close(): void { this.#closed = true; this.#listeners.clear() }
}

export interface SubtitleSchedulerOptions {
  requestAnimationFrame?: (callback: (time: number) => void) => number
  cancelAnimationFrame?: (handle: number) => void
}

export interface SubtitleCueUpdate {
  cues: readonly SubtitleCue[]
  snapshot: SubtitleClockSnapshot
}

export class SubtitleScheduler {
  readonly #clock: SubtitleClock
  readonly #onUpdate: (update: SubtitleCueUpdate) => void
  readonly #requestFrame: (callback: (time: number) => void) => number
  readonly #cancelFrame: (handle: number) => void
  readonly #unsubscribe: () => void
  #cues: SubtitleCue[] = []
  #active = new Map<string, SubtitleCue>()
  #startIndex = 0
  #lastTime: number | null = null
  #lastEpoch = -1
  #lastSignature = ''
  #running = false
  #ended = false
  #seeking = false
  #closed = false
  #frame: number | null = null

  constructor(clock: SubtitleClock, onUpdate: (update: SubtitleCueUpdate) => void, options: SubtitleSchedulerOptions = {}) {
    this.#clock = clock
    this.#onUpdate = onUpdate
    this.#requestFrame = options.requestAnimationFrame ?? defaultRequestAnimationFrame
    this.#cancelFrame = options.cancelAnimationFrame ?? defaultCancelAnimationFrame
    this.#unsubscribe = clock.subscribe(() => this.refresh())
  }

  setCues(cues: readonly SubtitleCue[], force = true): void {
    this.#cues = [...cues].sort(compareCue)
    this.#ended = false
    this.#active.clear()
    this.#startIndex = 0
    this.#lastTime = null
    this.#lastEpoch = -1
    this.#lastSignature = ''
    this.#seeking = false
    if (force) this.refresh(true)
  }

  clear(): void { this.setCues([], true) }

  play(): void { if (this.#closed) return; this.#ended = false; this.#running = true; this.refresh(); this.schedule() }
  pause(): void { this.#running = false; this.cancelFrame() }
  seek(epoch: number, refresh = true): void {
    this.#ended = false
    this.#seeking = !refresh
    this.#lastEpoch = Number.isSafeInteger(epoch) && epoch >= 0 ? epoch - 1 : -1
    this.#lastTime = null
    this.#active.clear()
    this.#startIndex = 0
    this.cancelFrame()
    if (refresh) this.refresh(true)
    else {
      const snapshot = this.#clock.snapshot()
      this.#lastEpoch = Number.isSafeInteger(epoch) && epoch >= 0 ? epoch : snapshot.epoch
      this.#lastTime = snapshot.mediaTime
      this.#lastSignature = ''
      this.#onUpdate({ cues: [], snapshot })
    }
  }

  completeSeek(epoch: number): void {
    if (this.#closed) return
    this.#seeking = false
    this.#ended = false
    this.#lastEpoch = Number.isSafeInteger(epoch) && epoch >= 0 ? epoch - 1 : -1
    this.#lastTime = null
    this.#active.clear()
    this.#startIndex = 0
    this.refresh(true)
  }
  ended(): void {
    if (this.#closed) return
    this.#ended = true
    this.#seeking = false
    this.#running = false
    this.cancelFrame()
    this.#active.clear()
    const snapshot = this.#clock.snapshot()
    this.#lastTime = snapshot.mediaTime
    this.#lastEpoch = snapshot.epoch
    this.#lastSignature = ''
    this.#onUpdate({ cues: [], snapshot })
  }
  refresh(force = false): void {
    if (this.#closed) return
    if (this.#seeking) return
    const snapshot = this.#clock.snapshot()
    if (this.#ended) {
      if (force || this.#lastSignature !== '') {
        this.#lastSignature = ''
        this.#onUpdate({ cues: [], snapshot })
      }
      this.cancelFrame()
      return
    }
    if (snapshot.epoch !== this.#lastEpoch || this.#lastTime === null || snapshot.mediaTime < this.#lastTime) this.rebuild(snapshot)
    else this.advance(snapshot)
    const cues = [...this.#active.values()].sort(compareCue)
    const signature = cues.map((cue) => cue.cueId).join('|')
    if (force || signature !== this.#lastSignature) {
      this.#lastSignature = signature
      this.#onUpdate({ cues, snapshot })
    }
    if (this.#running && snapshot.playing && !snapshot.ended) this.schedule()
    else if (!snapshot.playing || snapshot.ended) this.cancelFrame()
  }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    this.#ended = true
    this.#seeking = false
    this.#running = false
    this.cancelFrame()
    this.#unsubscribe()
    this.#active.clear()
    this.#cues = []
  }

  private rebuild(snapshot: SubtitleClockSnapshot): void {
    this.#active.clear()
    this.#startIndex = 0
    while (this.#startIndex < this.#cues.length) {
      const cue = this.#cues[this.#startIndex]
      if (cue === undefined || cue.start > snapshot.mediaTime) break
      if (cue.end > snapshot.mediaTime) this.#active.set(cue.cueId, cue)
      this.#startIndex += 1
    }
    this.#lastEpoch = snapshot.epoch
    this.#lastTime = snapshot.mediaTime
  }

  private advance(snapshot: SubtitleClockSnapshot): void {
    while (this.#startIndex < this.#cues.length) {
      const cue = this.#cues[this.#startIndex]
      if (cue === undefined || cue.start > snapshot.mediaTime) break
      if (cue.end > snapshot.mediaTime) this.#active.set(cue.cueId, cue)
      this.#startIndex += 1
    }
    for (const [id, cue] of this.#active) if (cue.end <= snapshot.mediaTime) this.#active.delete(id)
    this.#lastTime = snapshot.mediaTime
    this.#lastEpoch = snapshot.epoch
  }

  private schedule(): void {
    if (this.#closed || !this.#running || this.#frame !== null) return
    this.#frame = this.#requestFrame(() => { this.#frame = null; this.refresh() })
  }

  private cancelFrame(): void {
    if (this.#frame === null) return
    this.#cancelFrame(this.#frame)
    this.#frame = null
  }
}

function compareCue(left: SubtitleCue, right: SubtitleCue): number {
  return compareNumber(left.start, right.start) || compareNumber(left.end, right.end) || compareNumber(right.layer, left.layer) || compareString(left.cueId, right.cueId)
}

function compareNumber(left: number, right: number): number { return left < right ? -1 : left > right ? 1 : 0 }
function compareString(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0 }

function defaultRequestAnimationFrame(callback: (time: number) => void): number {
  if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(callback)
  return Number(setTimeout(() => callback(typeof performance === 'undefined' ? 0 : performance.now()), 16))
}

function defaultCancelAnimationFrame(handle: number): void {
  if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(handle)
  else clearTimeout(handle)
}
