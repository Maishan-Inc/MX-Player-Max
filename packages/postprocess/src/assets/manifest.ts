import type { AiQualityTier } from '@mx-player-max/types'

export type ModelPrecision = 'f32' | 'f16'

/**
 * Mirror of the {@link WasmDecoderManifest} shape from decoder-wasm so that
 * model-weight loading, caching, hash-verification, and license review all
 * share the same delivery strategy.
 *
 * @see docs/architecture/wasm-and-distribution.md
 */
export interface AiModelManifest {
  /** Canonical model name: 'rt4ksr-x2' | 'rife-v4.6' | 'anime4k-cnnx2-ul' */
  readonly model: string
  readonly version: string
  readonly tier: AiQualityTier
  /** URL paths keyed by precision variant. */
  readonly variants: Partial<Record<ModelPrecision, string>>
  /** SHA-256 digests keyed by precision variant. */
  readonly sha256: Partial<Record<ModelPrecision, string>>
  /** SPDX identifier or full license text. */
  readonly license: string
  /** Upstream repository URL + commit hash (mandated by AGENTS.md §5). */
  readonly upstream: string
  /** Compiler / export flags used to produce the weights. */
  readonly buildFlags: string
  /** Known patent risk summary (free-form; empty if none known). */
  readonly patentRisk: string
  /** WebGPU features the model requires at runtime. */
  readonly requiredFeatures: readonly GPUFeatureName[]
}
