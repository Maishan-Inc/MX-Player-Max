import type {
  ExternalSubtitleSourceDescriptor,
  SubtitleCue,
  SubtitleCueMetadata,
  SubtitleCueStyle,
  SubtitleDiagnostic,
  SubtitleFormat,
  SubtitleParserLimits,
  SubtitleParserLimitsInput,
  SubtitleSourceDescriptor,
  SubtitleSourceLimits,
  SubtitleSourceLimitsInput,
  SubtitleState,
  SubtitleStyleStore,
  SubtitleTrack,
  SubtitleTrackChangeReason,
  SubtitleTrackOptions,
  SubtitleTrackSource,
  SubtitleTrackState,
} from '@mx-player-max/types'
import { ErrorCodes } from '@mx-player-max/types'
import { SubtitleError } from './errors'
import { SubtitleScheduler, type SubtitleClock } from './clock'
import { inferSubtitleFormat, loadExternalSubtitle, validateExternalSubtitleSource } from './source'
import { DEFAULT_SUBTITLE_STYLE, assertSubtitleStyle, createDefaultSubtitleStyleStore, normalizeSubtitleStyle } from './style-store'
import type { SubtitleOverlay, SubtitleOverlayTargetKind } from './overlay'
import { resolveSubtitleParserLimits, resolveSubtitleSourceLimits, validateSubtitleFormat } from './limits'

export interface SubtitleTrackDefinition {
  id: string
  source: SubtitleSourceDescriptor
  format: SubtitleFormat
  language?: string
  name?: string
}

export interface SubtitleTrackLoaderRequest {
  trackId: string
  source: SubtitleSourceDescriptor
  format: SubtitleFormat
  signal: AbortSignal
  parserLimits: SubtitleParserLimits
  sourceLimits: SubtitleSourceLimits
  epoch: number
}

export type SubtitleTrackLoader = (request: SubtitleTrackLoaderRequest) => Promise<import('@mx-player-max/types').SubtitleParseResult>

export type SubtitleManagerEvent =
  | { type: 'trackchange'; tracks: readonly SubtitleTrack[]; selectedTrackId: string | null; reason: SubtitleTrackChangeReason }
  | { type: 'cuechange'; trackId: string | null; cues: readonly SubtitleCueMetadata[]; currentTime: import('@mx-player-max/types').Micros; epoch: number }
  | { type: 'statechange'; previous: SubtitleState; current: SubtitleState; trackId: string | null }
  | { type: 'stylechange'; style: SubtitleCueStyle }
  | { type: 'warning'; trackId: string | null; diagnostic: SubtitleDiagnostic }

export interface SubtitleTrackManagerOptions {
  tracks?: readonly SubtitleTrackDefinition[]
  clock: SubtitleClock
  overlay?: SubtitleOverlay
  overlayHost?: HTMLElement
  overlayTargetKind?: SubtitleOverlayTargetKind
  styleStore?: SubtitleStyleStore
  styleScope: string
  parserLimits?: SubtitleParserLimitsInput
  sourceLimits?: SubtitleSourceLimitsInput
  loadTrack?: SubtitleTrackLoader
  onEvent?: (event: SubtitleManagerEvent) => void
}

interface TrackRecord {
  definition: SubtitleTrackDefinition
  sourceFingerprint: string | null
  state: SubtitleTrackState
  cues: SubtitleCue[] | null
  diagnosticCount: number
}

export class SubtitleTrackManager {
  readonly #clock: SubtitleClock
  readonly #scheduler: SubtitleScheduler
  readonly #overlay: SubtitleOverlay | null
  readonly #styleStore: SubtitleStyleStore
  readonly #styleScope: string
  readonly #parserLimits: SubtitleParserLimits
  readonly #sourceLimits: SubtitleSourceLimits
  readonly #loadTrack: SubtitleTrackLoader
  readonly #onEvent: ((event: SubtitleManagerEvent) => void) | undefined
  readonly #records: TrackRecord[] = []
  readonly #fileFingerprints = new WeakMap<object, string>()
  #selectedId: string | null = null
  #state: SubtitleState = 'idle'
  #style: SubtitleCueStyle
  #epoch = 0
  #operation = 0
  #counter = 0
  #fileCounter = 0
  #visibleCues: readonly SubtitleCue[] = []
  #abort: AbortController | null = null
  #resumeAfterSeek = false
  #reloadAfterSeek = false
  #closed = false

  constructor(options: SubtitleTrackManagerOptions) {
    this.#clock = options.clock
    this.#overlay = options.overlay ?? null
    this.#styleStore = options.styleStore ?? createDefaultSubtitleStyleStore()
    this.#styleScope = options.styleScope
    this.#parserLimits = resolveSubtitleParserLimits(options.parserLimits)
    this.#sourceLimits = resolveSubtitleSourceLimits(options.sourceLimits)
    this.#loadTrack = options.loadTrack ?? defaultLoadTrack
    this.#onEvent = options.onEvent
    this.#style = this.loadStyle()
    for (const definition of options.tracks ?? []) {
      const id = normalizeTrackId(definition.id)
      if (this.#records.some((record) => record.definition.id === id)) throw new SubtitleError(ErrorCodes.SUBTITLE_TRACK_ID_CONFLICT, 'Subtitle track ID is already in use', false)
      const format = validateSubtitleFormat(definition.format)
      if (definition.source.kind !== 'embedded') validateExternalSubtitleSource(definition.source)
      const sourceFingerprint = definition.source.kind === 'embedded' ? null : this.externalSourceFingerprint(definition.source, format)
      if (sourceFingerprint !== null && this.#records.some((record) => record.sourceFingerprint === sourceFingerprint)) {
        throw new SubtitleError(ErrorCodes.SUBTITLE_SOURCE_CONFLICT, 'Subtitle source is already registered', false)
      }
      this.addDefinition({ ...definition, id, format }, sourceFingerprint)
    }
    this.#scheduler = new SubtitleScheduler(this.#clock, (update) => this.handleCueUpdate(update.cues, update.snapshot.mediaTime))
    if (options.overlay && options.overlayHost && options.overlayTargetKind) options.overlay.attach(options.overlayHost, options.overlayTargetKind)
    this.emitTrackChange('enumerated')
  }

  get tracks(): readonly SubtitleTrack[] { return this.#records.map((record) => snapshotTrack(record)) }
  get selectedTrackId(): string | null { return this.#selectedId }
  get state(): SubtitleState { return this.#state }
  get style(): SubtitleCueStyle { return { ...this.#style } }
  get epoch(): number { return this.#epoch }

  listTracks(): readonly SubtitleTrack[] { return this.tracks }

  async addTrack(source: ExternalSubtitleSourceDescriptor, options: SubtitleTrackOptions = {}): Promise<SubtitleTrack> {
    this.ensureOpen()
    if (!source || (source.kind !== 'file' && source.kind !== 'url')) throw new SubtitleError(ErrorCodes.SUBTITLE_SOURCE_INVALID, 'Subtitle source is invalid', false)
    validateExternalSubtitleSource(source)
    const candidate = source.format ?? inferSubtitleFormat(source)
    if (candidate === null) throw new SubtitleError(ErrorCodes.SUBTITLE_FORMAT_UNSUPPORTED, 'Subtitle format could not be determined', false)
    const format = validateSubtitleFormat(candidate)
    const id = options.id === undefined ? this.nextTrackId() : normalizeTrackId(options.id)
    if (this.#records.some((record) => record.definition.id === id)) throw new SubtitleError(ErrorCodes.SUBTITLE_TRACK_ID_CONFLICT, 'Subtitle track ID is already in use', false)
    const sourceFingerprint = this.externalSourceFingerprint(source, format)
    if (this.#records.some((record) => record.sourceFingerprint === sourceFingerprint)) throw new SubtitleError(ErrorCodes.SUBTITLE_SOURCE_CONFLICT, 'Subtitle source is already registered', false)
    const definition: SubtitleTrackDefinition = {
      id,
      source,
      format,
      ...(options.language === undefined ? {} : { language: options.language }),
      ...(options.name === undefined ? {} : { name: options.name }),
    }
    const record = this.addDefinition(definition, sourceFingerprint)
    record.state = 'loading'
    this.emitTrackChange('added')
    const operation = ++this.#operation
    this.#epoch += 1
    const controller = createAbortController()
    this.#abort?.abort()
    this.#abort = controller
    try {
      const result = await this.#loadTrack({ trackId: id, source, format, signal: controller.signal, parserLimits: this.#parserLimits, sourceLimits: this.#sourceLimits, epoch: this.#epoch })
      this.ensureCurrent(operation, controller)
      record.cues = result.cues
      record.diagnosticCount = result.diagnostics.length
      record.state = 'ready'
      this.emitDiagnostics(id, result.diagnostics)
      this.emitTrackChange('loaded')
      return snapshotTrack(record)
    } catch (cause) {
      if (this.#isStale(operation, controller)) throw new SubtitleError(ErrorCodes.SUBTITLE_ABORTED, 'Subtitle loading was superseded', true)
      record.state = 'error'
      this.emitTrackChange('failed')
      const error = cause instanceof SubtitleError ? cause : new SubtitleError(ErrorCodes.SUBTITLE_OPERATION_FAILED, 'Subtitle track could not be loaded', true)
      this.emitWarning(id, { code: error.code, severity: 'error', message: error.message })
      throw error
    } finally {
      if (this.#abort === controller) this.#abort = null
    }
  }

  async selectTrack(trackId: string | null): Promise<void> {
    this.ensureOpen()
    if (trackId !== null && this.record(trackId) === undefined) throw new SubtitleError(ErrorCodes.SUBTITLE_TRACK_NOT_FOUND, 'Subtitle track was not found', false)
    this.#reloadAfterSeek = false
    const operation = ++this.#operation
    this.#epoch += 1
    this.#abort?.abort()
    this.#abort = null
    this.#scheduler.pause()
    this.#scheduler.clear()
    const previous = this.#selectedId
    if (previous !== null) {
      const previousRecord = this.record(previous)
      if (previousRecord && previousRecord.state === 'selected') previousRecord.state = previousRecord.cues ? 'ready' : 'idle'
    }
    if (trackId === null) {
      this.#selectedId = null
      this.setState('disabled')
      this.emitTrackChange('disabled')
      this.emitCueChange([], this.#clock.snapshot().mediaTime)
      return
    }
    const record = this.record(trackId)
    if (!record) throw new SubtitleError(ErrorCodes.SUBTITLE_TRACK_NOT_FOUND, 'Subtitle track was not found', false)
    this.#selectedId = trackId
    record.state = 'loading'
    this.setState('loading')
    this.emitTrackChange('selected')
    const controller = createAbortController()
    this.#abort = controller
    try {
      if (record.cues === null) {
        const result = await this.#loadTrack({ trackId, source: record.definition.source, format: record.definition.format, signal: controller.signal, parserLimits: this.#parserLimits, sourceLimits: this.#sourceLimits, epoch: this.#epoch })
        this.ensureCurrent(operation, controller)
        record.cues = result.cues
        record.diagnosticCount = result.diagnostics.length
        this.emitDiagnostics(trackId, result.diagnostics)
      }
      this.ensureCurrent(operation, controller)
      record.state = 'selected'
      this.#scheduler.setCues(record.cues ?? [], true)
      this.setState('ready')
      if (this.#clock.snapshot().playing) this.#scheduler.play()
      this.emitTrackChange('loaded')
      this.#scheduler.refresh(true)
    } catch (cause) {
      if (this.#isStale(operation, controller)) throw new SubtitleError(ErrorCodes.SUBTITLE_ABORTED, 'Subtitle selection was superseded', true)
      record.state = 'error'
      this.setState('error')
      this.emitTrackChange('failed')
      const error = cause instanceof SubtitleError ? cause : new SubtitleError(ErrorCodes.SUBTITLE_OPERATION_FAILED, 'Subtitle track could not be selected', true)
      this.emitWarning(trackId, { code: error.code, severity: 'error', message: error.message })
      throw error
    } finally {
      if (this.#abort === controller) this.#abort = null
    }
  }

  removeTrack(trackId: string): void {
    this.ensureOpen()
    const index = this.#records.findIndex((record) => record.definition.id === trackId)
    if (index < 0) throw new SubtitleError(ErrorCodes.SUBTITLE_TRACK_NOT_FOUND, 'Subtitle track was not found', false)
    const record = this.#records[index]
    if (record === undefined) return
    this.#operation += 1
    this.#epoch += 1
    this.#abort?.abort()
    this.#abort = null
    if (this.#selectedId === trackId) {
      this.#selectedId = null
      this.#reloadAfterSeek = false
      this.#scheduler.clear()
      this.setState('disabled')
      this.emitCueChange([], this.#clock.snapshot().mediaTime)
    }
    this.#records.splice(index, 1)
    this.emitTrackChange('removed')
  }

  closeSubtitles(): void {
    if (this.#closed) return
    this.#closed = true
    this.#operation += 1
    this.#epoch += 1
    this.#abort?.abort()
    this.#abort = null
    this.#scheduler.close()
    this.#overlay?.close()
    this.#records.length = 0
    this.#selectedId = null
    this.#visibleCues = []
    this.#reloadAfterSeek = false
    this.setState('closed')
  }

  setStyle(style: SubtitleCueStyle): void {
    this.ensureOpen()
    assertSubtitleStyle(style)
    this.#style = normalizeSubtitleStyle({ ...this.#style, ...style })
    this.#overlay?.render(this.selectedCues(), this.#style)
    try { this.#styleStore.save(this.#styleScope, this.#style) }
    catch { this.emitWarning(this.#selectedId, { code: ErrorCodes.SUBTITLE_STORE_FAILED, severity: 'warning', message: 'Subtitle style storage is unavailable' }) }
    this.#onEvent?.({ type: 'stylechange', style: this.style })
  }

  resetStyle(): void { this.setStyle(normalizeSubtitleStyle(DEFAULT_SUBTITLE_STYLE)) }

  attachOverlay(host: HTMLElement, targetKind: SubtitleOverlayTargetKind): void {
    this.ensureOpen()
    if (!this.#overlay) throw new SubtitleError(ErrorCodes.SUBTITLE_OVERLAY_UNAVAILABLE, 'Subtitle overlay is not available', true)
    this.#overlay.attach(host, targetKind)
    this.#overlay.render(this.selectedCues(), this.#style)
  }

  detachOverlay(): void { this.#overlay?.detach() }

  play(): void { if (this.#closed) return; this.#resumeAfterSeek = true; this.#scheduler.play() }
  pause(): void { if (this.#closed) return; this.#resumeAfterSeek = false; this.#scheduler.pause() }
  rateChanged(): void { if (this.#closed) return; this.#scheduler.refresh(true) }
  seekStarted(): void {
    if (this.#closed) return
    const wasPlaying = this.#clock.snapshot().playing
    const selected = this.#selectedId === null ? undefined : this.record(this.#selectedId)
    this.#reloadAfterSeek = selected !== undefined && selected.cues === null
    this.#operation += 1
    this.#epoch += 1
    this.#abort?.abort()
    this.#abort = null
    this.#scheduler.pause()
    this.#resumeAfterSeek = wasPlaying
    this.#scheduler.seek(this.#epoch, false)
  }
  seekCompleted(): void {
    if (this.#closed) return
    const reloadTrackId = this.#reloadAfterSeek ? this.#selectedId : null
    this.#reloadAfterSeek = false
    this.#scheduler.completeSeek(this.#epoch)
    if (this.#resumeAfterSeek || this.#clock.snapshot().playing) this.#scheduler.play()
    this.#resumeAfterSeek = false
    if (reloadTrackId !== null) void this.selectTrack(reloadTrackId).catch(() => { /* warning/state events already report the failure */ })
  }
  ended(): void { if (this.#closed) return; this.#resumeAfterSeek = false; this.#scheduler.ended(); this.setState('ended') }

  private addDefinition(definition: SubtitleTrackDefinition, sourceFingerprint: string | null = null): TrackRecord {
    const record: TrackRecord = { definition, sourceFingerprint, state: 'idle', cues: null, diagnosticCount: 0 }
    this.#records.push(record)
    return record
  }

  private externalSourceFingerprint(source: ExternalSubtitleSourceDescriptor, format: SubtitleFormat): string {
    if (source.kind === 'url') {
      try {
        const url = new URL(source.url)
        url.hash = ''
        return `url:${format}:${url.href}`
      } catch {
        return `url:${format}:${source.url}`
      }
    }
    const file = source.file as object
    const existing = this.#fileFingerprints.get(file)
    if (existing !== undefined) return `file:${format}:${existing}`
    const fingerprint = String(++this.#fileCounter)
    this.#fileFingerprints.set(file, fingerprint)
    return `file:${format}:${fingerprint}`
  }

  private handleCueUpdate(cues: readonly SubtitleCue[], currentTime: number): void {
    if (this.#closed) return
    this.#visibleCues = [...cues]
    this.#overlay?.render(cues, this.#style)
    if (this.#selectedId !== null && this.#state !== 'ended' && this.#state !== 'error') this.setState(cues.length > 0 ? 'showing' : 'ready')
    this.emitCueChange(cues, currentTime)
  }

  private emitCueChange(cues: readonly SubtitleCue[], currentTime: import('@mx-player-max/types').Micros): void {
    const metadata: SubtitleCueMetadata[] = cues.map((cue) => ({ cueId: cue.cueId, start: cue.start, end: cue.end, layer: cue.layer }))
    this.#onEvent?.({ type: 'cuechange', trackId: this.#selectedId, cues: metadata, currentTime, epoch: this.#epoch })
  }

  private emitDiagnostics(trackId: string, diagnostics: readonly SubtitleDiagnostic[]): void {
    for (const diagnostic of diagnostics) this.emitWarning(trackId, diagnostic)
  }

  private emitWarning(trackId: string | null, diagnostic: SubtitleDiagnostic): void {
    this.#onEvent?.({ type: 'warning', trackId, diagnostic: { ...diagnostic } })
  }

  private emitTrackChange(reason: SubtitleTrackChangeReason): void {
    this.#onEvent?.({ type: 'trackchange', tracks: this.tracks, selectedTrackId: this.#selectedId, reason })
  }

  private setState(next: SubtitleState): void {
    if (this.#state === next) return
    const previous = this.#state
    this.#state = next
    this.#onEvent?.({ type: 'statechange', previous, current: next, trackId: this.#selectedId })
  }

  private selectedCues(): readonly SubtitleCue[] {
    if (this.#selectedId === null) return []
    return this.#visibleCues
  }

  private record(id: string): TrackRecord | undefined { return this.#records.find((record) => record.definition.id === id) }

  private nextTrackId(): string {
    let id: string
    do { id = `external-${++this.#counter}` } while (this.#records.some((record) => record.definition.id === id))
    return id
  }

  private ensureCurrent(operation: number, controller: AbortController): void {
    if (this.#closed || operation !== this.#operation || this.#abort !== controller || controller.signal.aborted) throw new SubtitleError(ErrorCodes.SUBTITLE_ABORTED, 'Subtitle operation was superseded', true)
  }

  #isStale(operation: number, controller: AbortController): boolean { return this.#closed || operation !== this.#operation || this.#abort !== controller || controller.signal.aborted }
  private ensureOpen(): void { if (this.#closed) throw new SubtitleError(ErrorCodes.SUBTITLE_CLOSED, 'Subtitle manager is closed', false) }

  private loadStyle(): SubtitleCueStyle {
    try { return normalizeSubtitleStyle(this.#styleStore.load(this.#styleScope)) }
    catch { return normalizeSubtitleStyle(DEFAULT_SUBTITLE_STYLE) }
  }
}

function snapshotTrack(record: TrackRecord): SubtitleTrack {
  const source = record.definition.source
  const sourceSummary: SubtitleTrackSource = source.kind === 'embedded'
    ? { kind: 'embedded', format: record.definition.format, embeddedTrackId: source.trackId }
    : { kind: source.kind, format: record.definition.format }
  return {
    id: record.definition.id,
    source: sourceSummary,
    format: record.definition.format,
    language: record.definition.language ?? null,
    name: record.definition.name ?? record.definition.language ?? record.definition.id,
    state: record.state,
    cueCount: record.cues?.length ?? 0,
    diagnosticCount: record.diagnosticCount,
  }
}

async function defaultLoadTrack(request: SubtitleTrackLoaderRequest): Promise<import('@mx-player-max/types').SubtitleParseResult> {
  if (request.source.kind === 'embedded') throw new SubtitleError(ErrorCodes.SUBTITLE_SOURCE_UNSUPPORTED, 'Embedded subtitle loading requires a Demux session', true)
  return loadExternalSubtitle(request.source, { trackId: request.trackId, format: request.format, parserLimits: request.parserLimits, sourceLimits: request.sourceLimits, signal: request.signal })
}

function normalizeTrackId(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > 128 || !/^[\w:.\-]+$/u.test(trimmed)) throw new SubtitleError(ErrorCodes.SUBTITLE_TRACK_ID_CONFLICT, 'Subtitle track ID is invalid', false)
  return trimmed
}

function createAbortController(): AbortController {
  return typeof AbortController === 'undefined' ? new FallbackAbortController() : new AbortController()
}

class FallbackAbortController implements AbortController {
  readonly signal: AbortSignal
  constructor() {
    const controller = { aborted: false, addEventListener: () => {}, removeEventListener: () => {} } as unknown as AbortSignal
    this.signal = controller
  }
  abort(): void { /* no cancellation primitive available */ }
}
