import type { CapabilitySnapshot, CapabilitySupport, MediaCapabilityReport } from '@mx-player-max/types'
import { CAPABILITY_SCHEMA_VERSION, type CapabilityCache } from './contracts'

const memoryEntries = new Map<string, unknown>()

export const defaultCapabilityCache: CapabilityCache = {
  get<T>(key: string): T | undefined {
    const memoryValue = memoryEntries.get(key)
    if (memoryValue !== undefined) return memoryValue as T
    const storage = getSessionStorage()
    if (!storage) return undefined
    try {
      const raw = storage.getItem(key)
      if (raw === null) return undefined
      const value = revive(JSON.parse(raw)) as T
      memoryEntries.set(key, value)
      return value
    } catch {
      return undefined
    }
  },
  set<T>(key: string, value: T): void {
    memoryEntries.set(key, value)
    const storage = getSessionStorage()
    if (!storage) return
    try {
      storage.setItem(key, JSON.stringify(encode(value)))
    } catch {
      // Storage is an optimization. Private browsing and quota failures fall back to memory.
    }
  },
}

export function makeCacheKey(prefix: string, sdkVersion: string, ...parts: unknown[]): string {
  return `mx-player-max:${prefix}:v${CAPABILITY_SCHEMA_VERSION}:${sdkVersion}:${stableStringify(parts)}`
}

export function readCache<T>(
  cache: CapabilityCache,
  key: string,
  validate: (value: unknown) => value is T,
): T | undefined {
  try {
    const value = cache.get<unknown>(key)
    return validate(value) ? cloneSerializable(value) : undefined
  } catch {
    return undefined
  }
}

export function writeCache<T>(cache: CapabilityCache, key: string, value: T): void {
  try {
    cache.set(key, cloneSerializable(value))
  } catch {
    // Custom cache failures must not make capability detection fail.
  }
}

export function isCapabilitySnapshot(value: unknown): value is CapabilitySnapshot {
  if (!isRecord(value)) return false
  return value.schemaVersion === CAPABILITY_SCHEMA_VERSION
    && typeof value.sdkVersion === 'string'
    && isBrowser(value.browser)
    && (typeof value.browserVersion === 'string' || value.browserVersion === null)
    && isOperatingSystem(value.platform)
    && typeof value.crossOriginIsolated === 'boolean'
    && typeof value.sharedArrayBuffer === 'boolean'
    && typeof value.wasmSimd === 'boolean'
    && typeof value.wasmThreads === 'boolean'
    && typeof value.htmlVideo === 'boolean'
    && typeof value.mediaCapabilities === 'boolean'
    && typeof value.webGpu === 'boolean'
    && typeof value.webCodecsVideo === 'boolean'
    && typeof value.webCodecsAudio === 'boolean'
    && typeof value.webGl2 === 'boolean'
    && typeof value.canvas2d === 'boolean'
    && typeof value.workerMediaSource === 'boolean'
    && isWebGpuFeatureSnapshot(value.webGpuFeatures)
    && Array.isArray(value.quirks)
    && value.quirks.every((quirk) => typeof quirk === 'string')
}

export function isMediaCapabilityReport(value: unknown): value is MediaCapabilityReport {
  if (!isRecord(value) || value.schemaVersion !== CAPABILITY_SCHEMA_VERSION) return false
  if (!isMediaQuery(value.query) || !isRecord(value.native) || !isRecord(value.webCodecs)) return false
  return isCapabilitySupport(value.native.playable)
    && isCapabilitySupport(value.webCodecs.playable)
    && isTrackCapability(value.native.video)
    && isTrackCapability(value.native.audio)
    && isWebCodecsCapability(value.webCodecs.video)
    && isWebCodecsCapability(value.webCodecs.audio)
}

export function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function isCapabilitySupport(value: unknown): value is CapabilitySupport {
  return value === 'supported' || value === 'unsupported' || value === 'unknown'
}

function isBrowser(value: unknown): value is CapabilitySnapshot['browser'] {
  return value === 'chromium' || value === 'webkit' || value === 'gecko' || value === 'unknown'
}

function isOperatingSystem(value: unknown): value is CapabilitySnapshot['platform'] {
  return value === 'windows' || value === 'macos' || value === 'linux'
    || value === 'android' || value === 'ios' || value === 'unknown'
}

function isWebGpuFeatureSnapshot(value: unknown): boolean {
  if (!isRecord(value)) return false
  return typeof value.available === 'boolean'
    && typeof value.float32Filterable === 'boolean'
    && typeof value.shaderF16 === 'boolean'
    && typeof value.maxComputeWorkgroupStorageSize === 'number'
    && typeof value.maxTextureDimension2d === 'number'
    && typeof value.maxBufferSize === 'number'
    && typeof value.importExternalTexture === 'boolean'
    && (typeof value.adapterVendor === 'string' || value.adapterVendor === null)
    && (typeof value.adapterArchitecture === 'string' || value.adapterArchitecture === null)
    && typeof value.isFallbackAdapter === 'boolean'
}

function isTrackCapability(value: unknown): boolean {
  if (!isRecord(value) || !isCapabilitySupport(value.status) || !Array.isArray(value.reasons)) return false
  return typeof value.contentType === 'string' || value.contentType === null
}

function isWebCodecsCapability(value: unknown): boolean {
  if (!isRecord(value) || !isCapabilitySupport(value.status) || !Array.isArray(value.reasons)) return false
  return typeof value.configPresent === 'boolean'
}

function isMediaQuery(value: unknown): boolean {
  if (!isRecord(value) || typeof value.container !== 'string') return false
  if (value.mimeType !== null && typeof value.mimeType !== 'string') return false
  return isCodecConfig(value.video) && isCodecConfig(value.audio)
}

function isCodecConfig(value: unknown): boolean {
  return value === null || (isRecord(value) && typeof value.codec === 'string')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function stableStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value))
}

function cloneSerializable<T>(value: T): T {
  return revive(encode(value)) as T
}

function canonicalize(value: unknown): unknown {
  if (value instanceof ArrayBuffer) return { __arrayBuffer: [...new Uint8Array(value)] }
  if (Array.isArray(value)) return value.map((entry) => canonicalize(entry))
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return Object.fromEntries(Object.keys(record).sort().map((key) => [key, canonicalize(record[key])]))
  }
  return value
}

function encode(value: unknown): unknown {
  return canonicalize(value)
}

function revive(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => revive(entry))
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    if (Array.isArray(record.__arrayBuffer) && record.__arrayBuffer.every((entry) => typeof entry === 'number')) {
      return new Uint8Array(record.__arrayBuffer).buffer
    }
    return Object.fromEntries(Object.entries(record).map(([key, entry]) => [key, revive(entry)]))
  }
  return value
}

function getSessionStorage(): Storage | undefined {
  try {
    return typeof sessionStorage === 'undefined' ? undefined : sessionStorage
  } catch {
    return undefined
  }
}
