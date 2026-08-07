import type { Micros, NativePlaybackStats } from '@mx-player-max/types'
import type { VideoElementAdapter } from './video-element-adapter'

export class NativeStatsTracker {
  private callbackHandle: number | null = null
  private active = false
  private current: NativePlaybackStats = {
    presentedFrames: 0,
    droppedFrames: null,
    mediaTime: null,
    lastCallbackTime: null,
  }

  constructor(private readonly video: VideoElementAdapter) {}

  get stats(): NativePlaybackStats {
    return { ...this.current }
  }

  start(isActive: () => boolean): void {
    this.stop()
    this.active = true
    const schedule = (): void => {
      if (!this.active || !isActive()) return
      const handle = this.video.requestVideoFrameCallback((timestamp, metadata) => {
        this.callbackHandle = null
        if (!this.active || !isActive()) return
        const presented = Number(metadata.presentedFrames)
        if (Number.isFinite(presented) && presented >= 0) this.current.presentedFrames = Math.floor(presented)
        const mediaTime = Number(metadata.mediaTime)
        this.current.mediaTime = toMicros(mediaTime)
        this.current.lastCallbackTime = toMicros(timestamp / 1000)
        const quality = this.video.getPlaybackQuality()
        if (quality) {
          this.current.presentedFrames = Math.max(this.current.presentedFrames, Math.floor(quality.presentedFrames))
          this.current.droppedFrames = Number.isFinite(quality.droppedFrames) && quality.droppedFrames >= 0 ? Math.floor(quality.droppedFrames) : null
        }
        schedule()
      })
      this.callbackHandle = handle
    }
    schedule()
  }

  stop(): void {
    this.active = false
    if (this.callbackHandle !== null) {
      this.video.cancelVideoFrameCallback(this.callbackHandle)
      this.callbackHandle = null
    }
  }
}

function toMicros(seconds: number): Micros | null {
  if (!Number.isFinite(seconds) || seconds < 0) return null
  const micros = Math.round(seconds * 1_000_000)
  return Number.isSafeInteger(micros) && micros >= 0 ? micros : null
}

