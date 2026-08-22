import {
  createCapabilityContext,
  detectCapabilities,
  detectWasmCapabilities,
  probeMediaCapabilities,
} from '@mx-player-max/capabilities'
import { createRangeLoader, probeContainer, type RangeLoader } from '@mx-player-max/demux'
import { createWasmDecoderRegistry, resolveWasmAssetUrl } from '@mx-player-max/decoder-wasm'
import {
  createLibvpxVp8Plugin,
  createLibvpxVp8VideoDecoderConfig,
  WorkerLibvpxVp8DecoderAdapter,
} from '@mx-player-max/decoder-wasm-vpx'
import { createPlatformPolicy } from '@mx-player-max/platform'
import { createStrategyEngine } from '@mx-player-max/strategy'
import { createRenderer } from '@mx-player-max/renderers'
import type { ManagedVideoRenderer, RendererEvent, RendererFactoryOptions } from '@mx-player-max/renderers'
import type {
  AiPostProcessRequest,
  AiPostProcessStatus,
  AiStageStatus,
  AiUnavailableReason,
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
  BackendCandidate,
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
  PlaybackSnapshot,
  PlaybackDecisionTrace,
  StrategyEvaluation,
  TrackInfo,
  WasmDecoderDeclaration,
  PlaybackChangeReason,
  MediaPreviewImage,
  MediaPreviewRequest,
  MediaPreviewProvider,
  PresentationMode,
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
import { createPlaybackSnapshot, updatePlaybackSnapshot } from './playback/snapshot'
import { normalizePlaybackRanges, type RawPlaybackRange } from './playback/ranges'
import { PreviewManager } from './playback/preview-manager'
import { NativePreviewController } from './native/preview'
import {
  runCandidateAttempts,
  type CandidateAttemptContext,
  type CandidateAttemptScope,
} from './playback/candidate-controller'
import {
  beginDecisionAttempt,
  closeDecisionTrace,
  createDecisionTrace,
  failDecisionAttempt,
  failDecisionTrace,
  selectDecisionAttempt,
} from './playback/decision-trace'

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
  /** Set while a WebGPU custom session is active; owns lazy stage construction. */
  let aiControl: {
    readonly reason: AiUnavailableReason | null
    readonly modelConfigured: boolean
    apply(request: AiPostProcessRequest): Promise<void>
  } | null = null
  let subtitleController: CoreSubtitleController | null = null
  let customPipelineReady = false
  let customRendererRequired = false
  let epoch = 0
  let closed = false
  let playbackSnapshot: PlaybackSnapshot = createPlaybackSnapshot(0)
  let currentDecisionTrace: PlaybackDecisionTrace | null = null
  let previewManager: PreviewManager | NativePreviewController | null = null
  let customPreviewProvider: MediaPreviewProvider | undefined
  let customPlayingIntent = false
  let customPlayedRanges: RawPlaybackRange[] = []
  let customLastTime: number | null = null
  let customSeeking = false
  let customBuffering = false
  let detachPresentationObserver: (() => void) | null = null
  const listeners = new Map<EngineEventName, Set<(payload: unknown) => void>>()

  const emit = <K extends EngineEventName>(event: K, payload: EngineEventMap[K]): void => {
    const eventListeners = listeners.get(event)
    if (!eventListeners) return
    for (const listener of [...eventListeners]) listener(payload)
  }

  const publishDecisionTrace = (trace: PlaybackDecisionTrace): void => {
    currentDecisionTrace = trace
    emit('decisionchange', { trace })
  }

  const setState = (next: PlaybackState): void => {
    if (currentState === next) return
    const previous = currentState
    currentState = next
    emit('statechange', { previous, current: next })
    commitPlayback({ state: next }, 'state')
  }

  const commitPlayback = (input: Parameters<typeof updatePlaybackSnapshot>[1], reason: PlaybackChangeReason): void => {
    const next = updatePlaybackSnapshot(playbackSnapshot, { ...input, sessionEpoch: epoch })
    playbackSnapshot = next
    emit('playbackchange', { snapshot: next, reason })
  }

  const aiStageOff = (reason: AiUnavailableReason): AiStageStatus => ({ enabled: false, available: false, unavailableReason: reason })

  /** What the UI needs in order to render, enable or grey out each AI toggle. */
  const aiStatus = (): AiPostProcessStatus => {
    const control = aiControl
    if (!control || control.reason !== null) {
      const reason = control?.reason ?? 'renderer-path'
      return { tier: 'off', interpolation: aiStageOff(reason), superResolution: aiStageOff(reason) }
    }
    return {
      tier: aiPipeline?.tier ?? 'off',
      // The RIFE stage is a placeholder: no executor runs its graph yet, so it is
      // reported as present but not switchable rather than shipping wrong frames.
      interpolation: aiStageOff('not-implemented'),
      superResolution: {
        enabled: aiPipeline?.superResolutionEnabled === true,
        available: control.modelConfigured,
        unavailableReason: control.modelConfigured ? null : 'model-unavailable',
      },
    }
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
    detachPresentationObserver?.()
    detachPresentationObserver = null
    previewManager?.close()
    previewManager = null
    customPreviewProvider = undefined
    subtitleController?.close()
    subtitleController = null
    renderLoop?.close()
    renderLoop = null
    aiPipeline?.close()
    aiPipeline = null
    aiControl = null
    activeRenderer?.close()
    activeRenderer = null
    probeReader?.close()
    probeReader = null
    activePipeline?.pipeline.close()
    activePipeline = null
    disposeCustomCanvas()
    disposeTarget()
    target = null
    customPlayingIntent = false
    customPlayedRanges = []
    customLastTime = null
    customSeeking = false
    customBuffering = false
    customPipelineReady = false
    customRendererRequired = false
  }

  const emitError = (error: EngineError): void => {
    if (closed) return
    setState('error')
    commitPlayback({ lastError: error, buffering: false, seeking: false }, 'error')
    emit('error', { error: publicEngineError(error) })
  }

  const syncNativePlayback = (reason: PlaybackChangeReason = 'time'): void => {
    if (activePipeline?.kind !== 'native') return
    const video = activePipeline.pipeline.video
    const duration = secondsToMicrosValue(video.duration)
    const currentTime = secondsToMicrosValue(video.currentTime)
    const played = normalizePlaybackRanges(video.played, duration)
    const buffered = normalizePlaybackRanges(video.buffered, duration)
    const features = activePipeline.pipeline.features
    const targetElement = target?.target
    const fullscreen = features.fullscreen || Boolean(targetElement && typeof targetElement.requestFullscreen === 'function')
    const buffering = playbackSnapshot.buffering && !video.paused && !video.ended && !video.seeking
    commitPlayback({
      state: currentState,
      paused: video.paused,
      currentTime,
      duration,
      played,
      buffered,
      bufferedAhead: computeSnapshotBufferedAhead(buffered, currentTime),
      volume: video.volume,
      muted: video.muted,
      playbackRate: video.playbackRate,
      seeking: video.seeking || currentState === 'seeking',
      buffering,
      capabilities: {
        seek: true,
        volume: true,
        playbackRate: true,
        fullscreen,
        pictureInPicture: features.pictureInPicture,
        preview: previewManager?.available === true,
      },
    }, reason)
  }

  const syncCustomPlayback = (reason: PlaybackChangeReason = 'time'): void => {
    if (activePipeline?.kind !== 'custom-video') return
    const pipeline = activePipeline.pipeline
    const clock = pipeline.audioClock
    const duration = currentMedia?.duration ?? null
    const currentTime = toMicrosValue(clock.mediaTime)
    if (currentTime !== null && customPlayingIntent) appendPlayedRange(customPlayedRanges, currentTime)
    const videoBuffered = pipeline.stats.bufferedDuration
    const audioBuffered = pipeline.audioStats?.bufferedDuration ?? 0
    const horizon = Math.max(0, videoBuffered, audioBuffered)
    const buffered = currentTime === null || horizon <= 0
      ? []
      : normalizePlaybackRanges([{ start: currentTime, end: duration === null ? currentTime + horizon : Math.min(duration, currentTime + horizon) }], duration)
    const targetElement = target?.target
    commitPlayback({
      state: currentState,
      paused: !customPlayingIntent,
      currentTime,
      duration,
      played: normalizePlaybackRanges(customPlayedRanges, duration),
      buffered,
      bufferedAhead: horizon,
      volume: pipeline.volume,
      muted: pipeline.muted,
      playbackRate: pipeline.playbackRate,
      seeking: customSeeking,
      buffering: customBuffering,
      capabilities: {
        seek: true,
        volume: true,
        playbackRate: true,
        fullscreen: Boolean(targetElement && typeof targetElement.requestFullscreen === 'function'),
        pictureInPicture: false,
        preview: previewManager?.available === true,
      },
      ai: aiStatus(),
    }, reason)
    customLastTime = currentTime
  }

  const syncPlayback = (reason: PlaybackChangeReason = 'time'): void => {
    if (activePipeline?.kind === 'native') syncNativePlayback(reason)
    else if (activePipeline?.kind === 'custom-video') syncCustomPlayback(reason)
    else commitPlayback({ state: currentState }, reason)
  }

  const observePresentation = (loadEpoch: number): void => {
    detachPresentationObserver?.()
    const currentTarget = target
    const doc = currentTarget?.target.ownerDocument
    if (!currentTarget || !doc || typeof doc.addEventListener !== 'function' || typeof doc.removeEventListener !== 'function') {
      detachPresentationObserver = null
      return
    }
    const update = (): void => {
      if (closed || loadEpoch !== epoch || target !== currentTarget) return
      const pipElement = (doc as Document & { pictureInPictureElement?: Element | null }).pictureInPictureElement ?? null
      const fullscreenElement = doc.fullscreenElement
      const mode: PresentationMode = pipElement !== null
        ? 'picture-in-picture'
        : fullscreenElement !== null
          ? 'fullscreen'
          : 'inline'
      commitPlayback({ presentationMode: mode }, 'presentation')
      syncPlayback('capabilities')
    }
    doc.addEventListener('fullscreenchange', update)
    detachPresentationObserver = (): void => doc.removeEventListener('fullscreenchange', update)
  }

  const handleNativeEvent = (event: NativePipelineEvent, loadEpoch: number): void => {
    if (closed || loadEpoch !== epoch || activePipeline?.kind !== 'native' || currentState === 'error') return
    switch (event.type) {
      case 'ready': {
        if (currentState === 'playing') break
        const wasReady = currentState === 'ready'
        setState('ready')
        if (!wasReady && currentSelection) emit('ready', { selection: currentSelection })
        syncNativePlayback('load')
        break
      }
      case 'playing': subtitleController?.play(); setState('playing'); commitPlayback({ buffering: false, paused: false }, 'state'); syncNativePlayback('state'); break
      case 'paused': subtitleController?.pause(); if (currentState !== 'ended') setState('paused'); commitPlayback({ buffering: false, paused: true }, 'state'); syncNativePlayback('state'); break
      case 'seeking': subtitleController?.seekStarted(); setState('seeking'); commitPlayback({ seeking: true }, 'state'); syncNativePlayback('state'); break
      case 'seeked': subtitleController?.seekCompleted(); setState(activePipeline.pipeline.video.paused ? 'ready' : 'playing'); commitPlayback({ seeking: false, buffering: false }, 'state'); syncNativePlayback('state'); break
      case 'buffering': commitPlayback({ buffering: !activePipeline.pipeline.video.paused && !activePipeline.pipeline.video.ended, bufferedAhead: event.bufferedAhead }, 'buffer'); emit('buffering', { bufferedAhead: event.bufferedAhead }); syncNativePlayback('buffer'); break
      case 'timeupdate': emit('timeupdate', { currentTime: event.currentTime, duration: event.duration }); syncNativePlayback('time'); break
      case 'propertychange': syncNativePlayback(event.property === 'rate' ? 'rate' : 'volume'); break
      case 'presentationchange': commitPlayback({ presentationMode: event.mode }, 'presentation'); syncNativePlayback('presentation'); break
      case 'ended': subtitleController?.ended(); setState('ended'); commitPlayback({ buffering: false, seeking: false, paused: true }, 'state'); syncNativePlayback('state'); break
      case 'error': emitError(event.error); break
      case 'loading': if (currentState !== 'closed') setState('loading'); syncNativePlayback('state'); break
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
      case 'playing': customPlayingIntent = true; customBuffering = false; customSeeking = false; renderLoop?.start(); subtitleController?.play(); setState('playing'); syncCustomPlayback('state'); break
      case 'paused': customPlayingIntent = false; customBuffering = false; renderLoop?.pause(); subtitleController?.pause(); if (currentState !== 'ended') setState('paused'); syncCustomPlayback('state'); break
      case 'seeking': customSeeking = true; customBuffering = false; renderLoop?.stop(true); aiPipeline?.reset(activePipeline.pipeline.epoch); subtitleController?.seekStarted(); setState('seeking'); syncCustomPlayback('state'); break
      case 'seeked': customSeeking = false; customBuffering = false; if (event.resume === 'playing') { customPlayingIntent = true; renderLoop?.start() } else customPlayingIntent = false; subtitleController?.seekCompleted(); setState(event.resume); syncCustomPlayback('state'); break
      case 'frameavailable': emit('frameavailable', { queuedFrames: event.queuedFrames, bufferedDuration: event.bufferedDuration }); syncCustomPlayback('buffer'); break
      case 'audiostatechange': emit('audiostatechange', { state: event.stats.outputState, stats: event.stats }); break
      case 'audiounderrun': emit('audiounderrun', { count: event.stats.underruns, bufferedDuration: event.stats.bufferedDuration }); break
      case 'clockupdate': subtitleController?.clockUpdate(); emit('clockupdate', { clock: event.clock }); syncCustomPlayback('time'); break
      case 'buffering': customBuffering = customPlayingIntent; emit('buffering', { bufferedAhead: event.bufferedAhead }); syncCustomPlayback('buffer'); break
      case 'ended': customPlayingIntent = false; customBuffering = false; customSeeking = false; renderLoop?.stop(true); subtitleController?.ended(); setState('ended'); syncCustomPlayback('state'); break
      case 'error': emitError(event.error); break
    }
  }

  const publishCustomReady = (): void => {
    if (!customPipelineReady || (customRendererRequired && activeRenderer?.state !== 'ready')) return
    const wasReady = currentState === 'ready'
    setState('ready')
    if (!wasReady && currentSelection) emit('ready', { selection: currentSelection })
    syncCustomPlayback('load')
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
      return currentSelection !== null && activePipeline?.kind === 'native' ? activePipeline.pipeline.features : null
    },
    get nativeStats(): NativePlaybackStats | null {
      return currentSelection !== null && activePipeline?.kind === 'native' ? activePipeline.pipeline.stats : null
    },
    get customVideoStats(): CustomVideoStats | null {
      return currentSelection !== null && activePipeline?.kind === 'custom-video' ? activePipeline.pipeline.stats : null
    },
    get customAudioStats(): CustomAudioStats | null {
      return currentSelection !== null && activePipeline?.kind === 'custom-video' ? activePipeline.pipeline.audioStats : null
    },
    get audioClock(): AudioClockSnapshot | null {
      return currentSelection !== null && activePipeline?.kind === 'custom-video' ? activePipeline.pipeline.audioClock : null
    },
    get rendererKind(): CustomRendererKind | null { return currentSelection !== null && activePipeline?.kind === 'custom-video' ? activeRenderer?.kind ?? null : null },
    get rendererState(): RendererState | null { return currentSelection !== null && activePipeline?.kind === 'custom-video' ? activeRenderer?.state ?? null : null },
    get rendererStats(): RendererStats | null { return currentSelection !== null && activePipeline?.kind === 'custom-video' ? activeRenderer?.stats ?? null : null },
    get subtitleTracks(): readonly SubtitleTrack[] { return subtitleController?.tracks ?? [] },
    get selectedSubtitleTrack(): string | null { return subtitleController?.selectedTrackId ?? null },
    get subtitleState(): SubtitleState { return subtitleController?.state ?? 'disabled' },
    get subtitleStyle(): SubtitleCueStyle { return subtitleController?.style ?? { ...DEFAULT_SUBTITLE_STYLE } },
    get playback(): PlaybackSnapshot { return playbackSnapshot },
    get decisionTrace(): PlaybackDecisionTrace | null { return currentDecisionTrace },

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
      currentDecisionTrace = null
      customPipelineReady = false
      customRendererRequired = false
      playbackSnapshot = createPlaybackSnapshot(loadEpoch)
      commitPlayback({ state: 'loading', lastError: null }, 'load')
      setState('loading')
      const requestedIntent = options.intent ?? 'normal'
      const filterEnabled = options.customVideo?.filter !== undefined && options.customVideo.filter.kind !== 'none'
      const intent = filterEnabled && (requestedIntent === 'normal' || requestedIntent === 'low-power') ? 'filters' : requestedIntent

      try {
        target = resolveVideoTarget(options.target)
        validateSource(options.source)
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
        currentMedia = media
        const capabilities = await detectCapabilities({ includeWasm: false })
        const report = await probeMediaCapabilities(media, { snapshot: capabilities })
        const wasmSession = createWasmSession(options.wasmBaseUrl)
        const context = createCapabilityContext(capabilities, report, wasmSession?.declarations)
        emit('capabilities', { context })
        const policy = createPlatformPolicy(capabilities)
        const strategy = createStrategyEngine(policy)
        const evaluation = typeof strategy.evaluate === 'function'
          ? strategy.evaluate(media, intent, context)
          : legacyStrategyEvaluation(strategy.select(media, intent, context))
        publishDecisionTrace(createDecisionTrace(evaluation, media, intent, loadEpoch, Date.now()))
        if (evaluation.rankedCandidates.length === 0) {
          throw createEngineError(ErrorCodes.STRATEGY_NO_VIABLE_BACKEND, 'No verified playback candidate is available', false)
        }

        const result = await runCandidateAttempts<{
          readonly selection: PlaybackSelection
          activate(): void
        }>({
          candidates: evaluation.rankedCandidates,
          isSessionActive: () => !closed && loadEpoch === epoch,
          createInactiveError: () => loadAborted(intent),
          getErrorCode: (cause, candidate) => candidateErrorCode(cause, candidate),
          isRecoverable: (cause) => isCandidateInitializationRecoverable(cause),
          onAttempt: (attempt) => {
            const candidate = evaluation.rankedCandidates[attempt.index]
            const trace = currentDecisionTrace
            if (!candidate || !trace || trace.sessionEpoch !== loadEpoch) return
            const next = attempt.status === 'initializing'
              ? beginDecisionAttempt(trace, candidate, attempt.index, Date.now())
              : attempt.status === 'failed'
                ? failDecisionAttempt(trace, candidate, attempt.index, attempt.errorCode ?? ErrorCodes.CUSTOM_OPERATION_FAILED, Date.now())
                : selectDecisionAttempt(trace, candidate, attempt.index, Date.now())
            publishDecisionTrace(next)
          },
          createScope: (candidate, attemptContext): CandidateAttemptScope<{
            readonly selection: PlaybackSelection
            activate(): void
          }> => createCandidateScope(candidate, attemptContext),
        })

        result.value.activate()
        if (!target) throw createEngineError(ErrorCodes.ENGINE_INVALID_TARGET, 'Subtitle target is unavailable', false)
        if (activePipeline?.kind === 'native') {
          await setupSubtitles(options.source, media, loadEpoch, target, target.video, null, options.subtitles)
          if (options.autoplay === true) {
            try { await activePipeline.pipeline.play() } catch (cause) {
              const error = toEngineError(cause, ErrorCodes.NATIVE_AUTOPLAY_BLOCKED, 'Autoplay was blocked by the browser')
              if (error.code === ErrorCodes.NATIVE_OPERATION_FAILED) {
                throw createEngineError(ErrorCodes.NATIVE_AUTOPLAY_BLOCKED, 'Autoplay was blocked by the browser', true, cause)
              }
              throw error
            }
          }
        } else if (activePipeline?.kind === 'custom-video') {
          await setupSubtitles(options.source, media, loadEpoch, target, customCanvas?.canvas ?? null, activeRenderer?.kind ?? null, options.subtitles)
          if (loadEpoch !== epoch || closed) throw loadAborted(intent)
          if (options.autoplay === true) await activePipeline.pipeline.play()
        }
        return

        function createCandidateScope(
          candidate: Readonly<BackendCandidate>,
          attemptContext: CandidateAttemptContext,
        ): CandidateAttemptScope<{ readonly selection: PlaybackSelection; activate(): void }> {
          let candidateCapabilities = capabilities
          let playbackSelection = selectionForCandidate(candidate, intent, candidateCapabilities, report, evaluation.selection)
          const bufferedEvents: Array<() => void> = []
          let committed = false
          let activated = false
          const dispatch = (callback: () => void): void => {
            if (activated) callback()
            else if (attemptContext.isActive() || committed) bufferedEvents.push(callback)
          }
          return {
            async initialize(): Promise<void> {
              if (!target) target = resolveVideoTarget(options.target)
              if (candidate.kind === 'html-video') {
                if (intent !== 'normal' && intent !== 'low-power') {
                  throw createEngineError(ErrorCodes.NATIVE_BACKEND_UNAVAILABLE, 'The native backend cannot provide frame access', true)
                }
                if (options.source.kind === 'url' && options.source.headers && Object.keys(options.source.headers).length > 0) {
                  throw createEngineError(ErrorCodes.NATIVE_CUSTOM_HEADERS_UNSUPPORTED, 'Custom headers cannot be sent by an HTML video element', true)
                }
                const contentType = report.native.video.contentType ?? report.native.audio.contentType
                if (report.native.playable !== 'supported' || !contentType) {
                  throw createEngineError(ErrorCodes.NATIVE_NOT_SUPPORTED, 'The media is not supported by the native video path', true)
                }
                if (!target.video) throw createEngineError(ErrorCodes.ENGINE_INVALID_TARGET, 'Native playback requires a video element or container target', false)
                const nativePipeline = new NativeMediaPipeline(target.video, {
                  isActive: () => !closed && loadEpoch === epoch && (attemptContext.isActive() || committed),
                  onEvent: (event) => dispatch(() => handleNativeEvent(event, loadEpoch)),
                })
                activePipeline = { kind: 'native', pipeline: nativePipeline }
                await nativePipeline.load(options.source, contentType, options.native)
                if (!attemptContext.isActive()) throw loadAborted(intent)
                previewManager = new NativePreviewController({
                  source: options.source,
                  contentType,
                  ...(options.native === undefined ? {} : { native: options.native }),
                  epoch: loadEpoch,
                  duration: media.duration,
                  ownerDocument: target.target.ownerDocument ?? null,
                })
                return
              }

              if (candidate.kind !== 'webcodecs' && candidate.kind !== 'wasm') {
                throw createEngineError(ErrorCodes.CUSTOM_BACKEND_UNAVAILABLE, `The ${candidate.kind} backend has no Core adapter`, true)
              }
              const isWasmCandidate = candidate.kind === 'wasm'
              if (isWasmCandidate) {
                candidateCapabilities = await detectWasmCapabilities(capabilities)
                if (!attemptContext.isActive()) throw loadAborted(intent)
                playbackSelection = selectionForCandidate(candidate, intent, candidateCapabilities, report, evaluation.selection)
              }
              const shouldCreateRenderer = dependencies.createRenderer !== undefined || dependencies.createCustomPipeline === undefined
              if ((intent === 'normal' || intent === 'low-power') && !shouldCreateRenderer) {
                throw createEngineError(ErrorCodes.CUSTOM_BACKEND_UNAVAILABLE, 'The selected custom path cannot provide complete playback without a renderer', true)
              }
              if (!isWasmCandidate && (!capabilities.webCodecsVideo || report.webCodecs.video.status !== 'supported' || !report.query.video)) {
                throw createEngineError(ErrorCodes.WEBCODECS_NOT_SUPPORTED, 'The selected video configuration is not supported by WebCodecs', true)
              }
              const hasAudioTrack = media.tracks.some((track) => track.kind === 'audio')
              if (isWasmCandidate && hasAudioTrack) {
                throw createEngineError(ErrorCodes.CUSTOM_AUDIO_BACKEND_UNAVAILABLE, 'Phase 10.2 WASM playback does not provide an audio decoder', true)
              }
              if (!isWasmCandidate && hasAudioTrack && (!capabilities.webCodecsAudio || report.webCodecs.audio.status !== 'supported' || !report.query.audio)) {
                throw createEngineError(ErrorCodes.CUSTOM_AUDIO_BACKEND_UNAVAILABLE, 'The selected audio configuration is not supported by WebCodecs', true)
              }
              const wasmTrack = isWasmCandidate ? selectedWasmVideoTrack(media.tracks, candidate.videoCodec, wasmSession) : null
              if (isWasmCandidate && (!wasmSession || !wasmTrack)) {
                throw createEngineError(ErrorCodes.CUSTOM_BACKEND_UNAVAILABLE, 'The selected WASM decoder is unavailable for this video track', true)
              }
              releaseUnusedOwnedVideo()
              customRendererRequired = shouldCreateRenderer
              if (shouldCreateRenderer) customCanvas = createCustomCanvasTarget(target)
              customPreviewProvider = options.preview?.provider
              previewManager = new PreviewManager({
                epoch: loadEpoch,
                duration: media.duration,
                ...(customPreviewProvider === undefined ? {} : { provider: customPreviewProvider }),
              })
              if (intent === 'ai-enhance' && playbackSelection.aiPlan?.proposedTier === 'off') {
                dispatch(() => emit('error', { error: { code: ErrorCodes.RENDERER_AI_UNSUPPORTED, message: 'AI post-processing is unavailable; continuing with passthrough', recoverable: true } }))
              }
              const pipelineOptions: CustomMediaPipelineOptions = {
                source: options.source,
                media,
                capabilityReport: report,
                capabilities: candidateCapabilities,
                ...(options.customVideo === undefined ? {} : { customVideo: options.customVideo }),
                ...(options.customAudio === undefined ? {} : { customAudio: options.customAudio }),
                callbacks: {
                  isActive: () => !closed && loadEpoch === epoch && (attemptContext.isActive() || committed),
                  onEvent: (event) => dispatch(() => handleCustomEvent(event, loadEpoch)),
                },
                ...(wasmSession === null || wasmTrack === null ? {} : {
                  dependencies: {
                    decoderConfig: createLibvpxVp8VideoDecoderConfig(wasmTrack),
                    decoderConfigSupported: true,
                    createDecoder: (callbacks) => new WorkerLibvpxVp8DecoderAdapter({
                      callbacks,
                      baseUrl: wasmSession.baseUrl,
                      track: wasmTrack,
                      capabilities: candidateCapabilities,
                    }),
                  },
                }),
              }
              const customPipeline = dependencies.createCustomPipeline?.(pipelineOptions) ?? new CustomMediaPipeline(pipelineOptions)
              activePipeline = { kind: 'custom-video', pipeline: customPipeline }
              await customPipeline.initialize()
              if (shouldCreateRenderer && customCanvas) {
                const rendererOptions: RendererFactoryOptions = {
                  capabilities: candidateCapabilities,
                  ...(options.customVideo?.renderer === undefined ? {} : { preference: options.customVideo.renderer }),
                  ...(options.customVideo?.filter === undefined ? {} : { filter: options.customVideo.filter }),
                  ...(options.customVideo?.render === undefined ? {} : { transform: options.customVideo.render }),
                  ...(options.customVideo?.preserveHdr === undefined ? {} : { preserveHdr: options.customVideo.preserveHdr }),
                  onEvent: (event) => dispatch(() => handleRendererEvent(event, loadEpoch)),
                }
                activeRenderer = dependencies.createRenderer?.(rendererOptions)
                  ?? createRenderer(options.customVideo?.renderer ?? 'auto', rendererOptions)
                await activeRenderer.attach(customCanvas.canvas)
                const renderer = activeRenderer
                const rendererDevice = renderer.kind === 'webgpu' ? renderer.device : null
                const rendererDevice2 = rendererDevice
                const decodedSource = 'decodedFrameSource' in customPipeline ? customPipeline.decodedFrameSource : null
                const softwareGpu = capabilities.webGpuFeatures.isFallbackAdapter === true
                const capabilityReason: AiUnavailableReason | null = !rendererDevice2 || !decodedSource
                  ? 'renderer-path'
                  : softwareGpu ? 'device-capability' : null
                let rt4kSrModel: ReturnType<typeof parseMxai> | undefined

                const loadSuperResolutionModel = async (): Promise<ReturnType<typeof parseMxai>> => {
                  if (rt4kSrModel) return rt4kSrModel
                  if (options.aiModelBaseUrl === undefined) {
                    throw createEngineError(ErrorCodes.RENDERER_AI_MODEL_LOAD_FAILED, 'No aiModelBaseUrl is configured for AI post-processing', true)
                  }
                  try {
                    const asset = await loadAiModelAsset(RT4KSR_X2_MANIFEST, 'f32', { baseUrl: options.aiModelBaseUrl })
                    rt4kSrModel = parseMxai(asset.bytes)
                    return rt4kSrModel
                  } catch (cause) {
                    throw createEngineError(aiModelErrorCode(cause), 'RT4KSR model load failed', true, cause)
                  }
                }

                const applyAiRequest = async (request: AiPostProcessRequest): Promise<void> => {
                  if (capabilityReason !== null || !rendererDevice2 || !decodedSource) {
                    throw createEngineError(ErrorCodes.RENDERER_AI_UNSUPPORTED, 'AI post-processing is unavailable for this session', true)
                  }
                  if (request.interpolation === true) {
                    throw createEngineError(ErrorCodes.RENDERER_AI_UNSUPPORTED, 'AI frame interpolation has no verified implementation yet', true)
                  }
                  if (aiPipeline) {
                    aiPipeline.setStages(request)
                    return
                  }
                  if (request.superResolution !== true) return
                  const model = await loadSuperResolutionModel()
                  const superResolution = new WebGpuSuperResolutionStage({ device: rendererDevice2, model })
                  try {
                    aiPipeline = new AiPipeline({
                      upstream: decodedSource,
                      superResolution,
                      initialTier: playbackSelection.aiPlan?.proposedTier ?? 'medium',
                      ...(options.aiPostProcess?.maxTier === undefined ? {} : { maxTier: options.aiPostProcess.maxTier }),
                      onEvent: (event) => dispatch(() => handleAiEvent(event, loadEpoch)),
                    })
                  } catch (cause) {
                    superResolution.close()
                    throw createEngineError(ErrorCodes.RENDERER_AI_PIPELINE_FAILED, 'The AI post-processing pipeline could not be created', true, cause)
                  }
                }

                aiControl = { reason: capabilityReason, modelConfigured: options.aiModelBaseUrl !== undefined, apply: applyAiRequest }

                if (intent === 'ai-enhance' && capabilityReason === null && options.aiPostProcess?.superResolution !== 'off'
                  && playbackSelection.aiPlan?.superResolution !== false) {
                  // Requested up front: build the stage now so the first frame is enhanced.
                  try {
                    await applyAiRequest({ superResolution: true })
                  } catch (cause) {
                    const error = toEngineError(cause, ErrorCodes.RENDERER_AI_PIPELINE_FAILED, 'AI post-processing could not start')
                    dispatch(() => emit('error', { error: { code: error.code, message: error.message, recoverable: true } }))
                  }
                }
                renderLoop = new CustomRenderLoop({
                  readVideoFrame: () => customPipeline.readVideoFrame(),
                  ...(aiControl?.reason !== null ? {} : {
                    readRenderableFrame: async (): Promise<CustomRenderableFrame | null> => {
                      const active = aiPipeline
                      if (!active) {
                        const decoded = await customPipeline.readVideoFrame()
                        return decoded === null ? null : { kind: 'video', frame: decoded }
                      }
                      const clock = customPipeline.audioClock
                      const processed = await active.frameAt(clock.mediaTime, clock.epoch)
                      if (!processed) return null
                      const detached = customPipeline.consumeFramesThrough(processed.timestamp)
                      if (processed.location === 'cpu') {
                        const delivered = detached.find((value) => value.frame === processed.frame)
                        for (const value of detached) if (value !== delivered) safeCloseVideoFrame(value.frame)
                        if (!delivered) { safeCloseVideoFrame(processed.frame); return null }
                        return { kind: 'video', frame: delivered }
                      }
                      for (const value of detached) safeCloseVideoFrame(value.frame)
                      return { kind: 'gpu', frame: { ...processed, epoch: clock.epoch } }
                    },
                  }),
                  getClock: () => customPipeline.audioClock,
                  renderer,
                  isActive: () => !closed && loadEpoch === epoch && activePipeline?.kind === 'custom-video',
                  onError: (error) => dispatch(() => handleRendererEvent({ type: 'error', kind: renderer.kind, error }, loadEpoch)),
                })
              }
            },
            commit() {
              currentSelection = playbackSelection
              committed = true
              return {
                selection: playbackSelection,
                activate(): void {
                  if (activated) return
                  activated = true
                  observePresentation(loadEpoch)
                  emit('backendchange', { previous: previousSelection, current: playbackSelection.backend, reason: 'strategy-selection' })
                  for (const event of bufferedEvents.splice(0)) event()
                  if (activePipeline?.kind === 'custom-video') publishCustomReady()
                },
              }
            },
            dispose(): void { disposePipeline() },
          }
        }
      } catch (cause) {
        if (loadEpoch !== epoch || closed) throw loadAborted(intent, cause)
        const error = mapLoadError(cause, intent)
        const traceAtFailure = currentDecisionTrace as PlaybackDecisionTrace | null
        if (traceAtFailure?.sessionEpoch === loadEpoch && traceAtFailure.status !== 'selected') {
          publishDecisionTrace(failDecisionTrace(traceAtFailure, error.code, Date.now()))
        }
        if (error.code === ErrorCodes.NATIVE_AUTOPLAY_BLOCKED || error.code === ErrorCodes.AUDIO_AUTOPLAY_BLOCKED) {
          if (currentState !== 'ready') setState('ready')
          emit('error', { error: publicEngineError(error) })
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
      syncPlayback('rate')
    },

    setVolume(volume: number): void {
      ensureOpen()
      if (!activePipeline) throw createEngineError(ErrorCodes.NATIVE_OPERATION_FAILED, 'No media is loaded', true)
      activePipeline.pipeline.setVolume(volume)
      syncPlayback('volume')
    },

    setMuted(muted: boolean): void {
      ensureOpen()
      if (!activePipeline) throw createEngineError(ErrorCodes.NATIVE_OPERATION_FAILED, 'No media is loaded', true)
      activePipeline.pipeline.setMuted(muted)
      syncPlayback('volume')
    },

    async setAiPostProcess(request: AiPostProcessRequest): Promise<void> {
      ensureOpen()
      const control = aiControl
      if (activePipeline?.kind !== 'custom-video' || !control) {
        throw createEngineError(ErrorCodes.RENDERER_AI_UNSUPPORTED, 'AI post-processing requires an active WebGPU custom session', true)
      }
      await control.apply(request)
      syncCustomPlayback('ai')
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

    requestPreview(request: MediaPreviewRequest): Promise<MediaPreviewImage | null> {
      try { ensureOpen() } catch (cause) { return Promise.reject(cause) }
      if (!previewManager) return Promise.resolve(null)
      return previewManager.request(request)
    },

    async requestFullscreen(): Promise<void> {
      ensureOpen()
      if (!target) throw createEngineError(ErrorCodes.NATIVE_FULLSCREEN_UNSUPPORTED, 'Fullscreen requires an active playback target', true)
      if (activePipeline?.kind === 'native') {
        await activePipeline.pipeline.requestFullscreen(target.container ?? subtitleController?.fullscreenHost ?? undefined)
      } else {
        const element = target.target
        const fullscreenEnabled = element.ownerDocument?.fullscreenEnabled === true
        if (!fullscreenEnabled || typeof element.requestFullscreen !== 'function') throw createEngineError(ErrorCodes.NATIVE_FULLSCREEN_UNSUPPORTED, 'Fullscreen is not supported by the playback host', true)
        try { await Promise.resolve(element.requestFullscreen()) } catch (cause) { throw createEngineError(ErrorCodes.NATIVE_FULLSCREEN_BLOCKED, 'Fullscreen was blocked by the browser', true, cause) }
      }
      commitPlayback({ presentationMode: 'fullscreen' }, 'presentation')
    },

    async exitFullscreen(): Promise<void> {
      ensureOpen()
      if (activePipeline?.kind === 'native') await activePipeline.pipeline.exitFullscreen()
      else {
        const doc = target?.target.ownerDocument ?? (typeof document === 'undefined' ? null : document)
        if (!doc || typeof doc.exitFullscreen !== 'function') throw createEngineError(ErrorCodes.NATIVE_FULLSCREEN_UNSUPPORTED, 'Fullscreen is not supported by this document', true)
        await Promise.resolve(doc.exitFullscreen())
      }
      commitPlayback({ presentationMode: 'inline' }, 'presentation')
    },

    async requestPictureInPicture(): Promise<void> {
      ensureOpen()
      if (activePipeline?.kind !== 'native') throw createEngineError(ErrorCodes.NATIVE_PIP_UNSUPPORTED, 'Picture-in-Picture requires a native video element or a later custom renderer', true)
      await activePipeline.pipeline.requestPictureInPicture()
      commitPlayback({ presentationMode: 'picture-in-picture' }, 'presentation')
    },

    async exitPictureInPicture(): Promise<void> {
      ensureOpen()
      if (activePipeline?.kind !== 'native') throw createEngineError(ErrorCodes.NATIVE_PIP_UNSUPPORTED, 'Picture-in-Picture requires a native video element or a later custom renderer', true)
      await activePipeline.pipeline.exitPictureInPicture()
      commitPlayback({ presentationMode: 'inline' }, 'presentation')
    },

    close(): void {
      if (closed) return
      closed = true
      ++epoch
      if (currentDecisionTrace) publishDecisionTrace(closeDecisionTrace(currentDecisionTrace, Date.now()))
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
      canvas.style.display = 'block'
      canvas.style.width = '100%'
      canvas.style.height = '100%'
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

function toMicrosValue(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value) || value < 0) return null
  const micros = Math.round(value)
  return Number.isSafeInteger(micros) && micros >= 0 ? micros : null
}

function secondsToMicrosValue(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value) || value < 0) return null
  return toMicrosValue(value * 1_000_000)
}

function computeSnapshotBufferedAhead(
  ranges: readonly { start: number; end: number }[],
  currentTime: number | null,
): number {
  if (currentTime === null) return 0
  for (const range of ranges) if (currentTime >= range.start && currentTime <= range.end) return Math.max(0, range.end - currentTime)
  return 0
}

function appendPlayedRange(ranges: RawPlaybackRange[], currentTime: number): void {
  const previous = ranges[ranges.length - 1]
  if (!previous) {
    ranges.push({ start: currentTime, end: currentTime })
    return
  }
  const lower = Math.min(previous.end, currentTime)
  const upper = Math.max(previous.end, currentTime)
  if (upper - lower <= 2_000_000) {
    previous.end = upper
    previous.start = Math.min(previous.start, lower)
  } else {
    ranges.push({ start: currentTime, end: currentTime })
  }
  if (ranges.length > 96) ranges.splice(0, ranges.length - 96)
}

function legacyStrategyEvaluation(selection: PlaybackSelection): StrategyEvaluation {
  const candidate = cloneBackendCandidate(selection.backend)
  return {
    baseCandidates: [cloneBackendCandidate(candidate)],
    adjustments: [],
    rankedCandidates: [candidate],
    selection,
  }
}

function selectionForCandidate(
  candidate: Readonly<BackendCandidate>,
  intent: PlaybackSelection['intent'],
  capabilities: PlaybackSelection['capabilities'],
  mediaCapabilities: PlaybackSelection['mediaCapabilities'],
  template: PlaybackSelection | null,
): PlaybackSelection {
  const selection: PlaybackSelection = {
    backend: cloneBackendCandidate(candidate),
    intent,
    capabilities,
    mediaCapabilities,
  }
  if (template?.aiPlan) {
    selection.aiPlan = {
      interpolation: template.aiPlan.interpolation,
      superResolution: template.aiPlan.superResolution,
      proposedTier: template.aiPlan.proposedTier,
      reasons: [...template.aiPlan.reasons],
    }
  }
  return selection
}

function cloneBackendCandidate(candidate: Readonly<BackendCandidate>): BackendCandidate {
  return {
    ...candidate,
    reasons: [...candidate.reasons],
    requires: [...candidate.requires],
  }
}

interface WasmSession {
  readonly baseUrl: string
  readonly declarations: readonly WasmDecoderDeclaration[]
  supportsVideo(codec: string, track: TrackInfo): boolean
}

function createWasmSession(baseUrl: string | undefined): WasmSession | null {
  if (baseUrl === undefined) return null
  const marker = '__mx_player_max_wasm_base__.wasm'
  const resolvedMarker = resolveWasmAssetUrl(baseUrl, marker)
  const normalizedBaseUrl = resolvedMarker.slice(0, -marker.length)
  const plugin = createLibvpxVp8Plugin()
  const registry = createWasmDecoderRegistry([plugin])
  return {
    baseUrl: normalizedBaseUrl,
    declarations: registry.declarations(),
    supportsVideo: (codec, track) => plugin.supports(codec, track),
  }
}

function selectedWasmVideoTrack(
  tracks: readonly TrackInfo[],
  codec: string | null,
  session?: WasmSession | null,
): TrackInfo | null {
  if (codec === null || !session) return null
  return tracks.find((track) => track.kind === 'video' && session.supportsVideo(codec, track)) ?? null
}

function candidateErrorCode(cause: unknown, candidate: Readonly<BackendCandidate>): string {
  if (isEngineError(cause)) return cause.code
  return candidate.kind === 'html-video' ? ErrorCodes.NATIVE_OPERATION_FAILED : ErrorCodes.CUSTOM_OPERATION_FAILED
}

function isCandidateInitializationRecoverable(cause: unknown): boolean {
  if (!isEngineError(cause)) return true
  return cause.code !== ErrorCodes.ENGINE_CLOSED
    && cause.code !== ErrorCodes.ENGINE_INVALID_TARGET
    && cause.code !== ErrorCodes.NATIVE_SOURCE_INVALID
    && cause.code !== ErrorCodes.NATIVE_ABORTED
    && cause.code !== ErrorCodes.WEBCODECS_ABORTED
    && cause.code !== ErrorCodes.WASM_ABORTED
}

function mapLoadError(cause: unknown, intent: MXPlayerOptions['intent']): EngineErrorException {
  const customIntent = intent !== undefined && intent !== 'normal' && intent !== 'low-power'
  const code = typeof cause === 'object' && cause !== null && 'code' in cause ? String((cause as { code?: unknown }).code) : ''
  if (isEngineError(cause) && (customIntent || code.startsWith('CUSTOM_') || code.startsWith('WEBCODECS_') || code.startsWith('WASM_') || code.startsWith('AUDIO_') || code.startsWith('RENDERER_'))) return cause as EngineErrorException
  if (code === ErrorCodes.RANGE_CORS_FAILED) return createEngineError(ErrorCodes.NATIVE_CORS_FAILED, 'The remote media failed CORS validation', true, cause)
  if (code === ErrorCodes.RANGE_NETWORK_FAILED) return createEngineError(ErrorCodes.NATIVE_NETWORK_FAILED, 'The remote media network request failed', true, cause)
  if (code === ErrorCodes.RANGE_ABORTED) return createEngineError(ErrorCodes.NATIVE_ABORTED, 'The media load was aborted', true, cause)
  if (code === ErrorCodes.STRATEGY_NO_VIABLE_BACKEND) {
    return customIntent
      ? createEngineError(ErrorCodes.CUSTOM_BACKEND_UNAVAILABLE, 'The media has no supported WebCodecs frame-access path', false, cause)
      : createEngineError(ErrorCodes.NATIVE_NOT_SUPPORTED, 'The media has no supported native playback path', false, cause)
  }
  if (code === ErrorCodes.CONTAINER_UNSUPPORTED) return createEngineError(ErrorCodes.NATIVE_NOT_SUPPORTED, 'The media container is not supported', false, cause)
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

function publicEngineError(error: EngineError): EngineError {
  return { code: error.code, message: error.message, recoverable: error.recoverable }
}
