import {
  createCapabilityContext,
  detectCapabilities,
  probeMediaCapabilities,
} from '@mx-player-max/capabilities'
import { createRangeLoader, probeContainer, type RangeLoader } from '@mx-player-max/demux'
import { createPlatformPolicy } from '@mx-player-max/platform'
import { createStrategyEngine } from '@mx-player-max/strategy'
import { createRenderer } from '@mx-player-max/renderers'
import type { ManagedVideoRenderer, RendererEvent, RendererFactoryOptions } from '@mx-player-max/renderers'
import type {
  AudioClockSnapshot,
  CustomAudioStats,
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
  CustomRendererKind,
  RendererStats,
  RendererState,
  VideoFilterOptions,
  VideoTransformOptions,
  ExternalSubtitleSourceDescriptor,
  SubtitleCueStyle,
  SubtitleState,
  SubtitleTrack,
  SubtitleTrackOptions,
} from '@mx-player-max/types'
import { ErrorCodes } from '@mx-player-max/types'
import { CustomMediaPipeline, type CustomMediaPipelineOptions } from './custom/pipeline'
import type { CustomPipelineEvent } from './custom/events'
import { createEngineError, isEngineError, type EngineErrorException } from './native/errors'
import { NativeMediaPipeline, type NativePipelineEvent } from './native/pipeline'
import { resolveVideoTarget, type ResolvedVideoTarget } from './native/target'
import { CustomRenderLoop } from './custom/render-loop'
import {
  AiPipeline,
  RIFE_V425_MANIFEST,
  RT4KSR_X2_MANIFEST,
  WebGpuInterpolationStage,
  WebGpuSuperResolutionStage,
  loadAiModelAsset,
  parseMxai,
  type AiPipelineEvent,
  type AiPipelineOptions,
} from '@mx-player-max/postprocess'
import type { CustomRenderableFrame } from './custom/render-loop'
import { CoreSubtitleController } from './subtitles'
import { DEFAULT_SUBTITLE_STYLE, toSubtitleError } from '@mx-player-max/subtitles'

export { EngineErrorException, isEngineError } from './native/errors'
export { NativeMediaPipeline } from './native/pipeline'
export { CustomMediaPipeline } from './custom/pipeline'
export { CoreSubtitleController } from './subtitles'
export { CustomAudioController } from './custom/audio-controller'
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

interface ResolvedCustomCanvasTarget {
  canvas: HTMLCanvasElement
  restore(): void
}

export interface MediaEngineDependencies {
  createCustomPipeline?(options: CustomMediaPipelineOptions): CustomMediaPipeline
  createRenderer?(options: RendererFactoryOptions): ManagedVideoRenderer
}

export function createMediaEngine(dependencies: MediaEngineDependencies = {}): MediaEngine {
  let currentState: PlaybackState = 'idle'
  let currentMedia: MediaDescriptor | null = null
  let currentSelection: PlaybackSelection | null = null
  let activePipeline: ActivePipeline | null = null
  let probeReader: RangeLoader | null = null
  let target: ResolvedVideoTarget | null = null
  let customCanvas: ResolvedCustomCanvasTarget | null = null
  let activeRenderer: ManagedVideoRenderer | null = null
  let renderLoop: CustomRenderLoop | null = null
  let aiPipeline: AiPipeline | null = null
  let subtitleController: CoreSubtitleController | null = null
  let customPipelineReady = false
  let customRendererRequired = false
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
    if (!target?.owned || !target.video) return
    try { target.video.parentNode?.removeChild(target.video) } catch { /* best effort cleanup */ }
  }

  const disposeCustomCanvas = (): void => {
    if (!customCanvas) return
    try { customCanvas.restore() } catch { /* best effort cleanup */ }
    customCanvas = null
  }

  const releaseUnusedOwnedVideo = (): void => {
    if (!target?.owned || !target.video) return
    try { target.video.parentNode?.removeChild(target.video) } catch { /* best effort cleanup */ }
  }

  const disposePipeline = (): void => {
    subtitleController?.close()
    subtitleController = null
    renderLoop?.close()
    renderLoop = null
    aiPipeline?.close()
    aiPipeline = null
    activeRenderer?.close()
    activeRenderer = null
    probeReader?.close()
    probeReader = null
    activePipeline?.pipeline.close()
    activePipeline = null
    disposeCustomCanvas()
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
      case 'playing': subtitleController?.play(); setState('playing'); break
      case 'paused': subtitleController?.pause(); if (currentState !== 'ended') setState('paused'); break
      case 'seeking': subtitleController?.seekStarted(); setState('seeking'); break
      case 'seeked': subtitleController?.seekCompleted(); setState(activePipeline.pipeline.video.paused ? 'ready' : 'playing'); break
      case 'buffering': emit('buffering', { bufferedAhead: event.bufferedAhead }); break
      case 'timeupdate': emit('timeupdate', { currentTime: event.currentTime, duration: event.duration }); break
      case 'ended': subtitleController?.ended(); setState('ended'); break
      case 'error': emitError(event.error); break
      case 'loading': if (currentState !== 'closed') setState('loading'); break
    }
  }

  const handleCustomEvent = (event: CustomPipelineEvent, loadEpoch: number): void => {
    if (closed || loadEpoch !== epoch || activePipeline?.kind !== 'custom-video' || currentState === 'error') return
    switch (event.type) {
      case 'ready': {
        customPipelineReady = true
        publishCustomReady()
        break
      }
      case 'playing': renderLoop?.start(); subtitleController?.play(); setState('playing'); break
      case 'paused': renderLoop?.pause(); subtitleController?.pause(); if (currentState !== 'ended') setState('paused'); break
      case 'seeking': renderLoop?.stop(true); aiPipeline?.reset(activePipeline.pipeline.epoch); subtitleController?.seekStarted(); setState('seeking'); break
      case 'seeked': if (event.resume === 'playing') renderLoop?.start(); subtitleController?.seekCompleted(); setState(event.resume); break
      case 'frameavailable': emit('frameavailable', { queuedFrames: event.queuedFrames, bufferedDuration: event.bufferedDuration }); break
      case 'audiostatechange': emit('audiostatechange', { state: event.stats.outputState, stats: event.stats }); break
      case 'audiounderrun': emit('audiounderrun', { count: event.stats.underruns, bufferedDuration: event.stats.bufferedDuration }); break
      case 'clockupdate': subtitleController?.clockUpdate(); emit('clockupdate', { clock: event.clock }); break
      case 'buffering': emit('buffering', { bufferedAhead: event.bufferedAhead }); break
      case 'ended': renderLoop?.stop(true); subtitleController?.ended(); setState('ended'); break
      case 'error': emitError(event.error); break
    }
  }

  const publishCustomReady = (): void => {
    if (!customPipelineReady || (customRendererRequired && activeRenderer?.state !== 'ready')) return
    const wasReady = currentState === 'ready'
    setState('ready')
    if (!wasReady && currentSelection) emit('ready', { selection: currentSelection })
  }

  const handleRendererEvent = (event: RendererEvent, loadEpoch: number): void => {
    if (closed || loadEpoch !== epoch || activePipeline?.kind !== 'custom-video' || !activeRenderer) return
    if (event.type === 'state') {
      emit('rendererstatechange', { kind: event.kind, previous: event.previous, current: event.current, reason: event.reason })
    } else if (event.type === 'fallback') {
      emit('rendererchange', { previous: event.previous, current: event.current, reason: event.reason })
    } else if (event.type === 'stats') {
      emit('rendererstats', { stats: event.stats })
    } else if (event.type === 'error') {
      emit('error', { error: { code: event.error.code, message: event.error.message, recoverable: event.error.recoverable } })
    }
  }

  const handleAiEvent = (event: AiPipelineEvent, loadEpoch: number): void => {
    if (closed || loadEpoch !== epoch || activePipeline?.kind !== 'custom-video') return
    if (event.type === 'qualitychange' && event.previous !== undefined && event.current !== undefined) {
      emit('qualitychange', { previous: event.previous, current: event.current, reasons: [event.reason] })
    } else if (event.type === 'error') {
      emit('error', { error: { code: ErrorCodes.RENDERER_AI_PIPELINE_FAILED, message: event.reason, recoverable: true } })
    } else if (event.type === 'fallback') {
      emit('error', { error: { code: ErrorCodes.RENDERER_AI_PIPELINE_FAILED, message: `AI post-processing fell back to passthrough: ${event.reason}`, recoverable: true } })
    }
  }

  const handleSubtitleEvent = (event: import('@mx-player-max/subtitles').SubtitleManagerEvent, loadEpoch: number): void => {
    if (closed || loadEpoch !== epoch) return
    switch (event.type) {
      case 'trackchange': emit('subtitletrackchange', event); break
      case 'cuechange': emit('subtitlecuechange', event); break
      case 'statechange': emit('subtitlestatechange', event); break
      case 'stylechange': emit('subtitlestylechange', event); break
      case 'warning':
        emit('subtitlewarning', event)
        if (event.diagnostic.severity === 'error') {
          emit('error', { error: { code: event.diagnostic.code, message: event.diagnostic.message, recoverable: true } })
        }
        break
    }
  }

  const setupSubtitles = async (
    source: SourceDescriptor,
    media: MediaDescriptor,
    loadEpoch: number,
    resolvedTarget: ResolvedVideoTarget,
    surface: HTMLVideoElement | HTMLCanvasElement | null,
    rendererKind: CustomRendererKind | null,
    subtitleOptions: MXPlayerOptions['subtitles'],
  ): Promise<void> => {
    let controller: CoreSubtitleController | null = null
    try {
      controller = new CoreSubtitleController({
        source,
        media,
        target: resolvedTarget,
        surface,
        rendererKind,
        ...(subtitleOptions === undefined ? {} : { subtitleOptions }),
        ...(activePipeline?.kind === 'custom-video' ? {
          getCustomClock: () => activePipeline?.kind === 'custom-video' ? activePipeline.pipeline.audioClock : null,
          getCustomPlaying: () => activePipeline?.kind === 'custom-video' && activePipeline.pipeline.audioClock.running,
        } : {}),
        onEvent: (event) => handleSubtitleEvent(event, loadEpoch),
      })
      subtitleController = controller
      await controller.initialize()
    } catch (cause) {
      controller?.close()
      if (subtitleController === controller) subtitleController = null
      if (closed || loadEpoch !== epoch) return
      const safeError = toSubtitleError(cause, ErrorCodes.SUBTITLE_OPERATION_FAILED, 'Subtitle initialization failed', true)
      const code = safeError.code
      emit('error', { error: { code, message: 'Subtitle initialization failed; playback continues', recoverable: true } })
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
    get customAudioStats(): CustomAudioStats | null {
      return activePipeline?.kind === 'custom-video' ? activePipeline.pipeline.audioStats : null
    },
    get audioClock(): AudioClockSnapshot | null {
      return activePipeline?.kind === 'custom-video' ? activePipeline.pipeline.audioClock : null
    },
    get rendererKind(): CustomRendererKind | null { return activePipeline?.kind === 'custom-video' ? activeRenderer?.kind ?? null : null },
    get rendererState(): RendererState | null { return activePipeline?.kind === 'custom-video' ? activeRenderer?.state ?? null : null },
    get rendererStats(): RendererStats | null { return activePipeline?.kind === 'custom-video' ? activeRenderer?.stats ?? null : null },
    get subtitleTracks(): readonly SubtitleTrack[] { return subtitleController?.tracks ?? [] },
    get selectedSubtitleTrack(): string | null { return subtitleController?.selectedTrackId ?? null },
    get subtitleState(): SubtitleState { return subtitleController?.state ?? 'disabled' },
    get subtitleStyle(): SubtitleCueStyle { return subtitleController?.style ?? { ...DEFAULT_SUBTITLE_STYLE } },

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
      customPipelineReady = false
      customRendererRequired = false
      setState('loading')
      const requestedIntent = options.intent ?? 'normal'
      const filterEnabled = options.customVideo?.filter !== undefined && options.customVideo.filter.kind !== 'none'
      const intent = filterEnabled && (requestedIntent === 'normal' || requestedIntent === 'low-power') ? 'filters' : requestedIntent

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
          if (!target.video) throw createEngineError(ErrorCodes.ENGINE_INVALID_TARGET, 'Native playback requires a video element or container target', false)
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
          if (!target) throw createEngineError(ErrorCodes.ENGINE_INVALID_TARGET, 'Subtitle target is unavailable', false)
          await setupSubtitles(options.source, media, loadEpoch, target, target.video, null, options.subtitles)
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
        const shouldCreateRenderer = dependencies.createRenderer !== undefined || dependencies.createCustomPipeline === undefined
        if ((intent === 'normal' || intent === 'low-power') && !shouldCreateRenderer) {
          const code = capabilities.webCodecsVideo && report.webCodecs.video.status === 'supported'
            ? ErrorCodes.CUSTOM_BACKEND_UNAVAILABLE
            : ErrorCodes.NATIVE_BACKEND_UNAVAILABLE
          throw createEngineError(code, 'Phase 4 WebCodecs does not provide complete audio/video playback', true)
        }
        if (!capabilities.webCodecsVideo || report.webCodecs.video.status !== 'supported' || !report.query.video) {
          // A normal/low-power request must never silently turn into a partial
          // custom path when WebCodecs cannot provide the selected video track.
          // Preserve the native-path contract for that case; explicit custom
          // intents still expose the precise WebCodecs capability error.
          const code = intent === 'normal' || intent === 'low-power'
            ? ErrorCodes.NATIVE_BACKEND_UNAVAILABLE
            : ErrorCodes.WEBCODECS_NOT_SUPPORTED
          throw createEngineError(code, 'The selected video configuration is not supported by the requested playback path', false)
        }
        const hasAudioTrack = media.tracks.some((track) => track.kind === 'audio')
        if (hasAudioTrack && (!capabilities.webCodecsAudio || report.webCodecs.audio.status !== 'supported' || !report.query.audio)) {
          throw createEngineError(ErrorCodes.CUSTOM_AUDIO_BACKEND_UNAVAILABLE, 'The selected audio configuration is not supported by WebCodecs', false)
        }
        releaseUnusedOwnedVideo()
        customRendererRequired = shouldCreateRenderer
        if (shouldCreateRenderer) {
          customCanvas = createCustomCanvasTarget(target)
        }
        currentMedia = media
        currentSelection = playbackSelection
        if (intent === 'ai-enhance' && playbackSelection.aiPlan?.proposedTier === 'off') {
          emit('error', {
            error: {
              code: ErrorCodes.RENDERER_AI_UNSUPPORTED,
              message: 'AI post-processing is unavailable; continuing with the verified custom passthrough path',
              recoverable: true,
            },
          })
        }
        const pipelineOptions: CustomMediaPipelineOptions = {
          source: options.source,
          media,
          capabilityReport: report,
          capabilities,
          ...(options.customVideo === undefined ? {} : { customVideo: options.customVideo }),
          ...(options.customAudio === undefined ? {} : { customAudio: options.customAudio }),
          callbacks: {
            isActive: () => !closed && loadEpoch === epoch,
            onEvent: (event) => handleCustomEvent(event, loadEpoch),
          },
        }
        const customPipeline = dependencies.createCustomPipeline?.(pipelineOptions) ?? new CustomMediaPipeline(pipelineOptions)
        activePipeline = { kind: 'custom-video', pipeline: customPipeline }
        emit('backendchange', { previous: previousSelection, current: playbackSelection.backend, reason: 'strategy-selection' })
        await customPipeline.initialize()
        if (shouldCreateRenderer && customCanvas) {
          const rendererOptions: RendererFactoryOptions = {
            capabilities,
            ...(options.customVideo?.renderer === undefined ? {} : { preference: options.customVideo.renderer }),
            ...(options.customVideo?.filter === undefined ? {} : { filter: options.customVideo.filter }),
            ...(options.customVideo?.render === undefined ? {} : { transform: options.customVideo.render }),
            ...(options.customVideo?.preserveHdr === undefined ? {} : { preserveHdr: options.customVideo.preserveHdr }),
            onEvent: (event) => handleRendererEvent(event, loadEpoch),
          }
          activeRenderer = dependencies.createRenderer?.(rendererOptions)
            ?? createRenderer(options.customVideo?.renderer ?? 'auto', rendererOptions)
          await activeRenderer.attach(customCanvas.canvas)
          const renderer = activeRenderer
          const rendererDevice = renderer.kind === 'webgpu' ? renderer.device : null
          if (intent === 'ai-enhance' && playbackSelection.aiPlan?.proposedTier !== 'off'
            && renderer.kind === 'webgpu' && rendererDevice && 'decodedFrameSource' in customPipeline) {
            let rifeModel: ReturnType<typeof parseMxai> | undefined
            let rt4kSrModel: ReturnType<typeof parseMxai> | undefined
            if (options.aiModelBaseUrl !== undefined) {
              try {
                const asset = await loadAiModelAsset(RIFE_V425_MANIFEST, 'f32', { baseUrl: options.aiModelBaseUrl })
                rifeModel = parseMxai(asset.bytes)
              } catch (error) {
                emit('error', { error: { code: aiModelErrorCode(error), message: `RIFE model load failed: ${String(error)}`, recoverable: true } })
              }
              try {
                const asset = await loadAiModelAsset(RT4KSR_X2_MANIFEST, 'f32', { baseUrl: options.aiModelBaseUrl })
                rt4kSrModel = parseMxai(asset.bytes)
              } catch (error) {
                emit('error', { error: { code: aiModelErrorCode(error), message: `RT4KSR model load failed: ${String(error)}`, recoverable: true } })
              }
            }
            const aiOptions: AiPipelineOptions = {
              upstream: customPipeline.decodedFrameSource,
              initialTier: playbackSelection.aiPlan?.proposedTier ?? 'low',
              ...(options.aiPostProcess?.maxTier === undefined ? {} : { maxTier: options.aiPostProcess.maxTier }),
              ...(options.aiPostProcess?.interpolation === 'off' ? {} : { interpolation: new WebGpuInterpolationStage({ device: rendererDevice, ...(rifeModel === undefined ? {} : { model: rifeModel }) }) }),
              ...(options.aiPostProcess?.superResolution === 'off' ? {} : { superResolution: new WebGpuSuperResolutionStage({ device: rendererDevice, ...(rt4kSrModel === undefined ? {} : { model: rt4kSrModel }) }) }),
              onEvent: (event) => handleAiEvent(event, loadEpoch),
            }
            aiPipeline = new AiPipeline(aiOptions)
          }
          publishCustomReady()
          renderLoop = new CustomRenderLoop({
            readVideoFrame: () => customPipeline.readVideoFrame(),
            ...(aiPipeline === null ? {} : {
              readRenderableFrame: async (): Promise<CustomRenderableFrame | null> => {
                const clock = customPipeline.audioClock
                const processed = await aiPipeline?.frameAt(clock.mediaTime, clock.epoch)
                if (!processed) return null
                const detached = customPipeline.consumeFramesThrough(processed.timestamp)
                if (processed.location === 'cpu') {
                  const delivered = detached.find((value) => value.frame === processed.frame)
                  for (const value of detached) if (value !== delivered) safeCloseVideoFrame(value.frame)
                  if (!delivered) {
                    safeCloseVideoFrame(processed.frame)
                    return null
                  }
                  return { kind: 'video', frame: delivered }
                }
                for (const value of detached) safeCloseVideoFrame(value.frame)
                return { kind: 'gpu', frame: { ...processed, epoch: clock.epoch } }
              },
            }),
            getClock: () => customPipeline.audioClock,
            renderer,
            isActive: () => !closed && loadEpoch === epoch && activePipeline?.kind === 'custom-video',
            onError: (error) => handleRendererEvent({ type: 'error', kind: renderer.kind, error }, loadEpoch),
          })
        }
        if (!target) throw createEngineError(ErrorCodes.ENGINE_INVALID_TARGET, 'Subtitle target is unavailable', false)
        await setupSubtitles(options.source, media, loadEpoch, target, customCanvas?.canvas ?? null, activeRenderer?.kind ?? null, options.subtitles)
        if (loadEpoch !== epoch || closed) throw loadAborted(intent)
        if (options.autoplay === true) await customPipeline.play()
      } catch (cause) {
        if (loadEpoch !== epoch || closed) throw loadAborted(intent, cause)
        const error = mapLoadError(cause, intent)
        if (error.code === ErrorCodes.NATIVE_AUTOPLAY_BLOCKED || error.code === ErrorCodes.AUDIO_AUTOPLAY_BLOCKED) {
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
      subtitleController?.rateChanged()
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

    async setVideoFilter(filter: VideoFilterOptions): Promise<void> {
      ensureOpen()
      if (activePipeline?.kind !== 'custom-video' || !activeRenderer) {
        throw createEngineError(ErrorCodes.RENDERER_BACKEND_UNAVAILABLE, 'Runtime Native to Custom renderer switching requires a reload', true)
      }
      activeRenderer.setFilter(filter)
    },

    setVideoTransform(transform: VideoTransformOptions): void {
      ensureOpen()
      if (activePipeline?.kind !== 'custom-video' || !activeRenderer) throw createEngineError(ErrorCodes.RENDERER_BACKEND_UNAVAILABLE, 'A Custom renderer is not active', true)
      activeRenderer.setTransform(transform)
    },
    listSubtitleTracks(): readonly SubtitleTrack[] { return subtitleController?.listTracks() ?? [] },
    addSubtitleTrack(source: ExternalSubtitleSourceDescriptor, options?: SubtitleTrackOptions): Promise<SubtitleTrack> {
      if (!subtitleController) return Promise.reject(createEngineError(ErrorCodes.SUBTITLE_OPERATION_FAILED, 'No media is loaded for subtitles', true))
      return subtitleController.addTrack(source, options)
    },
    selectSubtitleTrack(trackId: string | null): Promise<void> {
      if (!subtitleController) return Promise.reject(createEngineError(ErrorCodes.SUBTITLE_OPERATION_FAILED, 'No media is loaded for subtitles', true))
      return subtitleController.selectTrack(trackId)
    },
    removeSubtitleTrack(trackId: string): void {
      if (!subtitleController) throw createEngineError(ErrorCodes.SUBTITLE_OPERATION_FAILED, 'No media is loaded for subtitles', true)
      subtitleController.removeTrack(trackId)
    },
    closeSubtitles(): void { subtitleController?.closeSubtitles() },
    setSubtitleStyle(style: SubtitleCueStyle): void {
      if (!subtitleController) throw createEngineError(ErrorCodes.SUBTITLE_OPERATION_FAILED, 'No media is loaded for subtitles', true)
      subtitleController.setStyle(style)
    },
    resetSubtitleStyle(): void {
      if (!subtitleController) throw createEngineError(ErrorCodes.SUBTITLE_OPERATION_FAILED, 'No media is loaded for subtitles', true)
      subtitleController.resetStyle()
    },
    attachSubtitleOverlay(host?: HTMLElement): void {
      if (!subtitleController) throw createEngineError(ErrorCodes.SUBTITLE_OVERLAY_UNAVAILABLE, 'Subtitle overlay is not available', true)
      try { subtitleController.attachOverlay(host) } catch { throw createEngineError(ErrorCodes.SUBTITLE_OVERLAY_UNAVAILABLE, 'Subtitle overlay is not available', true) }
    },
    detachSubtitleOverlay(): void { subtitleController?.detachOverlay() },

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
      await activePipeline.pipeline.requestFullscreen(subtitleController?.fullscreenHost ?? undefined)
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

function createCustomCanvasTarget(resolved: ResolvedVideoTarget | null): ResolvedCustomCanvasTarget {
  if (!resolved) throw createEngineError(ErrorCodes.RENDERER_TARGET_INVALID, 'A Custom renderer has no output target', false)
  if (isCanvasTarget(resolved.target)) return { canvas: resolved.target, restore: () => {} }
  const doc = resolved.target.ownerDocument
  if (!doc) throw createEngineError(ErrorCodes.RENDERER_TARGET_INVALID, 'A Custom renderer target has no owner document', false)
  let canvas: HTMLCanvasElement
  try { canvas = doc.createElement('canvas') }
  catch (cause) { throw createEngineError(ErrorCodes.RENDERER_TARGET_INVALID, 'The Custom renderer canvas could not be created', false, cause) }
  try {
    if (resolved.container) {
      resolved.container.appendChild(canvas)
      return { canvas, restore: () => { canvas.parentNode?.removeChild(canvas) } }
    }
    const video = resolved.video
    const parent = video?.parentNode
    if (!video || !parent || typeof (parent as { replaceChild?: unknown }).replaceChild !== 'function') throw new Error('detached-target')
    parent.replaceChild(canvas, video)
    return {
      canvas,
      restore: () => {
        if (canvas.parentNode && typeof (canvas.parentNode as { replaceChild?: unknown }).replaceChild === 'function') {
          canvas.parentNode.replaceChild(video, canvas)
        }
      },
    }
  } catch (cause) {
    throw createEngineError(ErrorCodes.RENDERER_TARGET_INVALID, 'The Custom renderer canvas could not be attached', false, cause)
  }
}

function isCanvasTarget(value: HTMLElement): value is HTMLCanvasElement {
  if (typeof HTMLCanvasElement !== 'undefined' && value instanceof HTMLCanvasElement) return true
  return String((value as { tagName?: unknown }).tagName ?? '').toLowerCase() === 'canvas'
}

function mapLoadError(cause: unknown, intent: MXPlayerOptions['intent']): EngineErrorException {
  const customIntent = intent !== undefined && intent !== 'normal' && intent !== 'low-power'
  const code = typeof cause === 'object' && cause !== null && 'code' in cause ? String((cause as { code?: unknown }).code) : ''
  if (isEngineError(cause) && (customIntent || code.startsWith('CUSTOM_') || code.startsWith('WEBCODECS_') || code.startsWith('AUDIO_') || code.startsWith('RENDERER_'))) return cause as EngineErrorException
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

function aiModelErrorCode(cause: unknown): typeof ErrorCodes.RENDERER_AI_MODEL_LOAD_FAILED | typeof ErrorCodes.RENDERER_AI_MODEL_HASH_MISMATCH {
  return String(cause).toLowerCase().includes('hash')
    ? ErrorCodes.RENDERER_AI_MODEL_HASH_MISMATCH
    : ErrorCodes.RENDERER_AI_MODEL_LOAD_FAILED
}

function loadAborted(intent: MXPlayerOptions['intent'], cause?: unknown): EngineErrorException {
  const customIntent = intent !== undefined && intent !== 'normal' && intent !== 'low-power'
  return createEngineError(customIntent ? ErrorCodes.WEBCODECS_ABORTED : ErrorCodes.NATIVE_ABORTED, 'The media load was superseded', true, cause)
}

function safeCloseVideoFrame(frame: VideoFrame): void {
  try { frame.close() } catch { /* best effort */ }
}
