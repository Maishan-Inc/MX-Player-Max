import { ErrorCodes } from '@mx-player-max/types'
import type {
  WasmAssetLoadOptions,
  WasmDecoderAssetCache,
  WasmDecoderManifest,
  VerifiedWasmAssetLoaderLike,
  VerifiedWasmAssetLoaderOptions,
  VerifiedWasmAsset,
  WasmVariant,
} from './contracts'
import { createWasmCacheKey } from './cache'
import { createWasmError, isWasmAbort } from './errors'
import { validateWasmDecoderManifest } from './manifest'

interface InFlightAsset {
  readonly controller: AbortController
  promise: Promise<VerifiedWasmAsset>
  consumers: number
  settled: boolean
}

interface StandaloneLoaderEntry {
  readonly loader: VerifiedWasmAssetLoader
  consumers: number
}

const standaloneLoaders = new Map<string, StandaloneLoaderEntry>()
const standaloneObjectIds = new WeakMap<object, number>()
let standaloneObjectSequence = 0

export class VerifiedWasmAssetLoader implements VerifiedWasmAssetLoaderLike {
  readonly #baseUrl: string
  readonly #fetcher: typeof fetch | undefined
  readonly #cache: WasmDecoderAssetCache | undefined
  readonly #failedAssets = new Set<string>()
  readonly #inFlight = new Map<string, InFlightAsset>()
  #closed = false

  constructor(options: VerifiedWasmAssetLoaderOptions) {
    this.#baseUrl = options.baseUrl
    this.#fetcher = options.fetcher ?? (typeof globalThis.fetch === 'function' ? globalThis.fetch : undefined)
    this.#cache = options.cache
  }

  async load(
    pluginId: string,
    rawManifest: WasmDecoderManifest | unknown,
    variant: WasmVariant,
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<VerifiedWasmAsset> {
    if (this.#closed) throw createWasmError(ErrorCodes.WASM_CLOSED, 'The WASM asset loader is closed', false)
    throwIfAborted(options.signal)
    const manifest = validateWasmDecoderManifest(rawManifest)
    const relativePath = manifest.variants[variant]
    const expectedHash = manifest.sha256[variant]
    if (relativePath === undefined || expectedHash === undefined) {
      throw createWasmError(ErrorCodes.WASM_VARIANT_UNAVAILABLE, `WASM manifest has no ${variant} variant`, false)
    }
    const url = resolveWasmAssetUrl(this.#baseUrl, relativePath)
    const key = createWasmCacheKey(pluginId, manifest.codec, manifest.version, variant, expectedHash, url)
    if (this.#failedAssets.has(key) || this.#cache?.hasFailed(key) === true) {
      throw createWasmError(ErrorCodes.WASM_HASH_MISMATCH, 'The WASM asset previously failed verification', false)
    }
    let entry = this.#inFlight.get(key)
    if (entry === undefined) {
      const controller = new AbortController()
      entry = { controller, promise: Promise.resolve(null as never), consumers: 0, settled: false }
      const activeEntry = entry
      activeEntry.promise = loadAsset(manifest, variant, {
        baseUrl: this.#baseUrl,
        pluginId,
        signal: controller.signal,
        ...(this.#cache === undefined ? {} : { cache: this.#cache }),
        ...(this.#fetcher === undefined ? {} : { fetcher: this.#fetcher }),
      }, url, key, expectedHash, this.#failedAssets).finally(() => {
        activeEntry.settled = true
        if (this.#inFlight.get(key) === activeEntry) this.#inFlight.delete(key)
      })
      this.#inFlight.set(key, activeEntry)
    }
    entry.consumers += 1
    try {
      return await waitForAsset(entry.promise, options.signal)
    } finally {
      entry.consumers -= 1
      if (!entry.settled && entry.consumers === 0) entry.controller.abort()
    }
  }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    for (const entry of this.#inFlight.values()) entry.controller.abort()
    this.#inFlight.clear()
  }
}

export function createVerifiedWasmAssetLoader(options: VerifiedWasmAssetLoaderOptions): VerifiedWasmAssetLoader {
  return new VerifiedWasmAssetLoader(options)
}

export async function loadVerifiedWasmAsset(
  rawManifest: WasmDecoderManifest | unknown,
  variant: WasmVariant,
  options: Omit<WasmAssetLoadOptions, 'manifest' | 'variant'>,
): Promise<VerifiedWasmAsset> {
  const { entry, key } = getStandaloneLoader(options)
  entry.consumers += 1
  try {
    return await entry.loader.load(
      options.pluginId,
      rawManifest,
      variant,
      options.signal === undefined ? {} : { signal: options.signal },
    )
  } finally {
    entry.consumers -= 1
    if (entry.consumers === 0 && standaloneLoaders.get(key) === entry) {
      entry.loader.close()
      standaloneLoaders.delete(key)
    }
  }
}

function getStandaloneLoader(options: Omit<WasmAssetLoadOptions, 'manifest' | 'variant'>): {
  readonly entry: StandaloneLoaderEntry
  readonly key: string
} {
  const key = [
    options.baseUrl,
    objectIdentity(options.fetcher),
    objectIdentity(options.cache),
  ].join('|')
  const existing = standaloneLoaders.get(key)
  if (existing !== undefined) return { entry: existing, key }
  const loader = createVerifiedWasmAssetLoader({
    baseUrl: options.baseUrl,
    ...(options.fetcher === undefined ? {} : { fetcher: options.fetcher }),
    ...(options.cache === undefined ? {} : { cache: options.cache }),
  })
  const entry = { loader, consumers: 0 }
  standaloneLoaders.set(key, entry)
  return { entry, key }
}

function objectIdentity(value: object | undefined): string {
  if (value === undefined) return 'default'
  const existing = standaloneObjectIds.get(value)
  if (existing !== undefined) return String(existing)
  standaloneObjectSequence += 1
  standaloneObjectIds.set(value, standaloneObjectSequence)
  return String(standaloneObjectSequence)
}

export function resolveWasmAssetUrl(baseUrl: string, relativePath: string): string {
  if (typeof baseUrl !== 'string' || typeof relativePath !== 'string') throw invalidUrl()
  let base: URL
  try {
    base = new URL(baseUrl)
  } catch {
    throw invalidUrl()
  }
  if ((base.protocol !== 'https:' && base.protocol !== 'http:') || base.username !== '' || base.password !== '') throw invalidUrl()
  if (base.hash !== '') throw invalidUrl()
  if (!base.pathname.endsWith('/')) base.pathname += '/'
  let resolved: URL
  try {
    resolved = new URL(relativePath, base)
  } catch {
    throw invalidUrl()
  }
  if (
    resolved.protocol !== base.protocol
    || resolved.origin !== base.origin
    || resolved.username !== ''
    || resolved.password !== ''
    || resolved.hash !== ''
    || !isUnderBasePath(resolved.pathname, base.pathname)
  ) throw invalidUrl()
  return resolved.href
}

export async function digestWasmSha256(bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle
  if (subtle === undefined) throw createWasmError(ErrorCodes.WASM_INSTANTIATE_FAILED, 'Web Crypto SHA-256 is unavailable', false)
  const copy = bytes.slice()
  let digest: ArrayBuffer
  try {
    digest = await subtle.digest('SHA-256', copy)
  } catch {
    throw createWasmError(ErrorCodes.WASM_INSTANTIATE_FAILED, 'Web Crypto SHA-256 failed', false)
  }
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('')
}

async function loadAsset(
  manifest: WasmDecoderManifest,
  variant: WasmVariant,
  options: Omit<WasmAssetLoadOptions, 'manifest' | 'variant'>,
  url: string,
  key: string,
  expectedHash: string,
  failedAssets: Set<string>,
): Promise<VerifiedWasmAsset> {
  const signal = options.signal
  throwIfAborted(signal)
  const cache = options.cache
  let cached: Uint8Array | null = null
  if (cache !== undefined) {
    try {
      cached = await cache.get(key)
    } catch (cause) {
      throw createWasmError(ErrorCodes.WASM_CACHE_FAILED, 'The WASM cache could not be read', true, { cause })
    }
  }
  if (cached !== null) {
    const actualHash = await digestWasmSha256(cached)
    if (actualHash !== expectedHash.toLowerCase()) return failHash(cache, failedAssets, key)
    throwIfAborted(signal)
    verifySize(manifest, variant, cached)
    return { manifest, variant, url, bytes: cached.slice() }
  }

  const fetcher = options.fetcher ?? globalThis.fetch
  if (typeof fetcher !== 'function') throw createWasmError(ErrorCodes.WASM_FETCH_FAILED, 'The WASM fetch API is unavailable', false)
  let response: Response
  try {
    response = await fetcher(url, signal === undefined ? { redirect: 'error' } : { signal, redirect: 'error' })
  } catch (cause) {
    if (isWasmAbort(cause, signal)) throw createWasmError(ErrorCodes.WASM_ABORTED, 'The WASM asset request was aborted', true)
    throw createWasmError(ErrorCodes.WASM_FETCH_FAILED, 'The WASM asset request failed', true)
  }
  if (response.redirected) throw createWasmError(ErrorCodes.WASM_URL_INVALID, 'The WASM asset response was redirected', false)
  if (!response.ok) throw createWasmError(ErrorCodes.WASM_FETCH_FAILED, `The WASM asset request returned HTTP ${response.status}`, true)
  let bytes: Uint8Array
  try {
    bytes = new Uint8Array(await response.arrayBuffer())
  } catch {
    throw createWasmError(ErrorCodes.WASM_FETCH_FAILED, 'The WASM asset response could not be read', true)
  }
  throwIfAborted(signal)
  verifySize(manifest, variant, bytes)
  const actualHash = await digestWasmSha256(bytes)
  if (actualHash !== expectedHash.toLowerCase()) return failHash(cache, failedAssets, key)
  if (cache !== undefined) {
    try {
      await cache.set(key, bytes)
    } catch (cause) {
      throw createWasmError(ErrorCodes.WASM_CACHE_FAILED, 'The WASM cache could not be written', true, { cause })
    }
  }
  return { manifest, variant, url, bytes: bytes.slice() }
}

function verifySize(manifest: WasmDecoderManifest, variant: WasmVariant, bytes: Uint8Array): void {
  const expectedSize = manifest.sizeBytes?.[variant]
  if (expectedSize !== undefined && expectedSize !== bytes.byteLength) {
    throw createWasmError(ErrorCodes.WASM_FETCH_FAILED, `The WASM ${variant} byte length does not match its manifest`, true)
  }
}

function failHash(cache: WasmDecoderAssetCache | undefined, failedAssets: Set<string>, key: string): never {
  failedAssets.add(key)
  cache?.markFailure(key)
  throw createWasmError(ErrorCodes.WASM_HASH_MISMATCH, 'The WASM asset SHA-256 does not match its manifest', true)
}

function waitForAsset(promise: Promise<VerifiedWasmAsset>, signal: AbortSignal | undefined): Promise<VerifiedWasmAsset> {
  if (signal === undefined) return promise.then(cloneVerifiedAsset)
  if (signal.aborted) return Promise.reject(createWasmError(ErrorCodes.WASM_ABORTED, 'The WASM asset request was aborted', true))
  return new Promise<VerifiedWasmAsset>((resolve, reject) => {
    const abort = (): void => reject(createWasmError(ErrorCodes.WASM_ABORTED, 'The WASM asset request was aborted', true))
    signal.addEventListener('abort', abort, { once: true })
    promise.then(
      (asset) => {
        signal.removeEventListener('abort', abort)
        resolve(cloneVerifiedAsset(asset))
      },
      (cause: unknown) => {
        signal.removeEventListener('abort', abort)
        reject(cause)
      },
    )
  })
}

function cloneVerifiedAsset(asset: VerifiedWasmAsset): VerifiedWasmAsset {
  return { ...asset, bytes: asset.bytes.slice() }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw createWasmError(ErrorCodes.WASM_ABORTED, 'The WASM asset request was aborted', true)
}

function isUnderBasePath(pathname: string, basePath: string): boolean {
  return pathname === basePath.slice(0, -1) || pathname.startsWith(basePath)
}

function invalidUrl(): ReturnType<typeof createWasmError> {
  return createWasmError(ErrorCodes.WASM_URL_INVALID, 'The WASM asset URL is invalid', false)
}
