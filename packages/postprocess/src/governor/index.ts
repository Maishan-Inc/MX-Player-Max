import type { AiQualityTier } from '@mx-player-max/types'

/** Governor quality tiers used during AI processing */
export type { AiQualityTier }

/**
 * Runtime frame-budget governor.
 *
 * Lives in the presentation loop: it measures how long each frame takes,
 * compares against the target budget, and degrades or recovers the quality
 * tier. This is a stateful, continuous feedback loop that neither
 * `capabilities` (probe-once) nor `strategy` (pure function) can host.
 *
 * The default implementation uses a bounded median window and hysteresis;
 * callers can provide timestamp-query measurements through the same record
 * contract without changing policy behavior.
 */
export interface FrameBudgetGovernor {
  /**
   * Run a micro-benchmark at the given resolution to pick a starting tier.
   * Called once after the pipeline initialises.
   */
  calibrate(device: GPUDevice, width: number, height: number): Promise<AiQualityTier>

  /**
   * Record the time spent on frame generation for the sliding window.
   * @param stageMs wall-clock milliseconds for the postprocess stages.
   * @param budgetMs target budget (e.g. 1000/60 * 0.6 = 10 ms at 60 Hz).
   */
  record(stageMs: number, budgetMs: number): void

  /** Current active quality tier. */
  readonly tier: AiQualityTier

  /**
   * Subscribe to tier changes. Tier changes MUST be surfaced as SDK events
   * (silent degradation is forbidden by the subtitle-pipeline.md:25 precedent).
   */
  readonly onTierChange: (listener: (tier: AiQualityTier) => void) => () => void
  /** Optional lifecycle hooks used by seek/device-loss integration. */
  readonly freeze?: () => void
  readonly resume?: () => void
  readonly setDeviceLost?: () => void
  readonly close?: () => void
}

export interface FrameBudgetGovernorOptions {
  readonly initialTier?: AiQualityTier
  readonly maxTier?: AiQualityTier
  readonly now?: () => number
  readonly windowSize?: number
  readonly recoveryMs?: number
  readonly recoveryCooldownMs?: number
}

const TIER_ORDER: readonly AiQualityTier[] = ['off', 'low', 'medium', 'high', 'ultra']

export class DefaultFrameBudgetGovernor implements FrameBudgetGovernor {
  readonly #now: () => number
  readonly #windowSize: number
  readonly #recoveryMs: number
  readonly #recoveryCooldownMs: number
  readonly #listeners = new Set<(tier: AiQualityTier) => void>()
  #tier: AiQualityTier
  #maxTier: AiQualityTier
  #samples: number[] = []
  #underBudgetSince: number | null = null
  #lastRecoveryAt = Number.NEGATIVE_INFINITY
  #frozen = false
  #closed = false

  constructor(options: FrameBudgetGovernorOptions = {}) {
    this.#now = options.now ?? (() => typeof performance === 'undefined' ? Date.now() : performance.now())
    this.#windowSize = clampInteger(options.windowSize ?? 30, 3, 120)
    this.#recoveryMs = Math.max(1, options.recoveryMs ?? 10_000)
    this.#recoveryCooldownMs = Math.max(1, options.recoveryCooldownMs ?? 30_000)
    this.#maxTier = options.maxTier ?? 'ultra'
    this.#tier = options.initialTier ?? this.#maxTier
    if (tierIndex(this.#tier) > tierIndex(this.#maxTier)) this.#tier = this.#maxTier
  }

  get tier(): AiQualityTier { return this.#tier }

  get onTierChange(): (listener: (tier: AiQualityTier) => void) => () => void {
    return (listener) => {
      this.#listeners.add(listener)
      return () => this.#listeners.delete(listener)
    }
  }

  async calibrate(_device: GPUDevice, _width: number, _height: number): Promise<AiQualityTier> {
    return this.#tier
  }

  record(stageMs: number, budgetMs: number): void {
    if (this.#closed || this.#frozen || !Number.isFinite(stageMs) || !Number.isFinite(budgetMs) || budgetMs <= 0) return
    this.#samples.push(Math.max(0, stageMs / budgetMs))
    if (this.#samples.length > this.#windowSize) this.#samples.shift()
    if (this.#samples.length < this.#windowSize) return
    const median = [...this.#samples].sort((left, right) => left - right)[Math.floor(this.#samples.length / 2)] ?? 0
    const now = this.#now()
    if (median > 0.85) {
      this.#underBudgetSince = null
      this.#degrade('budget-exceeded')
      return
    }
    if (median < 0.5) {
      this.#underBudgetSince ??= now
      if (now - this.#underBudgetSince >= this.#recoveryMs && now - this.#lastRecoveryAt >= this.#recoveryCooldownMs) {
        this.#recover('budget-recovered')
        this.#lastRecoveryAt = now
        this.#underBudgetSince = now
      }
    } else {
      this.#underBudgetSince = null
    }
  }

  freeze(): void { this.#frozen = true; this.#samples = []; this.#underBudgetSince = null }
  resume(): void { this.#frozen = false; this.#samples = []; this.#underBudgetSince = null }
  setDeviceLost(): void { this.#setTier('off') }
  close(): void { this.#closed = true; this.#listeners.clear(); this.#samples = [] }

  #degrade(_reason: string): void {
    if (this.#tier === 'off') return
    this.#setTier(TIER_ORDER[Math.max(0, tierIndex(this.#tier) - 1)] ?? 'off')
  }

  #recover(_reason: string): void {
    if (tierIndex(this.#tier) >= tierIndex(this.#maxTier)) return
    this.#setTier(TIER_ORDER[tierIndex(this.#tier) + 1] ?? this.#maxTier)
  }

  #setTier(next: AiQualityTier): void {
    if (next === this.#tier || this.#closed) return
    this.#tier = next
    this.#samples = []
    this.#underBudgetSince = null
    for (const listener of [...this.#listeners]) listener(next)
  }
}

export function createFrameBudgetGovernor(options: FrameBudgetGovernorOptions = {}): DefaultFrameBudgetGovernor {
  return new DefaultFrameBudgetGovernor(options)
}

function tierIndex(tier: AiQualityTier): number { return TIER_ORDER.indexOf(tier) }
function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, Math.floor(value)))
}

/**
 * Degrade policy, applied by the governor's internal loop:
 *
 *   DEGRADE FAST  — 30-frame median > 85% of budget → drop tier immediately.
 *                  Disable interpolation before super-resolution.
 *   RECOVER SLOW  — 10 seconds below 50% budget → raise one tier.
 *                  Max one step per 30 seconds to prevent oscillation.
 *   SEEK PAUSE    — Never degrade during a seek.
 *   BUDGET RATIO  — 60% of `1000 / displayHz` as default.
 */
