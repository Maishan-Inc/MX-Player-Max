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
 * Implementation deferred to phase 5.5 — only the interface contract
 * exists today.
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
