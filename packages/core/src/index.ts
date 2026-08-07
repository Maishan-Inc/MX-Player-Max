import {
  createCapabilityContext,
  detectCapabilities,
  probeMediaCapabilities,
} from '@mx-player-max/capabilities'
import { createRangeLoader, probeContainer, type RangeLoader } from '@mx-player-max/demux'
import { createPlatformPolicy } from '@mx-player-max/platform'
import { createStrategyEngine } from '@mx-player-max/strategy'
import type {
  EngineEventListener,
  EngineEventMap,
  EngineEventName,
  EngineError,
  MediaDescriptor,
  MediaEngine,
  Micros,
  MXPlayerOptions,
  NativeMediaFeatures,
  NativePlaybackStats,
  PlaybackSelection,
  PlaybackState,
  SourceDescriptor,
} from '@mx-player-max/types'
import { ErrorCodes } from '@mx-player-max/types'
import { createEngineError, isEngineError, type EngineErrorException } from './native/errors'
import { NativeMediaPipeline, type NativePipelineEvent } from './native/pipeline'
import { resolveVideoTarget, type ResolvedVideoTarget } from './native/target'

export { EngineErrorException, isEngineError } from './native/errors'
export { NativeMediaPipeline } from './native/pipeline'
export { createVideoElementAdapter } from './native/video-element-adapter'
export type { MediaEngine } from '@mx-player-max/types'
export type { VideoElementAdapter } from './native/video-element-adapter'
export type { NativePipelineEvent } from './native/pipeline'

export function createMediaEngine(): MediaEngine {
  let currentState: PlaybackState = 'idle'
  let currentMedia: MediaDescriptor | null = null
  let currentSelection: PlaybackSelection | null = null
  let currentFeatures: NativeMediaFeatures | null = null
  let pipeline: NativeMediaPipeline | null = null
  let probeReader: RangeLoader | null = null
  let target: ResolvedVideoTarget | null = null
  let epoch = 0
  let closed = false
  const listeners = new Map<EngineEventName, Set<(payload: unknown) => void>>()

  const emit = <K extends EngineEventName>(event: K, payload: EngineEventMap[K]): void => {
    const eventListeners = listeners.get(event)
    if (!eventListeners) return
    for (const listener of [...eventListeners]) listener(payload)
  }

  const setState = (next: PlaybackState): void => {
    if (currentState === next) return
    const previous = currentState
    currentState = next
    emit('statechange', { previous, current: next })
  }

  const ensureOpen = (): void => {
    if (closed) throw createEngineError(ErrorCodes.ENGINE_CLOSED, 'The media engine is closed', false)
  }

  const disposeTarget = (): void => {
    if (!target?.owned) return
    try {
      target.video.parentNode?.removeChild(target.video)
    } catch { /* best effort cleanup */ }
  }

  const disposePipeline = (): void => {
    probeReader?.close()
    probeReader = null
    pipeline?.close()
    pipeline = null
    currentFeatures = null
    disposeTarget()
    target = null
  }

  const emitError = (error: EngineError): void => {
    if (closed) return
    setState('error')
    emit('error', { error })
  }

  const handlePipelineEvent = (event: NativePipelineEvent, loadEpoch: number): void => {
    if (closed || loadEpoch !== epoch) return
    if (currentState === 'error') return
    switch (event.type) {
      case 'ready':
        if (currentState === 'playing') break
        const wasReady = currentState === 'ready'
        setState('ready')
        if (!wasReady && currentSelection) emit('ready', { selection: currentSelection })
        break
      case 'playing':
        setState('playing')
        break
      case 'paused':
        if (currentState !== 'ended') setState('paused')
        break
      case 'seeking':
        setState('seeking')
        break
      case 'seeked':
        setState(pipeline?.video.paused ? 'ready' : 'playing')
        break
      case 'buffering':
        emit('buffering', { bufferedAhead: event.bufferedAhead })
        break
      case 'timeupdate':
        emit('timeupdate', { currentTime: event.currentTime, duration: event.duration })
        break
      case 'ended':
        setState('ended')
        break
      case 'error':
        emitError(event.error)
        break
      case 'loading':
        if (currentState !== 'closed') setState('loading')
        break
    }
  }

  const engine: MediaEngine = {
    get state() { return currentState },
    get media() { return currentMedia },
    get selection() { return currentSelection },
    get nativeFeatures() { return currentFeatures },
    get nativeStats(): NativePlaybackStats | null { return pipeline?.stats ?? null },

    on<K extends EngineEventName>(event: K, listener: EngineEventListener<K>): () => void {
      let eventListeners = listeners.get(event)
      if (!eventListeners) {
        eventListeners = new Set()
        listeners.set(event, eventListeners)
      }
      const stored = listener as unknown as (payload: unknown) => void
      eventListeners.add(stored)
      return () => engine.off(event, listener)
    },

    off<K extends EngineEventName>(event: K, listener: EngineEventListener<K>): void {
      listeners.get(event)?.delete(listener as unknown as (payload: unknown) => void)
    },

    once<K extends EngineEventName>(event: K, listener: EngineEventListener<K>): () => void {
      const wrapped = ((payload: EngineEventMap[K]) => {
        engine.off(event, wrapped)
        listener(payload)
      }) as EngineEventListener<K>
      return engine.on(event, wrapped)
    },

    async load(options: MXPlayerOptions): Promise<void> {
      ensureOpen()
      const loadEpoch = ++epoch
      const previousSelection = currentSelection?.backend ?? null
      disposePipeline()
      currentMedia = null
      currentSelection = null
      setState('loading')

      let resolvedTarget: ResolvedVideoTarget
      try {
        resolvedTarget = resolveVideoTarget(options.target)
        target = resolvedTarget
        validateSource(options.source)
        if (options.source.kind === 'url' && options.source.headers && Object.keys(options.source.headers).length > 0) {
          throw createEngineError(ErrorCodes.NATIVE_CUSTOM_HEADERS_UNSUPPORTED, 'Custom headers cannot be sent by an HTML video element', false)
        }
        const reader = createRangeLoader(options.source)
        probeReader = reader
        let selection: Awaited<ReturnType<typeof probeContainer>> | null = null
        try {
          selection = await probeContainer(reader)
        } finally {
          try {
            selection?.demuxer.close()
          } finally {
            reader.close()
            if (probeReader === reader) probeReader = null
          }
        }
        if (loadEpoch !== epoch || closed) throw createEngineError(ErrorCodes.NATIVE_ABORTED, 'The media load was superseded', true)
        const media = selection.metadata.media
        const capabilities = await detectCapabilities()
        const report = await probeMediaCapabilities(media, { snapshot: capabilities })
        const context = createCapabilityContext(capabilities, report)
        emit('capabilities', { context })
        const policy = createPlatformPolicy(capabilities)
        const strategy = createStrategyEngine(policy)
        const playbackSelection = strategy.select(media, options.intent ?? 'normal', context)
        if (playbackSelection.backend.kind !== 'html-video'
          || (playbackSelection.intent !== 'normal' && playbackSelection.intent !== 'low-power')) {
          throw createEngineError(ErrorCodes.NATIVE_BACKEND_UNAVAILABLE, 'The selected playback backend is not available in this phase', true)
        }
        const contentType = report.native.video.contentType ?? report.native.audio.contentType
        if (report.native.playable !== 'supported' || !contentType) {
          throw createEngineError(ErrorCodes.NATIVE_NOT_SUPPORTED, 'The media is not supported by the native video path', false)
        }
        currentMedia = media
        currentSelection = playbackSelection
        currentFeatures = null
        const nativePipeline = new NativeMediaPipeline(resolvedTarget.video, {
          isActive: () => !closed && loadEpoch === epoch,
          onEvent: (event) => handlePipelineEvent(event, loadEpoch),
        })
        pipeline = nativePipeline
        currentFeatures = nativePipeline.features
        if (previousSelection || playbackSelection.backend) {
          emit('backendchange', { previous: previousSelection, current: playbackSelection.backend, reason: 'strategy-selection' })
        }
        await nativePipeline.load(options.source, contentType, options.native)
        if (loadEpoch !== epoch || closed) throw createEngineError(ErrorCodes.NATIVE_ABORTED, 'The media load was superseded', true)
        if (options.autoplay === true) {
          try {
            await nativePipeline.play()
          } catch (cause) {
            const error = toEngineError(cause, ErrorCodes.NATIVE_AUTOPLAY_BLOCKED, 'Autoplay was blocked by the browser')
            if (error.code === ErrorCodes.NATIVE_OPERATION_FAILED) {
              throw createEngineError(ErrorCodes.NATIVE_AUTOPLAY_BLOCKED, 'Autoplay was blocked by the browser', true, cause)
            }
            throw error
          }
        }
      } catch (cause) {
        if (loadEpoch !== epoch || closed) {
          throw createEngineError(ErrorCodes.NATIVE_ABORTED, 'The media load was superseded', true, cause)
        }
        const error = mapLoadError(cause)
        if (error.code === ErrorCodes.NATIVE_AUTOPLAY_BLOCKED) {
          if (currentState !== 'ready') setState('ready')
          emit('error', { error })
        } else {
          emitError(error)
          disposePipeline()
        }
        throw error
      }
    },

    async play(): Promise<void> {
      ensureOpen()
      if (!pipeline) throw createEngineError(ErrorCodes.NATIVE_OPERATION_FAILED, 'No media is loaded', true)
      await pipeline.play()
    },

    pause(): void {
      ensureOpen()
      if (!pipeline) return
      pipeline.pause()
    },

    async seek(time: Micros): Promise<void> {
      ensureOpen()
      if (!pipeline) throw createEngineError(ErrorCodes.NATIVE_OPERATION_FAILED, 'No media is loaded', true)
      const seconds = time / 1_000_000
      await pipeline.seek(seconds)
    },

    setPlaybackRate(rate: number): void {
      ensureOpen()
      if (!pipeline) throw createEngineError(ErrorCodes.NATIVE_OPERATION_FAILED, 'No media is loaded', true)
      pipeline.setPlaybackRate(rate)
    },

    setVolume(volume: number): void {
      ensureOpen()
      if (!pipeline) throw createEngineError(ErrorCodes.NATIVE_OPERATION_FAILED, 'No media is loaded', true)
      pipeline.setVolume(volume)
    },

    setMuted(muted: boolean): void {
      ensureOpen()
      if (!pipeline) throw createEngineError(ErrorCodes.NATIVE_OPERATION_FAILED, 'No media is loaded', true)
      pipeline.setMuted(muted)
    },

    async requestFullscreen(): Promise<void> {
      ensureOpen()
      if (!pipeline) throw createEngineError(ErrorCodes.NATIVE_FULLSCREEN_UNSUPPORTED, 'No native video element is available', true)
      await pipeline.requestFullscreen()
    },

    async exitFullscreen(): Promise<void> {
      ensureOpen()
      if (!pipeline) throw createEngineError(ErrorCodes.NATIVE_FULLSCREEN_UNSUPPORTED, 'No native video element is available', true)
      await pipeline.exitFullscreen()
    },

    async requestPictureInPicture(): Promise<void> {
      ensureOpen()
      if (!pipeline) throw createEngineError(ErrorCodes.NATIVE_PIP_UNSUPPORTED, 'No native video element is available', true)
      await pipeline.requestPictureInPicture()
    },

    async exitPictureInPicture(): Promise<void> {
      ensureOpen()
      if (!pipeline) throw createEngineError(ErrorCodes.NATIVE_PIP_UNSUPPORTED, 'No native video element is available', true)
      await pipeline.exitPictureInPicture()
    },

    close(): void {
      if (closed) return
      closed = true
      ++epoch
      disposePipeline()
      currentMedia = null
      currentSelection = null
      currentFeatures = null
      setState('closed')
      listeners.clear()
    },
  }

  return engine
}

function validateSource(source: SourceDescriptor): void {
  if (source.kind === 'file') {
    if (!source.file || typeof source.file !== 'object') throw createEngineError(ErrorCodes.NATIVE_SOURCE_INVALID, 'The local media source is invalid', false)
    return
  }
  try {
    const base = typeof document !== 'undefined' ? document.baseURI : undefined
    const parsed = new URL(source.url, base)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('protocol')
  } catch (cause) {
    throw createEngineError(ErrorCodes.NATIVE_SOURCE_INVALID, 'The remote media source must use HTTP or HTTPS', false, cause)
  }
}

function mapLoadError(cause: unknown): EngineErrorException {
  const code = typeof cause === 'object' && cause !== null && 'code' in cause ? String((cause as { code?: unknown }).code) : ''
  if (code === ErrorCodes.RANGE_CORS_FAILED) return createEngineError(ErrorCodes.NATIVE_CORS_FAILED, 'The remote media failed CORS validation', true, cause)
  if (code === ErrorCodes.RANGE_NETWORK_FAILED) return createEngineError(ErrorCodes.NATIVE_NETWORK_FAILED, 'The remote media network request failed', true, cause)
  if (code === ErrorCodes.RANGE_ABORTED) return createEngineError(ErrorCodes.NATIVE_ABORTED, 'The media load was aborted', true, cause)
  if (code === ErrorCodes.STRATEGY_NO_VIABLE_BACKEND) return createEngineError(ErrorCodes.NATIVE_NOT_SUPPORTED, 'The media has no supported native playback path', false, cause)
  if (code.startsWith('CONTAINER_')) return createEngineError(ErrorCodes.NATIVE_NOT_SUPPORTED, 'The media container is not supported', false, cause)
  if (isEngineError(cause)) return cause as EngineErrorException
  return createEngineError(ErrorCodes.NATIVE_OPERATION_FAILED, 'The media could not be loaded', true, cause)
}

function toEngineError(cause: unknown, fallbackCode: string, message: string): EngineErrorException {
  if (isEngineError(cause)) return cause as EngineErrorException
  return createEngineError(fallbackCode, message, true, cause)
}
