import {
  createCapabilityContext,
  detectCapabilities,
  probeMediaCapabilities,
} from '@mx-player-max/capabilities'
import { createRangeLoader, probeContainer, type RangeLoader } from '@mx-player-max/demux'
import { createPlatformPolicy } from '@mx-player-max/platform'
import { createStrategyEngine } from '@mx-player-max/strategy'
import type {
  CustomVideoStats,
  DecodedVideoFrame,
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
import { CustomMediaPipeline, type CustomMediaPipelineOptions } from './custom/pipeline'
import type { CustomPipelineEvent } from './custom/events'
import { createEngineError, isEngineError, type EngineErrorException } from './native/errors'
import { NativeMediaPipeline, type NativePipelineEvent } from './native/pipeline'
import { resolveVideoTarget, type ResolvedVideoTarget } from './native/target'

export { EngineErrorException, isEngineError } from './native/errors'
export { NativeMediaPipeline } from './native/pipeline'
export { CustomMediaPipeline } from './custom/pipeline'
export { DemuxWorkerSession, createBrowserDemuxWorkerTransport } from './custom/demux-session'
export { DEFAULT_CUSTOM_VIDEO_OPTIONS, resolveCustomVideoOptions, VideoFrameQueue } from './custom/frame-queue'
export { createVideoElementAdapter } from './native/video-element-adapter'
export type { MediaEngine } from '@mx-player-max/types'
export type { VideoElementAdapter } from './native/video-element-adapter'
export type { NativePipelineEvent } from './native/pipeline'
export type { CustomPipelineEvent } from './custom/events'
export type {
  CustomMediaPipelineOptions,
  CustomPipelineCallbacks,
  CustomPipelineDependencies,
} from './custom/pipeline'
export type {
  DemuxSessionLike,
  DemuxWorkerTransport,
  DemuxWorkerTransportFactory,
} from './custom/demux-session'

type ActivePipeline =
  | { kind: 'native'; pipeline: NativeMediaPipeline }
  | { kind: 'custom-video'; pipeline: CustomMediaPipeline }

export interface MediaEngineDependencies {
  createCustomPipeline?(options: CustomMediaPipelineOptions): CustomMediaPipeline
}

export function createMediaEngine(dependencies: MediaEngineDependencies = {}): MediaEngine {
  let currentState: PlaybackState = 'idle'
  let currentMedia: MediaDescriptor | null = null
  let currentSelection: PlaybackSelection | null = null
  let activePipeline: ActivePipeline | null = null
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
    try { target.video.parentNode?.removeChild(target.video) } catch { /* best effort cleanup */ }
  }

  const releaseUnusedOwnedVideo = (): void => {
    if (!target?.owned) return
    try { target.video.parentNode?.removeChild(target.video) } catch { /* best effort cleanup */ }
    target = null
  }

  const disposePipeline = (): void => {
    probeReader?.close()
    probeReader = null
    activePipeline?.pipeline.close()
    activePipeline = null
    disposeTarget()
    target = null
  }

  const emitError = (error: EngineError): void => {
    if (closed) return
    setState('error')
    emit('error', { error })
  }

  const handleNativeEvent = (event: NativePipelineEvent, loadEpoch: number): void => {
    if (closed || loadEpoch !== epoch || activePipeline?.kind !== 'native' || currentState === 'error') return
    switch (event.type) {
      case 'ready': {
        if (currentState === 'playing') break
        const wasReady = currentState === 'ready'
        setState('ready')
        if (!wasReady && currentSelection) emit('ready', { selection: currentSelection })
        break
      }
      case 'playing': setState('playing'); break
      case 'paused': if (currentState !== 'ended') setState('paused'); break
      case 'seeking': setState('seeking'); break
      case 'seeked': setState(activePipeline.pipeline.video.paused ? 'ready' : 'playing'); break
      case 'buffering': emit('buffering', { bufferedAhead: event.bufferedAhead }); break
      case 'timeupdate': emit('timeupdate', { currentTime: event.currentTime, duration: event.duration }); break
      case 'ended': setState('ended'); break
      case 'error': emitError(event.error); break
      case 'loading': if (currentState !== 'closed') setState('loading'); break
    }
  }

  const handleCustomEvent = (event: CustomPipelineEvent, loadEpoch: number): void => {
    if (closed || loadEpoch !== epoch || activePipeline?.kind !== 'custom-video' || currentState === 'error') return
    switch (event.type) {
      case 'ready': {
        const wasReady = currentState === 'ready'
        setState('ready')
        if (!wasReady && currentSelection) emit('ready', { selection: currentSelection })
        break
      }
      case 'playing': setState('playing'); break
      case 'paused': if (currentState !== 'ended') setState('paused'); break
      case 'seeking': setState('seeking'); break
      case 'seeked': setState(event.resume); break
      case 'frameavailable': emit('frameavailable', { queuedFrames: event.queuedFrames, bufferedDuration: event.bufferedDuration }); break
      case 'ended': setState('ended'); break
      case 'error': emitError(event.error); break
    }
  }

  const engine: MediaEngine = {
    get state() { return currentState },
    get media() { return currentMedia },
    get selection() { return currentSelection },
    get nativeFeatures(): NativeMediaFeatures | null {
      return activePipeline?.kind === 'native' ? activePipeline.pipeline.features : null
    },
    get nativeStats(): NativePlaybackStats | null {
      return activePipeline?.kind === 'native' ? activePipeline.pipeline.stats : null
    },
    get customVideoStats(): CustomVideoStats | null {
      return activePipeline?.kind === 'custom-video' ? activePipeline.pipeline.stats : null
    },

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
      const intent = options.intent ?? 'normal'

      try {
        target = resolveVideoTarget(options.target)
        validateSource(options.source)
        if ((intent === 'normal' || intent === 'low-power')
          && options.source.kind === 'url'
          && options.source.headers
          && Object.keys(options.source.headers).length > 0) {
          throw createEngineError(ErrorCodes.NATIVE_CUSTOM_HEADERS_UNSUPPORTED, 'Custom headers cannot be sent by an HTML video element', false)
        }
        const reader = createRangeLoader(options.source)
        probeReader = reader
        let containerSelection: Awaited<ReturnType<typeof probeContainer>> | null = null
        try {
          containerSelection = await probeContainer(reader)
        } finally {
          try { containerSelection?.demuxer.close() } finally {
            reader.close()
            if (probeReader === reader) probeReader = null
          }
        }
        if (loadEpoch !== epoch || closed) throw loadAborted(intent)
        const media = containerSelection.metadata.media
        const capabilities = await detectCapabilities()
        const report = await probeMediaCapabilities(media, { snapshot: capabilities })
        const context = createCapabilityContext(capabilities, report)
        emit('capabilities', { context })
        const policy = createPlatformPolicy(capabilities)
        const strategy = createStrategyEngine(policy)
        const playbackSelection = strategy.select(media, intent, context)

        if (playbackSelection.backend.kind === 'html-video') {
          if (playbackSelection.intent !== 'normal' && playbackSelection.intent !== 'low-power') {
            throw createEngineError(ErrorCodes.NATIVE_BACKEND_UNAVAILABLE, 'The native backend cannot provide frame access', true)
          }
          if (options.source.kind === 'url' && options.source.headers && Object.keys(options.source.headers).length > 0) {
            throw createEngineError(ErrorCodes.NATIVE_CUSTOM_HEADERS_UNSUPPORTED, 'Custom headers cannot be sent by an HTML video element', false)
          }
          const contentType = report.native.video.contentType ?? report.native.audio.contentType
          if (report.native.playable !== 'supported' || !contentType) {
            throw createEngineError(ErrorCodes.NATIVE_NOT_SUPPORTED, 'The media is not supported by the native video path', false)
          }
          currentMedia = media
          currentSelection = playbackSelection
          const nativePipeline = new NativeMediaPipeline(target.video, {
            isActive: () => !closed && loadEpoch === epoch,
            onEvent: (event) => handleNativeEvent(event, loadEpoch),
          })
          activePipeline = { kind: 'native', pipeline: nativePipeline }
          emit('backendchange', { previous: previousSelection, current: playbackSelection.backend, reason: 'strategy-selection' })
          await nativePipeline.load(options.source, contentType, options.native)
          if (loadEpoch !== epoch || closed) throw loadAborted(intent)
          if (options.autoplay === true) {
            try { await nativePipeline.play() } catch (cause) {
              const error = toEngineError(cause, ErrorCodes.NATIVE_AUTOPLAY_BLOCKED, 'Autoplay was blocked by the browser')
              if (error.code === ErrorCodes.NATIVE_OPERATION_FAILED) {
                throw createEngineError(ErrorCodes.NATIVE_AUTOPLAY_BLOCKED, 'Autoplay was blocked by the browser', true, cause)
              }
              throw error
            }
          }
          return
        }

        if (playbackSelection.backend.kind !== 'webcodecs') {
          throw createEngineError(ErrorCodes.CUSTOM_BACKEND_UNAVAILABLE, 'The selected custom backend is not available in Phase 4', true)
        }
        if (intent === 'normal' || intent === 'low-power') {
          const code = capabilities.webCodecsVideo && report.webCodecs.video.status === 'supported'
            ? ErrorCodes.CUSTOM_BACKEND_UNAVAILABLE
            : ErrorCodes.NATIVE_BACKEND_UNAVAILABLE
          throw createEngineError(code, 'Phase 4 WebCodecs does not provide complete audio/video playback', true)
        }
        if (!capabilities.webCodecsVideo || report.webCodecs.video.status !== 'supported' || !report.query.video) {
          throw createEngineError(ErrorCodes.WEBCODECS_NOT_SUPPORTED, 'The selected video configuration is not supported by WebCodecs', false)
        }
        releaseUnusedOwnedVideo()
        currentMedia = media
        currentSelection = playbackSelection
        const pipelineOptions: CustomMediaPipelineOptions = {
          source: options.source,
          media,
          capabilityReport: report,
          ...(options.customVideo === undefined ? {} : { customVideo: options.customVideo }),
          callbacks: {
            isActive: () => !closed && loadEpoch === epoch,
            onEvent: (event) => handleCustomEvent(event, loadEpoch),
          },
        }
        const customPipeline = dependencies.createCustomPipeline?.(pipelineOptions) ?? new CustomMediaPipeline(pipelineOptions)
        activePipeline = { kind: 'custom-video', pipeline: customPipeline }
        emit('backendchange', { previous: previousSelection, current: playbackSelection.backend, reason: 'strategy-selection' })
        await customPipeline.initialize()
        if (loadEpoch !== epoch || closed) throw loadAborted(intent)
        if (options.autoplay === true) await customPipeline.play()
      } catch (cause) {
        if (loadEpoch !== epoch || closed) throw loadAborted(intent, cause)
        const error = mapLoadError(cause, intent)
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
      if (!activePipeline) throw createEngineError(ErrorCodes.NATIVE_OPERATION_FAILED, 'No media is loaded', true)
      await activePipeline.pipeline.play()
    },

    pause(): void {
      ensureOpen()
      activePipeline?.pipeline.pause()
    },

    async seek(time: Micros): Promise<void> {
      ensureOpen()
      if (!activePipeline) throw createEngineError(ErrorCodes.NATIVE_OPERATION_FAILED, 'No media is loaded', true)
      if (activePipeline.kind === 'native') await activePipeline.pipeline.seek(time / 1_000_000)
      else await activePipeline.pipeline.seek(time)
    },

    setPlaybackRate(rate: number): void {
      ensureOpen()
      if (!activePipeline) throw createEngineError(ErrorCodes.NATIVE_OPERATION_FAILED, 'No media is loaded', true)
      activePipeline.pipeline.setPlaybackRate(rate)
    },

    setVolume(volume: number): void {
      ensureOpen()
      if (!activePipeline) throw createEngineError(ErrorCodes.NATIVE_OPERATION_FAILED, 'No media is loaded', true)
      activePipeline.pipeline.setVolume(volume)
    },

    setMuted(muted: boolean): void {
      ensureOpen()
      if (!activePipeline) throw createEngineError(ErrorCodes.NATIVE_OPERATION_FAILED, 'No media is loaded', true)
      activePipeline.pipeline.setMuted(muted)
    },

    readVideoFrame(): Promise<DecodedVideoFrame | null> {
      try { ensureOpen() } catch (cause) { return Promise.reject(cause) }
      if (activePipeline?.kind !== 'custom-video') {
        return Promise.reject(createEngineError(ErrorCodes.CUSTOM_FRAME_ACCESS_UNAVAILABLE, 'The active native pipeline does not expose VideoFrame objects', false))
      }
      return activePipeline.pipeline.readVideoFrame()
    },

    async requestFullscreen(): Promise<void> {
      ensureOpen()
      if (activePipeline?.kind !== 'native') throw createEngineError(ErrorCodes.NATIVE_FULLSCREEN_UNSUPPORTED, 'Fullscreen requires a native video element or a later custom renderer', true)
      await activePipeline.pipeline.requestFullscreen()
    },

    async exitFullscreen(): Promise<void> {
      ensureOpen()
      if (activePipeline?.kind !== 'native') throw createEngineError(ErrorCodes.NATIVE_FULLSCREEN_UNSUPPORTED, 'Fullscreen requires a native video element or a later custom renderer', true)
      await activePipeline.pipeline.exitFullscreen()
    },

    async requestPictureInPicture(): Promise<void> {
      ensureOpen()
      if (activePipeline?.kind !== 'native') throw createEngineError(ErrorCodes.NATIVE_PIP_UNSUPPORTED, 'Picture-in-Picture requires a native video element or a later custom renderer', true)
      await activePipeline.pipeline.requestPictureInPicture()
    },

    async exitPictureInPicture(): Promise<void> {
      ensureOpen()
      if (activePipeline?.kind !== 'native') throw createEngineError(ErrorCodes.NATIVE_PIP_UNSUPPORTED, 'Picture-in-Picture requires a native video element or a later custom renderer', true)
      await activePipeline.pipeline.exitPictureInPicture()
    },

    close(): void {
      if (closed) return
      closed = true
      ++epoch
      disposePipeline()
      currentMedia = null
      currentSelection = null
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

function mapLoadError(cause: unknown, intent: MXPlayerOptions['intent']): EngineErrorException {
  const customIntent = intent !== undefined && intent !== 'normal' && intent !== 'low-power'
  const code = typeof cause === 'object' && cause !== null && 'code' in cause ? String((cause as { code?: unknown }).code) : ''
  if (isEngineError(cause) && (customIntent || code.startsWith('CUSTOM_') || code.startsWith('WEBCODECS_'))) return cause as EngineErrorException
  if (code === ErrorCodes.RANGE_CORS_FAILED) return createEngineError(ErrorCodes.NATIVE_CORS_FAILED, 'The remote media failed CORS validation', true, cause)
  if (code === ErrorCodes.RANGE_NETWORK_FAILED) return createEngineError(ErrorCodes.NATIVE_NETWORK_FAILED, 'The remote media network request failed', true, cause)
  if (code === ErrorCodes.RANGE_ABORTED) return createEngineError(ErrorCodes.NATIVE_ABORTED, 'The media load was aborted', true, cause)
  if (code === ErrorCodes.STRATEGY_NO_VIABLE_BACKEND) {
    return customIntent
      ? createEngineError(ErrorCodes.CUSTOM_BACKEND_UNAVAILABLE, 'The media has no supported WebCodecs frame-access path', false, cause)
      : createEngineError(ErrorCodes.NATIVE_NOT_SUPPORTED, 'The media has no supported native playback path', false, cause)
  }
  if (code.startsWith('CONTAINER_')) return createEngineError(ErrorCodes.NATIVE_NOT_SUPPORTED, 'The media container is not supported', false, cause)
  if (isEngineError(cause)) return cause as EngineErrorException
  return createEngineError(customIntent ? ErrorCodes.CUSTOM_OPERATION_FAILED : ErrorCodes.NATIVE_OPERATION_FAILED, 'The media could not be loaded', true, cause)
}

function toEngineError(cause: unknown, fallbackCode: string, message: string): EngineErrorException {
  if (isEngineError(cause)) return cause as EngineErrorException
  return createEngineError(fallbackCode, message, true, cause)
}

function loadAborted(intent: MXPlayerOptions['intent'], cause?: unknown): EngineErrorException {
  const customIntent = intent !== undefined && intent !== 'normal' && intent !== 'low-power'
  return createEngineError(customIntent ? ErrorCodes.WEBCODECS_ABORTED : ErrorCodes.NATIVE_ABORTED, 'The media load was superseded', true, cause)
}
