import type { AiQualityTier } from '@mx-player-max/types'

export type ModelPrecision = 'f32' | 'f16'
export type AiModelFormat = 'mxai' | 'pytorch-zip' | 'pytorch-pth'

export type AiAssetReviewStatus = 'approved' | 'restricted' | 'pending'

export interface AiAssetReview {
  readonly status: AiAssetReviewStatus
  readonly reviewer?: string
  readonly reviewedAt?: string
  readonly notes?: string
}

/**
 * Mirror of the {@link WasmDecoderManifest} shape from decoder-wasm so that
 * model-weight loading, caching, hash-verification, and license review all
 * share the same delivery strategy.
 *
 * @see docs/architecture/wasm-and-distribution.md
 */
export interface AiModelManifest {
  /** Canonical model name: 'rt4ksr-x2' | 'rife-v4.25' | 'anime4k-cnnx2-ul' */
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
  readonly format?: AiModelFormat
  /** Explicit legal review gate. Missing means pending. */
  readonly review?: AiAssetReview
}

const MODEL_NAMES = new Set(['rt4ksr-x2', 'rife-v4.6', 'rife-v4.25', 'anime4k-cnnx2-ul'])
const PRECISIONS: readonly ModelPrecision[] = ['f32', 'f16']

export function validateAiModelManifest(value: unknown): AiModelManifest {
  if (!isRecord(value)) throw new Error('AI manifest must be an object')
  const model = readString(value.model, 'model')
  if (!MODEL_NAMES.has(model)) throw new Error(`Unsupported AI model: ${model}`)
  const version = readString(value.version, 'version')
  const tier = readTier(value.tier)
  const variants = readPrecisionMap(value.variants, 'variants', false)
  const sha256 = readPrecisionMap(value.sha256, 'sha256', true)
  if (Object.keys(variants).length === 0) throw new Error('AI manifest must declare a model variant')
  for (const precision of Object.keys(variants) as ModelPrecision[]) {
    if (!sha256[precision]) throw new Error(`Missing SHA-256 for ${precision} variant`)
  }
  const license = readString(value.license, 'license')
  const upstream = readString(value.upstream, 'upstream')
  const buildFlags = readString(value.buildFlags, 'buildFlags')
  const patentRisk = readString(value.patentRisk, 'patentRisk')
  const requiredFeatures = readFeatureList(value.requiredFeatures)
  const format = value.format === undefined ? undefined : readFormat(value.format)
  const review = value.review === undefined ? undefined : readReview(value.review)
  return {
    model,
    version,
    tier,
    variants,
    sha256,
    license,
    upstream,
    buildFlags,
    patentRisk,
    requiredFeatures,
    ...(format === undefined ? {} : { format }),
    ...(review === undefined ? {} : { review }),
  }
}

function readFormat(value: unknown): AiModelFormat {
  if (value === 'mxai' || value === 'pytorch-zip' || value === 'pytorch-pth') return value
  throw new Error('Invalid AI manifest format')
}

export function isAiModelManifest(value: unknown): value is AiModelManifest {
  try {
    validateAiModelManifest(value)
    return true
  } catch {
    return false
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096) throw new Error(`Invalid AI manifest ${field}`)
  return value
}

function readTier(value: unknown): AiQualityTier {
  if (value === 'off' || value === 'low' || value === 'medium' || value === 'high' || value === 'ultra') return value
  throw new Error('Invalid AI manifest tier')
}

function readPrecisionMap(value: unknown, field: string, digest: boolean): Partial<Record<ModelPrecision, string>> {
  if (!isRecord(value)) throw new Error(`Invalid AI manifest ${field}`)
  const result: Partial<Record<ModelPrecision, string>> = {}
  for (const precision of PRECISIONS) {
    const entry = value[precision]
    if (entry === undefined) continue
    if (typeof entry !== 'string' || entry.length === 0 || entry.length > 4096) throw new Error(`Invalid ${field}.${precision}`)
    if (digest && !/^[a-f0-9]{64}$/i.test(entry)) throw new Error(`Invalid SHA-256 for ${precision} variant`)
    result[precision] = entry
  }
  for (const key of Object.keys(value)) {
    if (!PRECISIONS.includes(key as ModelPrecision)) throw new Error(`Unknown ${field} precision: ${key}`)
  }
  return result
}

function readFeatureList(value: unknown): readonly GPUFeatureName[] {
  if (!Array.isArray(value) || value.length > 32) throw new Error('Invalid AI manifest requiredFeatures')
  const features: GPUFeatureName[] = []
  for (const feature of value) {
    if (typeof feature !== 'string' || feature.length === 0 || feature.length > 128) throw new Error('Invalid AI manifest GPU feature')
    if (!features.includes(feature as GPUFeatureName)) features.push(feature as GPUFeatureName)
  }
  return features
}

function readReview(value: unknown): AiAssetReview {
  if (!isRecord(value)) throw new Error('Invalid AI manifest review')
  const status = value.status
  if (status !== 'approved' && status !== 'restricted' && status !== 'pending') throw new Error('Invalid AI manifest review status')
  const reviewer = value.reviewer === undefined ? undefined : readString(value.reviewer, 'reviewer')
  const reviewedAt = value.reviewedAt === undefined ? undefined : readString(value.reviewedAt, 'reviewedAt')
  const notes = value.notes === undefined ? undefined : readString(value.notes, 'notes')
  return {
    status,
    ...(reviewer === undefined ? {} : { reviewer }),
    ...(reviewedAt === undefined ? {} : { reviewedAt }),
    ...(notes === undefined ? {} : { notes }),
  }
}
