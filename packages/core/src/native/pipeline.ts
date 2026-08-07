import type {
  EngineError,
  NativeMediaFeatures,
  NativeMediaOptions,
  NativePlaybackStats,
  SourceDescriptor,
} from '@mx-player-max/types'
import { ErrorCodes } from '@mx-player-max/types'
import { createEngineError, isEngineError, mapNativeDomError, type EngineErrorException } from './errors'
import { NATIVE_VIDEO_EVENTS, type NativeVideoEventName } from './media-events'
import { NativeStatsTracker } from './stats'
import { createVideoElementAdapter, type VideoElementAdapter } from './video-element-adapter'

export type NativePipelineEvent =
  | { type: 'ready'; duration: number | null }
  | { type: 'playing' }
  | { type: 'paused' }
  | { type: 'seeking' }
  | { type: 'seeked' }
  | { type: 'buffering'; bufferedAhead: number }
  | { type: 'timeupdate'; currentTime: number; duration: number | null }
  | { type: 'ended' }
  | { type: 'error'; error: EngineError }
  | { type: 'loading' }

export interface NativePipelineCallbacks {
  onEvent(event: NativePipelineEvent): void
  isActive(): boolean
}

export class NativeMediaPipeline {
  readonly video: VideoElementAdapter
  private readonly statsTracker: NativeStatsTracker
  private readonly callbacks: NativePipelineCallbacks
  private readonly listeners = new Map<NativeVideoEventName, (event?: unknown) => void>()
  private metadataTimer: ReturnType<typeof setTimeout> | null = null
  private seekTimer: ReturnType<typeof setTimeout> | null = null
  private metadataReject: ((reason: unknown) => void) | null = null
  private closed = false
  private objectUrl: string | null = null
  private frameEpoch = 0

  constructor(element: HTMLVideoElement, callbacks: NativePipelineCallbacks) {
    this.video = createVideoElementAdapter(element)
    this.statsTracker = new NativeStatsTracker(this.video)
    this.callbacks = callbacks
  }

  get element(): HTMLVideoElement { return this.video.element }
  get features(): NativeMediaFeatures { return this.video.getFeatures() }
  get stats(): NativePlaybackStats { return this.statsTracker.stats }

  async load(source: SourceDescriptor, contentType: string, options: NativeMediaOptions = {}): Promise<void> {
    this.ensureOpen()
    validateNativeSource(source)
    const frameEpoch = ++this.frameEpoch
    this.statsTracker.stop()
    this.detachListeners()
    this.clearTimers()
    this.releaseObjectUrl()
    this.attachListeners()

    const preload = options.preload ?? 'metadata'
    const playsInline = options.playsInline ?? true
    const metadataTimeoutMs = options.metadataTimeoutMs ?? 15_000
    if (!Number.isFinite(metadataTimeoutMs) || metadataTimeoutMs <= 0) {
      throw createEngineError(ErrorCodes.NATIVE_OPERATION_FAILED, 'The native metadata timeout is invalid', false)
    }

    this.video.setPreload(preload)
    this.video.setPlaysInline(playsInline)
    if (source.kind === 'url') this.video.setCrossOrigin(options.crossOrigin ?? 'anonymous')
    else if (options.crossOrigin !== undefined) this.video.setCrossOrigin(options.crossOrigin)
    this.video.setContentType(contentType)

    let src: string
    if (source.kind === 'file') {
      if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
        throw createEngineError(ErrorCodes.NATIVE_SOURCE_INVALID, 'Object URLs are unavailable for local media', false)
      }
      try {
        src = URL.createObjectURL(source.file)
      } catch (cause) {
        throw createEngineError(ErrorCodes.NATIVE_SOURCE_INVALID, 'The local media source is invalid', false, cause)
      }
      this.objectUrl = src
    } else {
      src = source.url
    }

    const metadataReady = new Promise<void>((resolve, reject) => {
      this.metadataReject = reject
      this.metadataTimer = setTimeout(() => {
        this.metadataTimer = null
        this.metadataReject = null
        reject(createEngineError(ErrorCodes.NATIVE_METADATA_TIMEOUT, 'Media metadata did not arrive before the timeout', true))
      }, metadataTimeoutMs)
      this.metadataResolve = resolve
    })

    try {
      this.video.setSource(src)
      this.video.load()
      await metadataReady
      if (!this.callbacks.isActive()) throw createEngineError(ErrorCodes.NATIVE_ABORTED, 'The media load was superseded', true)
      this.statsTracker.start(() => this.frameEpoch === frameEpoch && this.callbacks.isActive())
    } catch (cause) {
      if (this.objectUrl !== null && !this.callbacks.isActive()) this.releaseObjectUrl()
      if (isEngineErrorValue(cause)) throw cause
      throw createEngineError(ErrorCodes.NATIVE_OPERATION_FAILED, 'The native media source could not be loaded', true, cause)
    } finally {
      this.metadataResolve = null
      this.metadataReject = null
      if (this.metadataTimer !== null) {
        clearTimeout(this.metadataTimer)
        this.metadataTimer = null
      }
    }
  }

  private metadataResolve: (() => void) | null = null

  async play(): Promise<void> {
    this.ensureOpen()
    try {
      await this.video.play()
    } catch (cause) {
      throw mapNativeDomError(cause, ErrorCodes.NATIVE_AUTOPLAY_BLOCKED, 'Playback was blocked by the browser')
    }
  }

  pause(): void {
    this.ensureOpen()
    try {
      this.video.pause()
    } catch (cause) {
      throw createEngineError(ErrorCodes.NATIVE_OPERATION_FAILED, 'The media could not be paused', true, cause)
    }
  }

  async seek(timeSeconds: number): Promise<void> {
    this.ensureOpen()
    if (!Number.isFinite(timeSeconds) || timeSeconds < 0 || !Number.isSafeInteger(Math.round(timeSeconds * 1_000_000))) {
      throw createEngineError(ErrorCodes.NATIVE_INVALID_TIME, 'Seek time must be a finite non-negative value', false)
    }
    const frameEpoch = ++this.frameEpoch
    this.statsTracker.stop()
    return new Promise<void>((resolve, reject) => {
      let settled = false
      const finish = (error?: unknown): void => {
        if (settled) return
        settled = true
        this.video.removeEventListener('seeked', onSeeked)
        if (this.seekTimer !== null) {
          clearTimeout(this.seekTimer)
          this.seekTimer = null
        }
        if (!this.closed && this.callbacks.isActive()) {
          this.statsTracker.start(() => this.frameEpoch === frameEpoch && this.callbacks.isActive())
        }
        if (error === undefined) resolve()
        else reject(error)
      }
      const onSeeked = (): void => finish()
      this.video.addEventListener('seeked', onSeeked)
      try {
        if (this.features.fastSeek) this.video.fastSeek(timeSeconds)
        else this.video.setCurrentTime(timeSeconds)
        if (!this.video.seeking) finish()
        else {
          this.seekTimer = setTimeout(() => finish(createEngineError(ErrorCodes.NATIVE_OPERATION_FAILED, 'The seek operation timed out', true)), 10_000)
        }
      } catch (cause) {
        finish(createEngineError(ErrorCodes.NATIVE_OPERATION_FAILED, 'The seek operation failed', true, cause))
      }
    })
  }

  setPlaybackRate(rate: number): void {
    this.ensureOpen()
    if (!Number.isFinite(rate) || rate <= 0) throw createEngineError(ErrorCodes.NATIVE_INVALID_RATE, 'Playback rate must be a finite positive value', false)
    try { this.video.playbackRate = rate } catch (cause) {
      throw createEngineError(ErrorCodes.NATIVE_OPERATION_FAILED, 'The playback rate could not be changed', true, cause)
    }
  }

  setVolume(volume: number): void {
    this.ensureOpen()
    if (!Number.isFinite(volume) || volume < 0 || volume > 1) throw createEngineError(ErrorCodes.NATIVE_INVALID_VOLUME, 'Volume must be between 0 and 1', false)
    try { this.video.volume = volume } catch (cause) {
      throw createEngineError(ErrorCodes.NATIVE_OPERATION_FAILED, 'The volume could not be changed', true, cause)
    }
  }

  setMuted(muted: boolean): void {
    this.ensureOpen()
    try { this.video.muted = muted } catch (cause) {
      throw createEngineError(ErrorCodes.NATIVE_OPERATION_FAILED, 'Mute state could not be changed', true, cause)
    }
  }

  async requestFullscreen(): Promise<void> {
    this.ensureOpen()
    if (!this.features.fullscreen) throw createEngineError(ErrorCodes.NATIVE_FULLSCREEN_UNSUPPORTED, 'Fullscreen is not supported by this video element', true)
    try { await this.video.requestFullscreen() } catch (cause) {
      throw mapNativeDomError(cause, ErrorCodes.NATIVE_FULLSCREEN_BLOCKED, 'Fullscreen was blocked by the browser')
    }
  }

  async exitFullscreen(): Promise<void> {
    this.ensureOpen()
    if (!this.features.fullscreen) throw createEngineError(ErrorCodes.NATIVE_FULLSCREEN_UNSUPPORTED, 'Fullscreen is not supported by this document', true)
    try { await this.video.exitFullscreen() } catch (cause) {
      throw mapNativeDomError(cause, ErrorCodes.NATIVE_FULLSCREEN_BLOCKED, 'Exiting fullscreen was blocked by the browser')
    }
  }

  async requestPictureInPicture(): Promise<void> {
    this.ensureOpen()
    if (!this.features.pictureInPicture) throw createEngineError(ErrorCodes.NATIVE_PIP_UNSUPPORTED, 'Picture-in-Picture is not supported by this video element', true)
    try { await this.video.requestPictureInPicture() } catch (cause) {
      throw mapNativeDomError(cause, ErrorCodes.NATIVE_PIP_BLOCKED, 'Picture-in-Picture was blocked by the browser')
    }
  }

  async exitPictureInPicture(): Promise<void> {
    this.ensureOpen()
    if (!this.features.pictureInPicture) throw createEngineError(ErrorCodes.NATIVE_PIP_UNSUPPORTED, 'Picture-in-Picture is not supported by this document', true)
    try { await this.video.exitPictureInPicture() } catch (cause) {
      throw mapNativeDomError(cause, ErrorCodes.NATIVE_PIP_BLOCKED, 'Exiting Picture-in-Picture was blocked by the browser')
    }
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    ++this.frameEpoch
    try { this.video.pause() } catch { /* best effort during close */ }
    this.statsTracker.stop()
    this.clearTimers()
    this.detachListeners()
    try {
      this.video.clearSource()
      this.video.load()
    } catch { /* best effort network cancellation */ }
    this.releaseObjectUrl()
  }

  private attachListeners(): void {
    for (const type of NATIVE_VIDEO_EVENTS) {
      const listener = (): void => this.handleVideoEvent(type)
      this.listeners.set(type, listener)
      this.video.addEventListener(type, listener)
    }
  }

  private detachListeners(): void {
    for (const [type, listener] of this.listeners) this.video.removeEventListener(type, listener)
    this.listeners.clear()
  }

  private handleVideoEvent(type: NativeVideoEventName): void {
    if (this.closed || !this.callbacks.isActive()) return
    if (type === 'loadedmetadata' || type === 'canplay') {
      this.metadataResolve?.()
      this.metadataResolve = null
      this.callbacks.onEvent({ type: 'ready', duration: toMicros(this.video.duration) })
      return
    }
    if (type === 'play' || type === 'playing') { this.callbacks.onEvent({ type: 'playing' }); return }
    if (type === 'pause') { this.callbacks.onEvent({ type: 'paused' }); return }
    if (type === 'seeking') { this.callbacks.onEvent({ type: 'seeking' }); return }
    if (type === 'seeked') { this.callbacks.onEvent({ type: 'seeked' }); return }
    if (type === 'waiting' || type === 'stalled' || type === 'progress') {
      this.callbacks.onEvent({ type: 'buffering', bufferedAhead: computeBufferedAhead(this.video) })
      return
    }
    if (type === 'timeupdate' || type === 'durationchange') {
      const currentTime = toMicros(this.video.currentTime)
      if (currentTime !== null) this.callbacks.onEvent({ type: 'timeupdate', currentTime, duration: toMicros(this.video.duration) })
      return
    }
    if (type === 'ended') { this.callbacks.onEvent({ type: 'ended' }); return }
    if (type === 'emptied') { this.callbacks.onEvent({ type: 'loading' }); return }
    if (type === 'error') {
      const error = mapVideoError(this.video.element)
      this.metadataReject?.(error)
      this.metadataReject = null
      this.callbacks.onEvent({ type: 'error', error })
      return
    }
  }

  private clearTimers(): void {
    if (this.metadataTimer !== null) clearTimeout(this.metadataTimer)
    if (this.seekTimer !== null) clearTimeout(this.seekTimer)
    this.metadataTimer = null
    this.seekTimer = null
    this.metadataReject?.(createEngineError(ErrorCodes.NATIVE_ABORTED, 'The media load was aborted', true))
    this.metadataReject = null
    this.metadataResolve = null
  }

  private releaseObjectUrl(): void {
    if (this.objectUrl !== null && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
      try { URL.revokeObjectURL(this.objectUrl) } catch { /* best effort */ }
    }
    this.objectUrl = null
  }

  private ensureOpen(): void {
    if (this.closed) throw createEngineError(ErrorCodes.ENGINE_CLOSED, 'The media engine is closed', false)
  }
}

function isEngineErrorValue(value: unknown): value is EngineErrorException {
  return isEngineError(value)
}

function toMicros(seconds: number): number | null {
  if (!Number.isFinite(seconds) || seconds < 0) return null
  const micros = Math.round(seconds * 1_000_000)
  return Number.isSafeInteger(micros) && micros >= 0 ? micros : null
}

function computeBufferedAhead(video: VideoElementAdapter): number {
  const current = toMicros(video.currentTime)
  if (current === null) return 0
  try {
    const ranges = video.buffered
    let end: number | null = null
    for (let index = 0; index < ranges.length; index += 1) {
      const start = ranges.start(index)
      const rangeEnd = ranges.end(index)
      if (!Number.isFinite(start) || !Number.isFinite(rangeEnd)) continue
      if (current / 1_000_000 >= start && current / 1_000_000 <= rangeEnd) end = Math.max(end ?? rangeEnd, rangeEnd)
    }
    if (end === null) return 0
    const ahead = Math.round((end - video.currentTime) * 1_000_000)
    return Number.isSafeInteger(ahead) && ahead >= 0 ? ahead : 0
  } catch {
    return 0
  }
}

function mapVideoError(element: HTMLVideoElement): EngineErrorException {
  const code = element.error?.code
  if (code === 1) return createEngineError(ErrorCodes.NATIVE_ABORTED, 'The media was aborted', true)
  if (code === 2) return createEngineError(ErrorCodes.NATIVE_NETWORK_FAILED, 'The media network request failed', true)
  if (code === 3) return createEngineError(ErrorCodes.NATIVE_DECODE_FAILED, 'The media could not be decoded', false)
  if (code === 4) return createEngineError(ErrorCodes.NATIVE_NOT_SUPPORTED, 'The media format is not supported', false)
  return createEngineError(ErrorCodes.NATIVE_OPERATION_FAILED, 'The native media element reported an error', true)
}

function validateNativeSource(source: SourceDescriptor): void {
  if (source.kind === 'file') return
  if (source.headers && Object.keys(source.headers).length > 0) {
    throw createEngineError(ErrorCodes.NATIVE_CUSTOM_HEADERS_UNSUPPORTED, 'Custom headers cannot be sent by an HTML video element', false)
  }
  try {
    const base = typeof document !== 'undefined' ? document.baseURI : undefined
    const parsed = new URL(source.url, base)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('protocol')
  } catch (cause) {
    throw createEngineError(ErrorCodes.NATIVE_SOURCE_INVALID, 'The remote media source must use HTTP or HTTPS', false, cause)
  }
}
