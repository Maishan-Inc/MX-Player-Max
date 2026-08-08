import type { AiModelManifest, ModelPrecision } from './manifest'
import { validateAiModelManifest } from './manifest'

export interface AiModelAsset {
  readonly manifest: AiModelManifest
  readonly precision: ModelPrecision
  readonly url: string
  readonly bytes: Uint8Array
}

export interface AiModelLoadOptions {
  readonly baseUrl: string
  readonly fetcher?: typeof fetch
  readonly cache?: AiModelCache
  readonly signal?: AbortSignal
  readonly requireApprovedReview?: boolean
}

export interface AiModelCache {
  get(key: string): Promise<Uint8Array | null>
  set(key: string, bytes: Uint8Array): Promise<void>
  markFailure(key: string): void
  hasFailed(key: string): boolean
}

const failedAssets = new Set<string>()

export function createMemoryAiModelCache(): AiModelCache {
  const values = new Map<string, Uint8Array>()
  const failures = new Set<string>()
  return {
    async get(key) {
      const value = values.get(key)
      return value ? value.slice() : null
    },
    async set(key, bytes) { values.set(key, bytes.slice()) },
    markFailure(key) { failures.add(key) },
    hasFailed(key) { return failures.has(key) },
  }
}

export function createCacheStorageAiModelCache(cacheName = 'mx-ai-models-v1'): AiModelCache | null {
  if (typeof caches === 'undefined') return null
  const failures = new Set<string>()
  let cachePromise: Promise<Cache> | null = null
  const open = (): Promise<Cache> => cachePromise ??= caches.open(cacheName)
  return {
    async get(key) {
      const response = await (await open()).match(`https://mx-player-max.invalid/${encodeURIComponent(key)}`)
      return response ? new Uint8Array(await response.arrayBuffer()) : null
    },
    async set(key, bytes) {
      const copy = new Uint8Array(bytes.byteLength)
      copy.set(bytes)
      await (await open()).put(`https://mx-player-max.invalid/${encodeURIComponent(key)}`, new Response(copy))
    },
    markFailure(key) { failures.add(key) },
    hasFailed(key) { return failures.has(key) },
  }
}

export async function loadAiModelAsset(
  rawManifest: AiModelManifest | unknown,
  precision: ModelPrecision,
  options: AiModelLoadOptions,
): Promise<AiModelAsset> {
  const manifest = validateAiModelManifest(rawManifest)
  if (options.requireApprovedReview !== false && manifest.review?.status !== 'approved') {
    throw new Error('AI model has not passed the required asset review gate')
  }
  const relativePath = manifest.variants[precision]
  const expectedHash = manifest.sha256[precision]
  if (!relativePath || !expectedHash) throw new Error(`AI model has no ${precision} variant`)
  const url = resolveAssetUrl(options.baseUrl, relativePath)
  const key = `${manifest.model}@${manifest.version}:${precision}:${expectedHash}`
  const cache = options.cache
  if (failedAssets.has(key) || cache?.hasFailed(key) === true) throw new Error('AI model asset previously failed verification')
  const cached = await cache?.get(key)
  if (cached) {
    if (await digestHex(cached) === expectedHash.toLowerCase()) return { manifest, precision, url, bytes: cached }
    cache?.markFailure(key)
    failedAssets.add(key)
    throw new Error('AI model cache hash mismatch')
  }
  const fetcher = options.fetcher ?? fetch
  let response: Response
  try {
    response = await fetcher(url, options.signal === undefined ? undefined : { signal: options.signal })
  } catch (cause) {
    throw new Error(`AI model fetch failed: ${String(cause)}`)
  }
  if (!response.ok) throw new Error(`AI model fetch failed with HTTP ${response.status}`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  const actualHash = await digestHex(bytes)
  if (actualHash !== expectedHash.toLowerCase()) {
    cache?.markFailure(key)
    failedAssets.add(key)
    throw new Error('AI model hash mismatch')
  }
  await cache?.set(key, bytes)
  return { manifest, precision, url, bytes }
}

export function resolveAssetUrl(baseUrl: string, relativePath: string): string {
  const base = new URL(baseUrl)
  if (base.protocol !== 'https:' && base.protocol !== 'http:') throw new Error('AI model base URL must use HTTP or HTTPS')
  const resolved = new URL(relativePath, base)
  if (resolved.protocol !== base.protocol || resolved.origin !== base.origin) throw new Error('AI model variant must remain under the configured base URL')
  return resolved.href
}

export async function digestHex(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', copy)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
