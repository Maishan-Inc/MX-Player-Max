import type { AiQualityTier, Micros } from '@mx-player-max/types'
import { createPassthroughSource } from './passthrough'
import { createFrameBudgetGovernor, type FrameBudgetGovernor, type FrameBudgetGovernorOptions } from './governor'
import type { DecodedFrameSource, FrameSource, PipelineFrame, SpatialStage, TemporalStage } from './types'

export interface AiPipelineEvent {
  readonly type: 'qualitychange' | 'fallback' | 'error'
  readonly previous?: AiQualityTier
  readonly current?: AiQualityTier
  readonly reason: string
  readonly error?: unknown
}

export interface AiPipelineOptions {
  readonly upstream: DecodedFrameSource
  readonly interpolation?: TemporalStage
  readonly superResolution?: SpatialStage
  readonly governor?: FrameBudgetGovernor
  readonly governorOptions?: FrameBudgetGovernorOptions
  readonly initialTier?: AiQualityTier
  readonly maxTier?: AiQualityTier
  readonly interpolationEnabled?: boolean
  readonly superResolutionEnabled?: boolean
  readonly onEvent?: (event: AiPipelineEvent) => void
  readonly now?: () => number
  readonly frameBudgetMs?: number
}

/** Pull-based composition of temporal and spatial stages with atomic fallback. */
export class AiPipeline implements FrameSource {
  readonly #upstream: DecodedFrameSource
  readonly #passthrough: FrameSource
  #interpolation: TemporalStage | null
  #superResolution: SpatialStage | null
  readonly #governor: FrameBudgetGovernor
  readonly #onEvent: (event: AiPipelineEvent) => void
  readonly #frameBudgetMs: number
  #currentEpoch: number
  #tier: AiQualityTier
  #interpolationEnabled: boolean
  #superResolutionEnabled: boolean
  #consumedThrough: Micros = -1
  #closed = false
  #unsubGovernor: (() => void) | null = null

  constructor(options: AiPipelineOptions) {
    this.#upstream = options.upstream
    this.#passthrough = createPassthroughSource(options.upstream)
    this.#interpolation = options.interpolation ?? null
    this.#superResolution = options.superResolution ?? null
    this.#governor = options.governor ?? createFrameBudgetGovernor({
      ...options.governorOptions,
      ...(options.initialTier === undefined ? {} : { initialTier: options.initialTier }),
      ...(options.maxTier === undefined ? {} : { maxTier: options.maxTier }),
      ...(options.now === undefined ? {} : { now: options.now }),
    })
    this.#onEvent = options.onEvent ?? (() => {})
    this.#frameBudgetMs = Number.isFinite(options.frameBudgetMs) && (options.frameBudgetMs ?? 0) > 0 ? options.frameBudgetMs as number : 10
    this.#currentEpoch = options.upstream.epoch
    this.#tier = this.#governor.tier
    this.#interpolationEnabled = options.interpolationEnabled ?? this.#interpolation !== null
    this.#superResolutionEnabled = options.superResolutionEnabled ?? this.#superResolution !== null
    this.#unsubGovernor = this.#governor.onTierChange((tier) => {
      const previous = this.#tier
      this.#tier = tier
      if (tier === 'off') {
        this.#interpolationEnabled = false
        this.#superResolutionEnabled = false
      } else if (tier === 'low') {
        this.#interpolationEnabled = false
        this.#superResolutionEnabled = this.#superResolution !== null
      } else {
        this.#superResolutionEnabled = this.#superResolution !== null
      }
      this.#onEvent({ type: 'qualitychange', previous, current: tier, reason: 'governor-tier-change' })
    })
  }

  get lookaheadFrames(): number { return this.#interpolationEnabled && this.#interpolation ? this.#interpolation.lookaheadFrames ?? 1 : 0 }
  get tier(): AiQualityTier { return this.#tier }
  get governor(): FrameBudgetGovernor { return this.#governor }
  get interpolationEnabled(): boolean { return this.#interpolationEnabled }
  get superResolutionEnabled(): boolean { return this.#superResolutionEnabled }
  /** True when a stage instance is attached and can therefore be switched on. */
  get hasInterpolation(): boolean { return this.#interpolation !== null }
  get hasSuperResolution(): boolean { return this.#superResolution !== null }

  /**
   * Upstream frames at or below this timestamp are no longer needed.
   *
   * A consumer cannot simply release through the timestamp it just presented:
   * interpolation reads two decoded frames per output frame and keeps reading the
   * earlier one for every phase between them. That one-frame debt is exactly what
   * {@link lookaheadFrames} reports, and this is where it has to be honoured.
   * `-1` means nothing has been consumed yet.
   */
  get consumedThrough(): Micros { return this.#consumedThrough }

  /**
   * Attach a stage the pipeline was not constructed with.
   *
   * Stages are built lazily — the first time a toggle is switched on — so the
   * pipeline usually already exists by the time the second one is requested, and
   * rebuilding it would drop the governor's history and the current epoch.
   */
  attachStages(stages: { readonly interpolation?: TemporalStage; readonly superResolution?: SpatialStage }): void {
    if (this.#closed) throw new Error('AI pipeline is closed')
    if (stages.interpolation) {
      if (this.#interpolation && this.#interpolation !== stages.interpolation) throw new Error('An interpolation stage is already attached')
      this.#interpolation = stages.interpolation
    }
    if (stages.superResolution) {
      if (this.#superResolution && this.#superResolution !== stages.superResolution) throw new Error('A super-resolution stage is already attached')
      this.#superResolution = stages.superResolution
    }
  }

  /**
   * Switch stages on or off at runtime. The governor still owns degradation, so a
   * stage enabled here can be switched off again by the next tier change.
   */
  setStages(request: { readonly interpolation?: boolean; readonly superResolution?: boolean }): void {
    if (this.#closed) throw new Error('AI pipeline is closed')
    if (request.interpolation !== undefined) {
      if (request.interpolation && !this.#interpolation) throw new Error('No interpolation stage is attached')
      this.#interpolationEnabled = request.interpolation
    }
    if (request.superResolution !== undefined) {
      if (request.superResolution && !this.#superResolution) throw new Error('No super-resolution stage is attached')
      this.#superResolutionEnabled = request.superResolution
    }
  }

  async frameAt(t: Micros, epoch: number): Promise<PipelineFrame | null> {
    if (this.#closed || epoch !== this.#currentEpoch) return null
    const started = nowMs()
    try {
      let frame = await this.#readFrame(t, epoch)
      if (!this.#isActiveEpoch(epoch)) {
        releasePipelineFrame(frame)
        return null
      }
      if (!frame) return null
      if (this.#superResolutionEnabled && this.#superResolution) {
        frame = await this.#superResolution.process(frame, epoch)
      }
      if (!this.#isActiveEpoch(epoch)) {
        releasePipelineFrame(frame)
        return null
      }
      this.#governor.record(nowMs() - started, this.#frameBudgetMs)
      return frame
    } catch (error) {
      if (!this.#isActiveEpoch(epoch)) return null
      this.#onEvent({ type: 'error', reason: 'ai-pipeline-failed', error })
      this.#disableWithFallback('ai-pipeline-failed')
      const fallback = await this.#passthrough.frameAt(t, epoch)
      if (fallback) this.#consumedThrough = fallback.timestamp
      return fallback
    }
  }

  reset(epoch: number): void {
    this.#currentEpoch = epoch
    this.#consumedThrough = -1
    this.#passthrough.reset(epoch)
    this.#governor.freeze?.()
    this.#governor.resume?.()
  }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    this.#unsubGovernor?.()
    this.#unsubGovernor = null
    this.#interpolation?.close()
    this.#superResolution?.close()
    this.#governor.close?.()
    this.#passthrough.close()
  }

  async #readFrame(t: Micros, epoch: number): Promise<PipelineFrame | null> {
    const first = this.#upstream.peekAt(t)
    if (!first) {
      const frame = await this.#passthrough.frameAt(t, epoch)
      if (frame) this.#consumedThrough = frame.timestamp
      return frame
    }
    if (!this.#interpolationEnabled || !this.#interpolation) {
      this.#consumedThrough = first.timestamp
      return first
    }
    const second = this.#upstream.peekNext(first.timestamp)
    if (!second) {
      // No successor yet. At end of stream there will never be one, so present the
      // last decoded frame; otherwise the queue is still filling and the caller
      // must wait rather than synthesise against a frame that does not exist.
      if (!this.#upstream.endOfStream) return null
      this.#consumedThrough = first.timestamp
      return first
    }
    const duration = second.timestamp - first.timestamp
    const phase = duration > 0 ? Math.min(1, Math.max(0, (t - first.timestamp) / duration)) : 0
    // `first` is still needed for every later phase in [first, second), so the
    // consumer may only release up to the frame before it.
    this.#consumedThrough = first.timestamp - 1
    return this.#interpolation.synthesize(first, second, phase, epoch)
  }

  #disableWithFallback(reason: string): void {
    const previous = this.#tier
    this.#tier = 'off'
    this.#interpolationEnabled = false
    this.#superResolutionEnabled = false
    this.#onEvent({ type: 'fallback', previous, current: 'off', reason })
  }

  #isActiveEpoch(epoch: number): boolean {
    return !this.#closed && epoch === this.#currentEpoch
  }
}

export function createAiPipeline(options: AiPipelineOptions): AiPipeline {
  return new AiPipeline(options)
}

function nowMs(): number { return typeof performance === 'undefined' ? Date.now() : performance.now() }

function releasePipelineFrame(frame: PipelineFrame | null): void {
  if (frame?.location === 'gpu') frame.release()
}
