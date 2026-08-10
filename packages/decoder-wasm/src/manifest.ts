import type { WasmDecoderManifest, WasmDecoderReview, WasmVariant } from './contracts'
import { createWasmError } from './errors'
import { ErrorCodes } from '@mx-player-max/types'

const VARIANTS: readonly WasmVariant[] = ['threaded', 'simd', 'single']
const BIT_DEPTHS: readonly (8 | 10 | 12)[] = [8, 10, 12]
const MAX_STRING_LENGTH = 4096
const MAX_LIST_LENGTH = 128
const MANIFEST_FIELDS: ReadonlySet<string> = new Set([
  'codec',
  'version',
  'variants',
  'sha256',
  'sizeBytes',
  'supportsVideo',
  'supportsAudio',
  'profiles',
  'levels',
  'pixelFormats',
  'bitDepths',
  'license',
  'upstream',
  'compiler',
  'buildFlags',
  'patentRisk',
  'review',
])
const REVIEW_FIELDS: ReadonlySet<string> = new Set(['status', 'notes'])

export function validateWasmDecoderManifest(value: unknown): WasmDecoderManifest {
  if (!isRecord(value)) throw invalid('WASM manifest must be an object')
  assertKnownKeys(value, MANIFEST_FIELDS, 'manifest')

  const codec = readCodec(value.codec)
  const version = readString(value.version, 'version')
  const variants = readPathMap(value.variants, 'variants')
  const sha256 = readHashMap(value.sha256)
  const sizeBytes = value.sizeBytes === undefined ? undefined : readSizeMap(value.sizeBytes)
  for (const variant of Object.keys(variants) as WasmVariant[]) {
    if (!sha256[variant]) throw invalid(`Missing SHA-256 for ${variant} variant`)
  }
  for (const variant of Object.keys(sha256) as WasmVariant[]) {
    if (!variants[variant]) throw invalid(`SHA-256 has no ${variant} variant`)
  }
  if (sizeBytes !== undefined) {
    for (const variant of Object.keys(sizeBytes) as WasmVariant[]) {
      if (!variants[variant]) throw invalid(`sizeBytes has no ${variant} variant`)
    }
  }
  if (Object.keys(variants).length === 0) throw invalid('WASM manifest must declare a variant')

  const supportsVideo = readBoolean(value.supportsVideo, 'supportsVideo')
  const supportsAudio = readBoolean(value.supportsAudio, 'supportsAudio')
  if (!supportsVideo && !supportsAudio) throw invalid('WASM manifest must support video or audio')
  const profiles = readStringList(value.profiles, 'profiles')
  const levels = readStringList(value.levels, 'levels')
  const pixelFormats = readStringList(value.pixelFormats, 'pixelFormats')
  const bitDepths = readBitDepths(value.bitDepths)
  const license = readString(value.license, 'license')
  const upstream = readString(value.upstream, 'upstream')
  const compiler = readString(value.compiler, 'compiler')
  const buildFlags = readString(value.buildFlags, 'buildFlags')
  const patentRisk = readString(value.patentRisk, 'patentRisk')
  const review = value.review === undefined ? undefined : readReview(value.review)

  return Object.freeze({
    codec,
    version,
    variants,
    sha256,
    ...(sizeBytes === undefined ? {} : { sizeBytes }),
    supportsVideo,
    supportsAudio,
    ...(profiles === undefined ? {} : { profiles }),
    ...(levels === undefined ? {} : { levels }),
    ...(pixelFormats === undefined ? {} : { pixelFormats }),
    ...(bitDepths === undefined ? {} : { bitDepths }),
    license,
    upstream,
    compiler,
    buildFlags,
    patentRisk,
    ...(review === undefined ? {} : { review }),
  })
}

export function isWasmDecoderManifest(value: unknown): value is WasmDecoderManifest {
  try {
    validateWasmDecoderManifest(value)
    return true
  } catch {
    return false
  }
}

export function normalizeWasmCodec(codec: string): string {
  if (typeof codec !== 'string') throw invalid('WASM codec must be a string')
  const normalized = codec.trim().toLowerCase()
  if (normalized.length === 0 || normalized.length > MAX_STRING_LENGTH) throw invalid('Invalid WASM codec')
  return normalized
}

function readCodec(value: unknown): string {
  return normalizeWasmCodec(readString(value, 'codec'))
}

function readString(value: unknown, field: string): string {
  if (typeof value !== 'string') throw invalid(`Invalid WASM manifest ${field}`)
  const result = value.trim()
  if (result.length === 0 || result.length > MAX_STRING_LENGTH) throw invalid(`Invalid WASM manifest ${field}`)
  return result
}

function readBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw invalid(`Invalid WASM manifest ${field}`)
  return value
}

function readPathMap(value: unknown, field: string): Readonly<Partial<Record<WasmVariant, string>>> {
  if (!isRecord(value)) throw invalid(`Invalid WASM manifest ${field}`)
  const result: Partial<Record<WasmVariant, string>> = {}
  for (const key of Object.keys(value)) {
    if (!VARIANTS.includes(key as WasmVariant)) throw invalid(`Unknown WASM variant: ${key}`)
    result[key as WasmVariant] = readString(value[key], `${field}.${key}`)
  }
  return Object.freeze(result)
}

function readHashMap(value: unknown): Readonly<Partial<Record<WasmVariant, string>>> {
  if (!isRecord(value)) throw invalid('Invalid WASM manifest sha256')
  const result: Partial<Record<WasmVariant, string>> = {}
  for (const key of Object.keys(value)) {
    if (!VARIANTS.includes(key as WasmVariant)) throw invalid(`Unknown WASM SHA-256 variant: ${key}`)
    const hash = value[key]
    if (typeof hash !== 'string' || !/^[a-f0-9]{64}$/i.test(hash)) throw invalid(`Invalid SHA-256 for ${key} variant`)
    result[key as WasmVariant] = hash.toLowerCase()
  }
  return Object.freeze(result)
}

function readSizeMap(value: unknown): Readonly<Partial<Record<WasmVariant, number>>> {
  if (!isRecord(value)) throw invalid('Invalid WASM manifest sizeBytes')
  const result: Partial<Record<WasmVariant, number>> = {}
  for (const key of Object.keys(value)) {
    if (!VARIANTS.includes(key as WasmVariant)) throw invalid(`Unknown WASM size variant: ${key}`)
    const size = value[key]
    if (typeof size !== 'number' || !Number.isSafeInteger(size) || size <= 0) throw invalid(`Invalid sizeBytes for ${key} variant`)
    result[key as WasmVariant] = size
  }
  return Object.freeze(result)
}

function readStringList(value: unknown, field: string): readonly string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length > MAX_LIST_LENGTH) throw invalid(`Invalid WASM manifest ${field}`)
  const result: string[] = []
  for (const entry of value) {
    const item = readString(entry, `${field} entry`)
    if (!result.includes(item)) result.push(item)
  }
  return Object.freeze(result)
}

function readBitDepths(value: unknown): readonly (8 | 10 | 12)[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length > BIT_DEPTHS.length) throw invalid('Invalid WASM manifest bitDepths')
  const result: (8 | 10 | 12)[] = []
  for (const entry of value) {
    if (!BIT_DEPTHS.includes(entry as 8 | 10 | 12)) throw invalid('Invalid WASM manifest bit depth')
    const depth = entry as 8 | 10 | 12
    if (!result.includes(depth)) result.push(depth)
  }
  return Object.freeze(result)
}

function readReview(value: unknown): WasmDecoderReview {
  if (!isRecord(value)) throw invalid('Invalid WASM manifest review')
  assertKnownKeys(value, REVIEW_FIELDS, 'review')
  const status = value.status
  if (status !== 'approved' && status !== 'restricted' && status !== 'pending') throw invalid('Invalid WASM review status')
  const notes = value.notes === undefined ? undefined : readString(value.notes, 'review.notes')
  return Object.freeze(notes === undefined ? { status } : { status, notes })
}

function assertKnownKeys(value: Record<string, unknown>, fields: ReadonlySet<string>, label: string): void {
  for (const key of Object.keys(value)) {
    if (!fields.has(key)) throw invalid(`Unknown WASM ${label} field: ${key}`)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function invalid(message: string): ReturnType<typeof createWasmError> {
  return createWasmError(ErrorCodes.WASM_MANIFEST_INVALID, message, false)
}
