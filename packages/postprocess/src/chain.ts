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
  readonly #interpolation: TemporalStage | null
  readonly #superResolution: SpatialStage | null
  readonly #governor: FrameBudgetGovernor
  readonly #onEvent: (event: AiPipelineEvent) => void
  readonly #frameBudgetMs: number
  #currentEpoch: number
  #tier: AiQualityTier
  #interpolationEnabled: boolean
  #superResolutionEnabled: boolean
  #closed = false
  #unsubGovernor: (() => void) | null = null

  constructor(options: AiPipelineOptions) {
    this.#upstream = options.upstream
    this.#passthrough = createPassthroughSource(options.upstream)
    this.#interpolation = options.interpolation ?? null
    this.#superResolution = options.superResolution ?? null
    this.#governor = options.governor ?? createFrameBudgetGovernor({
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

  async frameAt(t: Micros, epoch: number): Promise<PipelineFrame | null> {
    if (this.#closed || epoch !== this.#currentEpoch) return null
    const started = nowMs()
    try {
      let frame = await this.#readFrame(t, epoch)
      if (!frame) return null
      if (this.#superResolutionEnabled && this.#superResolution && frame.location === 'cpu') {
        frame = await this.#superResolution.process(frame, epoch)
      } else if (this.#superResolutionEnabled && this.#superResolution) {
        frame = await this.#superResolution.process(frame, epoch)
      }
      this.#governor.record(nowMs() - started, this.#frameBudgetMs)
      return frame
    } catch (error) {
      this.#onEvent({ type: 'error', reason: 'ai-pipeline-failed', error })
      this.#disableWithFallback('ai-pipeline-failed')
      return this.#passthrough.frameAt(t, epoch)
    }
  }

  reset(epoch: number): void {
    this.#currentEpoch = epoch
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
    if (!first) return this.#passthrough.frameAt(t, epoch)
    if (!this.#interpolationEnabled || !this.#interpolation) return first
    const second = this.#upstream.peekNext(first.timestamp)
    if (!second) return this.#upstream.endOfStream ? first : null
    const duration = second.timestamp - first.timestamp
    const phase = duration > 0 ? Math.min(1, Math.max(0, (t - first.timestamp) / duration)) : 0
    return this.#interpolation.synthesize(first, second, phase, epoch)
  }

  #disableWithFallback(reason: string): void {
    const previous = this.#tier
    this.#tier = 'off'
    this.#interpolationEnabled = false
    this.#superResolutionEnabled = false
    this.#onEvent({ type: 'fallback', previous, current: 'off', reason })
  }
}

export function createAiPipeline(options: AiPipelineOptions): AiPipeline {
  return new AiPipeline(options)
}

function nowMs(): number { return typeof performance === 'undefined' ? Date.now() : performance.now() }
