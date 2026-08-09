import type { NativeCrossOrigin, NativeMediaFeatures, NativePreload } from '@mx-player-max/types'

export interface VideoElementAdapter {
  readonly element: HTMLVideoElement
  readonly currentTime: number
  readonly duration: number
  readonly paused: boolean
  readonly ended: boolean
  readonly readyState: number
  readonly buffered: TimeRanges
  readonly played: TimeRanges
  playbackRate: number
  volume: number
  muted: boolean
  seeking: boolean
  setCrossOrigin(value: NativeCrossOrigin): void
  setPreload(value: NativePreload): void
  setPlaysInline(value: boolean): void
  setContentType(value: string): void
  setSource(value: string): void
  clearSource(): void
  load(): void
  play(): Promise<void>
  pause(): void
  setCurrentTime(value: number): void
  fastSeek(value: number): void
  addEventListener(type: string, listener: (event?: unknown) => void): void
  removeEventListener(type: string, listener: (event?: unknown) => void): void
  requestVideoFrameCallback(callback: (timestamp: number, metadata: VideoFrameCallbackMetadata) => void): number | null
  cancelVideoFrameCallback(handle: number): void
  getPlaybackQuality(): { presentedFrames: number; droppedFrames: number } | null
  requestFullscreen(): Promise<void>
  exitFullscreen(): Promise<void>
  requestPictureInPicture(): Promise<void>
  exitPictureInPicture(): Promise<void>
  getFeatures(): NativeMediaFeatures
}

export function createVideoElementAdapter(element: HTMLVideoElement): VideoElementAdapter {
  const raw = element as HTMLVideoElement & {
    requestVideoFrameCallback?: HTMLVideoElement['requestVideoFrameCallback']
    cancelVideoFrameCallback?: HTMLVideoElement['cancelVideoFrameCallback']
    requestPictureInPicture?: () => Promise<unknown>
  }
  return {
    element,
    get currentTime() { return element.currentTime },
    get duration() { return element.duration },
    get paused() { return element.paused },
    get ended() { return element.ended },
    get readyState() { return element.readyState },
    get buffered() { return element.buffered },
    get played() { return element.played },
    get playbackRate() { return element.playbackRate },
    set playbackRate(value) { element.playbackRate = value },
    get volume() { return element.volume },
    set volume(value) { element.volume = value },
    get muted() { return element.muted },
    set muted(value) { element.muted = value },
    get seeking() { return element.seeking },
    setCrossOrigin(value) { element.crossOrigin = value },
    setPreload(value) { element.preload = value },
    setPlaysInline(value) { element.playsInline = value },
    setContentType(value) { element.setAttribute('type', value) },
    setSource(value) { element.src = value },
    clearSource() {
      element.removeAttribute('src')
      element.removeAttribute('type')
    },
    load() { element.load() },
    play() { return element.play() },
    pause() { element.pause() },
    setCurrentTime(value) { element.currentTime = value },
    fastSeek(value) { element.fastSeek(value) },
    addEventListener(type, listener) { element.addEventListener(type, listener as EventListener) },
    removeEventListener(type, listener) { element.removeEventListener(type, listener as EventListener) },
    requestVideoFrameCallback(callback) {
      if (typeof raw.requestVideoFrameCallback !== 'function') return null
      return raw.requestVideoFrameCallback.call(raw, callback)
    },
    cancelVideoFrameCallback(handle) {
      if (typeof raw.cancelVideoFrameCallback === 'function') raw.cancelVideoFrameCallback.call(raw, handle)
    },
    getPlaybackQuality() {
      try {
        const quality = typeof element.getVideoPlaybackQuality === 'function' ? element.getVideoPlaybackQuality() : null
        if (quality) return { presentedFrames: Math.max(0, quality.totalVideoFrames - quality.droppedVideoFrames), droppedFrames: quality.droppedVideoFrames }
        const legacy = element as HTMLVideoElement & { mozPresentedFrames?: number; mozDroppedFrames?: number }
        if (Number.isFinite(legacy.mozPresentedFrames) || Number.isFinite(legacy.mozDroppedFrames)) {
          return { presentedFrames: legacy.mozPresentedFrames ?? 0, droppedFrames: legacy.mozDroppedFrames ?? 0 }
        }
      } catch {
        return null
      }
      return null
    },
    requestFullscreen() {
      if (typeof element.requestFullscreen !== 'function') return Promise.reject(new Error('unsupported'))
      return Promise.resolve(element.requestFullscreen())
    },
    exitFullscreen() {
      const doc = element.ownerDocument ?? (typeof document === 'undefined' ? null : document)
      if (!doc || typeof doc.exitFullscreen !== 'function') return Promise.reject(new Error('unsupported'))
      return Promise.resolve(doc.exitFullscreen())
    },
    requestPictureInPicture() {
      if (typeof raw.requestPictureInPicture !== 'function') return Promise.reject(new Error('unsupported'))
      return Promise.resolve(raw.requestPictureInPicture()).then(() => undefined)
    },
    exitPictureInPicture() {
      const doc = element.ownerDocument ?? (typeof document === 'undefined' ? null : document)
      const exit = doc && (doc as Document & { exitPictureInPicture?: () => Promise<unknown> }).exitPictureInPicture
      if (typeof exit !== 'function') return Promise.reject(new Error('unsupported'))
      return Promise.resolve(exit.call(doc)).then(() => undefined)
    },
    getFeatures() {
      const doc = element.ownerDocument ?? (typeof document === 'undefined' ? null : document)
      const pipDocument = doc as (Document & { pictureInPictureEnabled?: boolean }) | null
      return {
        fullscreen: Boolean(doc && doc.fullscreenEnabled && typeof element.requestFullscreen === 'function'),
        pictureInPicture: Boolean(pipDocument?.pictureInPictureEnabled && typeof raw.requestPictureInPicture === 'function' && typeof (pipDocument as Document & { exitPictureInPicture?: unknown }).exitPictureInPicture === 'function'),
        requestVideoFrameCallback: typeof raw.requestVideoFrameCallback === 'function',
        fastSeek: typeof element.fastSeek === 'function',
      }
    },
  }
}
