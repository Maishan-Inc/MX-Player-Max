import type { WasmDecoderAssetCache } from './contracts'

const CACHE_NAMESPACE = 'mx-player-max.invalid'

export function createMemoryWasmCache(): WasmDecoderAssetCache {
  const values = new Map<string, Uint8Array>()
  const failures = new Set<string>()
  return {
    async get(key) {
      const value = values.get(key)
      return value === undefined ? null : value.slice()
    },
    async set(key, bytes) {
      values.set(key, bytes.slice())
    },
    markFailure(key) {
      failures.add(key)
    },
    hasFailed(key) {
      return failures.has(key)
    },
  }
}

export function createCacheStorageWasmCache(cacheName = 'mx-wasm-v1'): WasmDecoderAssetCache | null {
  if (typeof caches === 'undefined') return null
  const failures = new Set<string>()
  let cachePromise: Promise<Cache> | null = null
  const open = (): Promise<Cache> => cachePromise ??= caches.open(cacheName)
  return {
    async get(key) {
      const response = await (await open()).match(cacheRequestUrl(key))
      return response === undefined ? null : new Uint8Array(await response.arrayBuffer())
    },
    async set(key, bytes) {
      const copy = bytes.slice()
      await (await open()).put(cacheRequestUrl(key), new Response(copy))
    },
    markFailure(key) {
      failures.add(key)
    },
    hasFailed(key) {
      return failures.has(key)
    },
  }
}

export function createWasmCacheKey(
  pluginId: string,
  codec: string,
  version: string,
  variant: string,
  sha256: string,
  url: string,
): string {
  return [pluginId, codec, version, variant, sha256, url].map((value) => encodeURIComponent(value)).join('|')
}

function cacheRequestUrl(key: string): string {
  return `https://${CACHE_NAMESPACE}/wasm/${encodeURIComponent(key)}`
}
