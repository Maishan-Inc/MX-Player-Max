import type {
  CapabilitySnapshot,
  TrackInfo,
  WasmDecoderDeclaration,
} from '@mx-player-max/types'
import { ErrorCodes } from '@mx-player-max/types'
import type {
  WasmDecoderAssetCache,
  WasmDecoderInstance,
  WasmDecoderLoadOptions,
  WasmDecoderManager,
  WasmDecoderManagerOptions,
  WasmDecoderPlugin,
  WasmDecoderPluginDescriptor,
  WasmDecoderRegistryLike,
  WasmDecoderRuntime,
} from './contracts'
import { createCacheStorageWasmCache, createWasmCacheKey, createMemoryWasmCache } from './cache'
import { createWasmError, isWasmAbort, isWasmDecoderError, type WasmDecoderAttempt } from './errors'
import { createVerifiedWasmAssetLoader, resolveWasmAssetUrl } from './loader'
import { normalizeWasmCodec, validateWasmDecoderManifest } from './manifest'
import { selectWasmVariants } from './variants'
import { WasmDecoderRegistry } from './registry'

const defaultRuntime: WasmDecoderRuntime = {
  async compile(bytes) {
    if (typeof WebAssembly === 'undefined' || typeof WebAssembly.compile !== 'function') {
      throw new Error('WebAssembly.compile is unavailable')
    }
    const copy = new Uint8Array(bytes.byteLength)
    copy.set(bytes)
    return WebAssembly.compile(copy.buffer as ArrayBuffer)
  },
}

export class DefaultWasmDecoderManager implements WasmDecoderManager {
  readonly #registry: WasmDecoderRegistryLike
  readonly #baseUrl: string
  readonly #fetcher: typeof fetch | undefined
  readonly #cache: WasmDecoderAssetCache
  readonly #runtime: WasmDecoderRuntime
  readonly #assetLoader: ReturnType<typeof createVerifiedWasmAssetLoader>
  readonly #requireApprovedReview: boolean
  readonly #managerAbort = new AbortController()
  readonly #failedAssets = new Set<string>()
  readonly #instances = new Set<WasmDecoderInstance>()
  #closed = false

  constructor(options: WasmDecoderManagerOptions) {
    this.#baseUrl = options.baseUrl
    this.#registry = options.registry ?? new WasmDecoderRegistry()
    this.#fetcher = options.fetcher ?? (typeof globalThis.fetch === 'function' ? globalThis.fetch : undefined)
    this.#cache = createManagerSessionCache(
      options.cache ?? createCacheStorageWasmCache() ?? createMemoryWasmCache(),
    )
    this.#runtime = options.runtime ?? defaultRuntime
    this.#assetLoader = createVerifiedWasmAssetLoader({
      baseUrl: this.#baseUrl,
      cache: this.#cache,
      ...(this.#fetcher === undefined ? {} : { fetcher: this.#fetcher }),
    })
    this.#requireApprovedReview = options.requireApprovedReview !== false
  }

  register(plugin: WasmDecoderPlugin): void {
    this.#ensureOpen()
    this.#registry.register(plugin)
  }

  unregister(id: string): boolean {
    this.#ensureOpen()
    return this.#registry.unregister(id)
  }

  list(): readonly WasmDecoderPluginDescriptor[] {
    return this.#registry.list()
  }

  declarations(): readonly WasmDecoderDeclaration[] {
    return this.#registry.declarations({ requireApprovedReview: this.#requireApprovedReview })
  }

  async load(
    codec: string,
    track: TrackInfo,
    capabilities: CapabilitySnapshot,
    options: WasmDecoderLoadOptions = {},
  ): Promise<WasmDecoderInstance> {
    this.#ensureOpen()
    const normalizedCodec = normalizeWasmCodec(codec)
    const plugins = this.#registry.resolve(normalizedCodec, track)
    if (plugins.length === 0) {
      throw createWasmError(ErrorCodes.WASM_PLUGIN_NOT_FOUND, `No WASM plugin supports ${normalizedCodec}`, false)
    }
    const linked = linkAbortSignals(this.#managerAbort.signal, options.signal)
    const attempts: WasmDecoderAttempt[] = []
    let eligiblePluginCount = 0
    let compatibleVariantCount = 0
    try {
      for (const plugin of plugins) {
        this.#ensureOpen()
        throwIfAborted(linked.signal)
        const manifest = validateWasmDecoderManifest(plugin.manifest)
        if (this.#requireApprovedReview && manifest.review?.status !== 'approved') {
          attempts.push({ pluginId: plugin.id, variant: null, code: ErrorCodes.WASM_REVIEW_REQUIRED, message: 'Plugin review is not approved' })
          continue
        }
        eligiblePluginCount += 1
        const variants = selectWasmVariants(manifest, capabilities)
        compatibleVariantCount += variants.length
        if (variants.length === 0) {
          attempts.push({ pluginId: plugin.id, variant: null, code: ErrorCodes.WASM_VARIANT_UNAVAILABLE, message: 'No compatible WASM variant is available' })
          continue
        }
        for (const variant of variants) {
          throwIfAborted(linked.signal)
          const key = this.#assetKey(plugin.id, manifest.codec, manifest.version, variant, manifest.sha256[variant], manifest.variants[variant])
          if (key !== null && this.#failedAssets.has(key)) {
            attempts.push({ pluginId: plugin.id, variant, code: ErrorCodes.WASM_ALL_VARIANTS_FAILED, message: 'Variant previously failed in this Manager session' })
            continue
          }
          try {
            const asset = await this.#assetLoader.load(plugin.id, manifest, variant, { signal: linked.signal })
            throwIfAborted(linked.signal)
            let module: WebAssembly.Module
            try {
              module = await this.#runtime.compile(asset.bytes)
            } catch (cause) {
              throw createWasmError(ErrorCodes.WASM_INSTANTIATE_FAILED, 'The WASM module could not be compiled', true, { cause })
            }
            throwIfAborted(linked.signal)
            let inner: WasmDecoderInstance
            try {
              inner = await plugin.create({
                variant,
                module,
                manifest,
                track,
                capabilities,
                signal: linked.signal,
              })
            } catch (cause) {
              if (isWasmAbort(cause, linked.signal)) throw createWasmError(ErrorCodes.WASM_ABORTED, 'The WASM plugin initialization was aborted', true)
              throw createWasmError(ErrorCodes.WASM_PLUGIN_INIT_FAILED, 'The WASM plugin could not create a decoder', true, { cause })
            }
            if (linked.signal.aborted) {
              try { inner.close() } catch { /* aborted initialization is best effort */ }
              throw createWasmError(ErrorCodes.WASM_ABORTED, 'The WASM plugin initialization was aborted', true)
            }
            validateInstance(inner, variant)
            let managed: WasmDecoderInstance
            managed = createManagedInstance(inner, plugin.id, manifest, variant, () => this.#instances.delete(managed))
            this.#instances.add(managed)
            return managed
          } catch (cause) {
            if (isWasmAbort(cause, linked.signal)) throw createWasmError(ErrorCodes.WASM_ABORTED, 'The WASM decoder load was aborted', true)
            const error = isWasmDecoderError(cause)
              ? cause
              : createWasmError(ErrorCodes.WASM_ALL_VARIANTS_FAILED, 'The WASM decoder variant failed', true)
            if (key !== null) this.#failedAssets.add(key)
            attempts.push({ pluginId: plugin.id, variant, code: error.code, message: error.message })
          }
        }
      }
      if (eligiblePluginCount === 0) {
        throw createWasmError(ErrorCodes.WASM_REVIEW_REQUIRED, 'No WASM plugin passed the asset review gate', false, { attempts })
      }
      if (compatibleVariantCount === 0) {
        throw createWasmError(ErrorCodes.WASM_VARIANT_UNAVAILABLE, 'No compatible WASM decoder variant is available', false, { attempts })
      }
      throw createWasmError(ErrorCodes.WASM_ALL_VARIANTS_FAILED, 'All matching WASM decoder candidates failed', false, { attempts })
    } finally {
      linked.cleanup()
    }
  }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    this.#managerAbort.abort()
    this.#assetLoader.close()
    for (const instance of [...this.#instances]) instance.close()
    this.#instances.clear()
  }

  #assetKey(
    pluginId: string,
    codec: string,
    version: string,
    variant: 'threaded' | 'simd' | 'single',
    expectedHash: string | undefined,
    relativePath: string | undefined,
  ): string | null {
    if (expectedHash === undefined || relativePath === undefined) return null
    try {
      const url = resolveWasmAssetUrl(this.#baseUrl, relativePath)
      return createWasmCacheKey(pluginId, codec, version, variant, expectedHash, url)
    } catch {
      return null
    }
  }

  #ensureOpen(): void {
    if (this.#closed) throw createWasmError(ErrorCodes.WASM_CLOSED, 'The WASM decoder Manager is closed', false)
  }
}

export function createWasmDecoderManager(options: WasmDecoderManagerOptions): DefaultWasmDecoderManager {
  return new DefaultWasmDecoderManager(options)
}

function validateInstance(instance: WasmDecoderInstance, variant: WasmDecoderInstance['variant']): void {
  if (
    typeof instance !== 'object'
    || instance === null
    || instance.variant !== variant
    || typeof instance.decode !== 'function'
    || typeof instance.flush !== 'function'
    || typeof instance.close !== 'function'
  ) {
    const candidate = instance as Partial<WasmDecoderInstance> | null
    if (typeof candidate?.close === 'function') {
      try { candidate.close() } catch { /* invalid plugin teardown is best effort */ }
    }
    throw createWasmError(ErrorCodes.WASM_PLUGIN_INIT_FAILED, 'The WASM plugin returned an invalid decoder instance', true)
  }
}

function createManagedInstance(
  inner: WasmDecoderInstance,
  pluginId: string,
  manifest: WasmDecoderInstance['manifest'],
  variant: WasmDecoderInstance['variant'],
  onClose: () => void,
): WasmDecoderInstance {
  let closed = false
  return {
    variant,
    pluginId,
    ...(manifest === undefined ? {} : { manifest }),
    decode(packet, timestamp, key) {
      if (closed) throw createWasmError(ErrorCodes.WASM_CLOSED, 'The WASM decoder instance is closed', false)
      inner.decode(packet, timestamp, key)
    },
    async flush() {
      if (closed) throw createWasmError(ErrorCodes.WASM_CLOSED, 'The WASM decoder instance is closed', false)
      await inner.flush()
    },
    close() {
      if (closed) return
      closed = true
      onClose()
      try { inner.close() } catch { /* decoder teardown is best effort */ }
    },
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw createWasmError(ErrorCodes.WASM_ABORTED, 'The WASM decoder load was aborted', true)
}

function linkAbortSignals(managerSignal: AbortSignal, callerSignal: AbortSignal | undefined): {
  signal: AbortSignal
  cleanup: () => void
} {
  const controller = new AbortController()
  const abort = (): void => controller.abort()
  if (managerSignal.aborted || callerSignal?.aborted === true) controller.abort()
  managerSignal.addEventListener('abort', abort, { once: true })
  callerSignal?.addEventListener('abort', abort, { once: true })
  return {
    signal: controller.signal,
    cleanup: () => {
      managerSignal.removeEventListener('abort', abort)
      callerSignal?.removeEventListener('abort', abort)
    },
  }
}

function createManagerSessionCache(cache: WasmDecoderAssetCache): WasmDecoderAssetCache {
  const failures = new Set<string>()
  return {
    get(key) {
      return cache.get(key)
    },
    set(key, bytes) {
      return cache.set(key, bytes)
    },
    markFailure(key) {
      failures.add(key)
    },
    hasFailed(key) {
      return failures.has(key)
    },
  }
}
