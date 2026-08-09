import { createRangeLoader, probeContainer } from '@mx-player-max/demux'
import type { ResolvedVideoTarget } from './native/target'
import type {
  AudioClockSnapshot,
  CustomRendererKind,
  DemuxPacket,
  MediaDescriptor,
  SourceDescriptor,
  SubtitleCueStyle,
  SubtitleOptions,
  SubtitleState,
  SubtitleTrack,
} from '@mx-player-max/types'
import { ErrorCodes } from '@mx-player-max/types'
import {
  CallbackSubtitleClock,
  NativeSubtitleClock,
  SubtitleOverlay,
  SubtitleTrackManager,
  parseEmbeddedSubtitlePackets,
  loadExternalSubtitle,
  subtitleStyleScope,
  type SubtitleClock,
  type SubtitleManagerEvent as ManagerEvent,
  type SubtitleOverlayTargetKind,
  type SubtitleTrackDefinition,
  type SubtitleTrackLoaderRequest,
  type SubtitleTrackLoader,
} from '@mx-player-max/subtitles'
import { SubtitleError } from '@mx-player-max/subtitles'

export interface CoreSubtitleControllerOptions {
  source: SourceDescriptor
  media: MediaDescriptor
  target: ResolvedVideoTarget
  surface: HTMLVideoElement | HTMLCanvasElement | null
  rendererKind: CustomRendererKind | null
  subtitleOptions?: SubtitleOptions
  getCustomClock?: () => AudioClockSnapshot | null
  getCustomPlaying?: () => boolean
  onEvent: (event: ManagerEvent) => void
}

export class CoreSubtitleController {
  readonly #source: SourceDescriptor
  readonly #options: SubtitleOptions
  readonly #clock: SubtitleClock
  readonly #callbackClock: CallbackSubtitleClock | null
  readonly #overlay: SubtitleOverlay
  readonly #manager: SubtitleTrackManager
  readonly #defaultHost: HTMLElement | null
  readonly #targetKind: SubtitleOverlayTargetKind
  readonly #embeddedTracks = new Map<number, { format: import('@mx-player-max/types').SubtitleFormat; track: import('@mx-player-max/types').TrackInfo }>()
  #closed = false

  constructor(options: CoreSubtitleControllerOptions) {
    this.#source = options.source
    this.#options = options.subtitleOptions ?? {}
    const surface = options.surface
    if ((typeof HTMLVideoElement !== 'undefined' && surface instanceof HTMLVideoElement) || isVideoLike(surface)) {
      this.#clock = new NativeSubtitleClock(surface as HTMLVideoElement)
      this.#callbackClock = null
      this.#targetKind = 'native-video'
    } else {
      const callbackClock = new CallbackSubtitleClock(() => {
        const value = options.getCustomClock?.()
        return toSubtitleClockSnapshot(value ?? null, options.getCustomPlaying?.() ?? false, this.#manager?.epoch ?? 0)
      })
      this.#clock = callbackClock
      this.#callbackClock = callbackClock
      this.#targetKind = rendererTargetKind(options.rendererKind)
    }
    this.#overlay = new SubtitleOverlay({ onError: (error) => options.onEvent({ type: 'warning', trackId: null, diagnostic: { code: error.code, severity: 'warning', message: error.message } }) })
    const definitions: SubtitleTrackDefinition[] = []
    for (const track of options.media.tracks) {
      if (track.kind !== 'subtitle') continue
      const format = formatForTrack(track)
      if (format === null) continue
      const id = `embedded-${track.id}`
      this.#embeddedTracks.set(track.id, { format, track })
      definitions.push({
        id,
        source: { kind: 'embedded', trackId: track.id, format },
        format,
        ...(track.language === undefined ? {} : { language: track.language }),
        ...(track.name === undefined ? {} : { name: track.name }),
      })
    }
    const host = this.resolveHost(options.target, surface, this.#options.overlayHost)
    this.#defaultHost = host
    this.#manager = new SubtitleTrackManager({
      tracks: definitions,
      clock: this.#clock,
      overlay: this.#overlay,
      ...(this.#options.styleStore === undefined ? {} : { styleStore: this.#options.styleStore }),
      styleScope: subtitleStyleScope(this.#source),
      ...(this.#options.parserLimits === undefined ? {} : { parserLimits: this.#options.parserLimits }),
      ...(this.#options.sourceLimits === undefined ? {} : { sourceLimits: this.#options.sourceLimits }),
      loadTrack: this.createLoader(),
      onEvent: options.onEvent,
    })
    if (this.#options.enabled !== false) {
      if (host !== null) {
        try { this.#manager.attachOverlay(host, this.#targetKind) } catch { /* overlay must not interrupt media playback */ }
      } else {
        options.onEvent({
          type: 'warning',
          trackId: null,
          diagnostic: {
            code: ErrorCodes.SUBTITLE_OVERLAY_UNAVAILABLE,
            severity: 'warning',
            message: 'Subtitle overlay host is unavailable; subtitle APIs remain active',
          },
        })
      }
    }
  }

  async initialize(): Promise<void> {
    if (this.#options.defaultTrackId !== undefined) await this.#manager.selectTrack(this.#options.defaultTrackId)
  }

  get tracks(): readonly SubtitleTrack[] { return this.#manager.tracks }
  get selectedTrackId(): string | null { return this.#manager.selectedTrackId }
  get state(): SubtitleState { return this.#manager.state }
  get style(): SubtitleCueStyle { return this.#manager.style }
  get fullscreenHost(): HTMLElement | null { return this.#targetKind === 'native-video' ? this.#overlay.host : null }

  listTracks(): readonly SubtitleTrack[] { return this.#manager.listTracks() }
  addTrack(source: import('@mx-player-max/types').ExternalSubtitleSourceDescriptor, options?: import('@mx-player-max/types').SubtitleTrackOptions): Promise<SubtitleTrack> { return this.#manager.addTrack(source, options) }
  selectTrack(trackId: string | null): Promise<void> { return this.#manager.selectTrack(trackId) }
  removeTrack(trackId: string): void { this.#manager.removeTrack(trackId) }
  closeSubtitles(): void { this.#manager.closeSubtitles() }
  setStyle(style: SubtitleCueStyle): void { this.#manager.setStyle(style) }
  resetStyle(): void { this.#manager.resetStyle() }

  attachOverlay(host?: HTMLElement): void {
    const value = host ?? this.#defaultHost
    if (!value) throw new SubtitleError(ErrorCodes.SUBTITLE_OVERLAY_UNAVAILABLE, 'Subtitle overlay host is unavailable', true)
    this.#manager.attachOverlay(value, this.#targetKind)
  }
  detachOverlay(): void { this.#manager.detachOverlay() }

  play(): void { this.#manager.play(); this.#callbackClock?.notify() }
  pause(): void { this.#manager.pause(); this.#callbackClock?.notify() }
  rateChanged(): void { this.#manager.rateChanged(); this.#callbackClock?.notify() }
  seekStarted(): void {
    this.#manager.seekStarted()
    if (this.#clock instanceof NativeSubtitleClock) this.#clock.setEpoch(this.#manager.epoch)
    this.#callbackClock?.notify()
  }
  seekCompleted(): void {
    this.#manager.seekCompleted()
    if (this.#clock instanceof NativeSubtitleClock) this.#clock.setEpoch(this.#manager.epoch)
    this.#callbackClock?.notify()
  }
  ended(): void { this.#manager.ended(); this.#callbackClock?.notify() }
  clockUpdate(): void { this.#callbackClock?.notify() }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    this.#manager.closeSubtitles()
    this.#clock.close()
  }

  private createLoader(): SubtitleTrackLoader {
    return async (request: SubtitleTrackLoaderRequest) => {
      if (request.source.kind !== 'embedded') {
        return loadExternalSubtitle(request.source, {
          trackId: request.trackId,
          format: request.format,
          parserLimits: request.parserLimits,
          sourceLimits: request.sourceLimits,
          signal: request.signal,
        })
      }
      const embedded = this.#embeddedTracks.get(request.source.trackId)
      if (!embedded) throw new Error('subtitle-embedded-track-not-found')
      return this.loadEmbedded(request, embedded.track, embedded.format)
    }
  }

  private async loadEmbedded(request: SubtitleTrackLoaderRequest, track: import('@mx-player-max/types').TrackInfo, format: import('@mx-player-max/types').SubtitleFormat): Promise<import('@mx-player-max/types').SubtitleParseResult> {
    const loader = createRangeLoader(this.#source, { signal: request.signal })
    let demuxer: import('@mx-player-max/demux').Demuxer | null = null
    const packets: DemuxPacket[] = []
    const maxPackets = request.parserLimits.maxCues + request.parserLimits.maxDiagnostics
    let totalBytes = 0
    const startedAt = nowMs()
    const deadline = startedAt + request.sourceLimits.operationTimeoutMs
    try {
      const selection = await withTimeout(probeContainer(loader), remainingTimeout(deadline), request.signal)
      demuxer = selection.demuxer
      let batchIndex = 0
      for (; batchIndex < request.sourceLimits.maxPacketBatches; batchIndex += 1) {
        if (request.signal.aborted) throw subtitleAbort()
        const batch = await withTimeout(demuxer.next(), remainingTimeout(deadline), request.signal)
        if (batch.length === 0) break
        for (const packet of batch) {
          if (packet.trackId !== track.id || packet.kind !== 'subtitle') continue
          if (packets.length >= maxPackets) throw new Error('subtitle-packet-count')
          totalBytes += packet.data.byteLength
          if (!Number.isSafeInteger(totalBytes) || totalBytes > request.sourceLimits.maxResponseBytes) throw new Error('subtitle-packet-budget')
          packets.push(packet)
        }
      }
      if (batchIndex >= request.sourceLimits.maxPacketBatches) {
        if (request.signal.aborted) throw subtitleAbort()
        const extraBatch = await withTimeout(demuxer.next(), remainingTimeout(deadline), request.signal)
        if (extraBatch.length > 0) throw new Error('subtitle-packet-batches')
      }
      if (packets.length === 0) return { cues: [], diagnostics: [{ code: ErrorCodes.SUBTITLE_PACKET_INVALID, severity: 'warning', message: 'Embedded subtitle track has no packets' }] }
      return parseEmbeddedSubtitlePackets(packets, {
        trackId: request.trackId,
        format,
        ...(track.codecPrivate === undefined ? {} : { codecPrivate: track.codecPrivate }),
        limits: request.parserLimits,
      })
    } catch (cause) {
      if (request.signal.aborted) throw subtitleAbort()
      const code = cause instanceof Error && cause.message === 'subtitle-operation-timeout'
        ? ErrorCodes.SUBTITLE_NETWORK_FAILED
        : cause instanceof Error && (cause.message === 'subtitle-packet-budget' || cause.message === 'subtitle-packet-batches' || cause.message === 'subtitle-packet-count')
          ? ErrorCodes.SUBTITLE_SOURCE_TOO_LARGE
          : ErrorCodes.SUBTITLE_OPERATION_FAILED
      throw new SubtitleError(code, 'Embedded subtitle loading failed', true)
    } finally {
      try { demuxer?.close() } finally { loader.close() }
    }
  }

  private resolveHost(target: ResolvedVideoTarget, surface: HTMLVideoElement | HTMLCanvasElement | null, explicit: HTMLElement | undefined): HTMLElement | null {
    if (explicit !== undefined) return explicit
    if (target.container) return target.container
    const parent = surface?.parentElement ?? target.target.parentElement
    return parent ?? null
  }
}

function formatForTrack(track: import('@mx-player-max/types').TrackInfo): import('@mx-player-max/types').SubtitleFormat | null {
  const value = `${track.codecId} ${track.codec ?? ''}`.toLowerCase()
  if (value.includes('s_text/utf8') || value.includes('subrip') || value.includes('srt')) return 'srt'
  if (value.includes('s_text/ass') || value.includes('ass')) return 'ass'
  if (value.includes('s_text/ssa') || value.includes('ssa')) return 'ssa'
  return null
}

function rendererTargetKind(kind: CustomRendererKind | null): SubtitleOverlayTargetKind {
  if (kind === 'webgpu') return 'webgpu'
  if (kind === 'webgl2') return 'webgl2'
  return 'canvas2d'
}

function isVideoLike(value: HTMLVideoElement | HTMLCanvasElement | null): value is HTMLVideoElement {
  return value !== null && String((value as { tagName?: unknown }).tagName ?? '').toLowerCase() === 'video'
}

function toSubtitleClockSnapshot(clock: AudioClockSnapshot | null, playing: boolean, subtitleEpoch: number): import('@mx-player-max/types').SubtitleClockSnapshot {
  const source = clock?.source === 'audio-context' ? 'audio-context' : 'wall-clock'
  const mediaTime = clock?.mediaTime
  const playbackRate = clock?.playbackRate
  const clockEpoch = clock?.epoch
  return {
    source,
    mediaTime: typeof mediaTime === 'number' && Number.isSafeInteger(mediaTime) && mediaTime >= 0 ? mediaTime : 0,
    playbackRate: typeof playbackRate === 'number' && Number.isFinite(playbackRate) && playbackRate > 0 ? playbackRate : 1,
    playing: playing || clock?.running === true,
    ended: false,
    epoch: Math.max(typeof clockEpoch === 'number' && Number.isSafeInteger(clockEpoch) && clockEpoch >= 0 ? clockEpoch : 0, subtitleEpoch),
  }
}

function subtitleAbort(): SubtitleError { return new SubtitleError(ErrorCodes.SUBTITLE_ABORTED, 'Subtitle loading was aborted', true) }

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw subtitleAbort()
  let timer: ReturnType<typeof setTimeout> | null = null
  let onAbort: (() => void) | null = null
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('subtitle-operation-timeout')), timeoutMs) })
  const aborted = new Promise<never>((_, reject) => {
    onAbort = (): void => reject(subtitleAbort())
    signal.addEventListener('abort', onAbort, { once: true })
  })
  try { return await Promise.race([operation, timeout, aborted]) }
  finally {
    if (timer !== null) clearTimeout(timer)
    if (onAbort !== null) signal.removeEventListener('abort', onAbort)
  }
}

function nowMs(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now()
}

function remainingTimeout(deadline: number): number {
  const remaining = deadline - nowMs()
  if (!Number.isFinite(remaining) || remaining <= 0) throw new Error('subtitle-operation-timeout')
  return remaining
}
