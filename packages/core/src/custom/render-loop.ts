import { VideoFrameScheduler } from '@mx-player-max/audio'
import type { AudioClockSnapshot, DecodedVideoFrame, EngineError } from '@mx-player-max/types'
import type { ManagedVideoRenderer } from '@mx-player-max/renderers'

export interface CustomRenderLoopDependencies {
  readVideoFrame(): Promise<DecodedVideoFrame | null>
  getClock(): AudioClockSnapshot
  renderer: ManagedVideoRenderer
  onError(error: EngineError): void
  isActive(): boolean
  requestAnimationFrame?(callback: (time: number) => void): number
  cancelAnimationFrame?(id: number): void
  scheduler?: VideoFrameScheduler
}

/**
 * Bounded presentation loop. It never has more than one read promise and one
 * retained frame. A retained frame belongs to this loop until presented,
 * dropped, made stale by a generation change, or closed.
 */
export class CustomRenderLoop {
  readonly #dependencies: CustomRenderLoopDependencies
  readonly #scheduler: VideoFrameScheduler
  #running = false
  #closed = false
  #generation = 0
  #raf: number | null = null
  #read: Promise<DecodedVideoFrame | null> | null = null
  #readGeneration = -1
  #frame: DecodedVideoFrame | null = null

  constructor(dependencies: CustomRenderLoopDependencies) {
    this.#dependencies = dependencies
    this.#scheduler = dependencies.scheduler ?? new VideoFrameScheduler()
  }

  get running(): boolean { return this.#running }
  get inFlightRead(): boolean { return this.#read !== null }
  get retainedFrame(): DecodedVideoFrame | null { return this.#frame }
  get scheduler(): VideoFrameScheduler { return this.#scheduler }

  start(): void {
    if (this.#closed || this.#running) return
    this.#running = true
    this.schedule()
  }

  pause(): void {
    if (this.#closed) return
    this.#running = false
    this.#generation += 1
    this.cancelFrame()
  }

  stop(discardRetainedFrame = true): void {
    if (this.#closed) return
    this.#running = false
    this.#generation += 1
    this.cancelFrame()
    if (discardRetainedFrame) this.discardRetained()
  }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    this.#running = false
    this.#generation += 1
    this.cancelFrame()
    this.discardRetained()
  }

  private schedule(): void {
    if (this.#closed || !this.#running || this.#raf !== null) return
    const callback = this.#dependencies.requestAnimationFrame ?? defaultRequestAnimationFrame
    this.#raf = callback((time) => {
      this.#raf = null
      void this.tick(time)
    })
  }

  private async tick(_time: number): Promise<void> {
    if (this.#closed || !this.#running || !this.#dependencies.isActive()) return
    const generation = this.#generation
    try {
      if (this.#frame === null) {
        if (this.#read === null) {
          this.#read = this.#dependencies.readVideoFrame()
          this.#readGeneration = generation
        } else if (this.#readGeneration !== generation) {
          return
        }
        const value = await this.#read
        this.#read = null
        this.#readGeneration = -1
        if (this.#closed || generation !== this.#generation || !this.#running || !this.#dependencies.isActive()) {
          if (value) safeClose(value.frame)
          return
        }
        if (value === null) {
          this.#running = false
          return
        }
        this.#frame = value
      }
      const frame = this.#frame
      if (frame === null) return
      if (frame.epoch !== this.#dependencies.getClock().epoch) {
        this.#frame = null
        safeClose(frame.frame)
        this.#dependencies.renderer.noteSchedule('drop')
        this.schedule()
        return
      }
      const decision = this.#scheduler.decide(frame.timestamp, this.#dependencies.getClock())
      if (decision.action === 'wait') {
        this.#dependencies.renderer.noteSchedule('wait')
      } else {
        this.#frame = null
        if (decision.action === 'drop') {
          safeClose(frame.frame)
          this.#dependencies.renderer.noteSchedule('drop')
        } else {
          try { this.#dependencies.renderer.render(frame.frame) } catch (cause) { this.#dependencies.onError(toError(cause)) }
        }
      }
    } catch (cause) {
      this.#read = null
      this.#readGeneration = -1
      if (generation === this.#generation && !this.#closed) this.#dependencies.onError(toError(cause))
    } finally {
      if (this.#read !== null && this.#readGeneration !== this.#generation) return
      this.schedule()
    }
  }

  private cancelFrame(): void {
    if (this.#raf === null) return
    const cancel = this.#dependencies.cancelAnimationFrame ?? defaultCancelAnimationFrame
    cancel(this.#raf)
    this.#raf = null
  }

  private discardRetained(): void {
    if (this.#frame === null) return
    safeClose(this.#frame.frame)
    this.#frame = null
  }
}

function defaultRequestAnimationFrame(callback: (time: number) => void): number {
  if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(callback)
  return Number(setTimeout(() => callback(typeof performance === 'undefined' ? 0 : performance.now()), 16))
}

function defaultCancelAnimationFrame(id: number): void {
  if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id)
  else clearTimeout(id)
}

function safeClose(frame: VideoFrame): void { try { frame.close() } catch { /* best effort */ } }

function toError(cause: unknown): EngineError {
  if (typeof cause === 'object' && cause !== null && 'code' in cause && 'message' in cause && 'recoverable' in cause) return cause as EngineError
  return { code: 'RENDERER_OPERATION_FAILED', message: 'The render loop operation failed', recoverable: true, cause }
}
