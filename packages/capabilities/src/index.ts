import type { CapabilityContext, CapabilitySnapshot, MediaCapabilityReport, MediaDescriptor } from '@mx-player-max/types'
import {
  defaultCapabilityCache,
  isCapabilitySnapshot,
  isMediaCapabilityReport,
  isString,
  makeCacheKey,
  readCache,
  writeCache,
} from './cache'
import {
  DEFAULT_SDK_VERSION,
  type CapabilityProbeOptions,
  type MediaCapabilityProbeOptions,
} from './contracts'
import { createDefaultProbeAdapter } from './default-adapter'
import { probeEnvironmentSnapshot, readEnvironmentIdentity } from './environment'
import { createMediaCapabilityQuery, probeMediaReport } from './media-report'

export {
  CAPABILITY_SCHEMA_VERSION,
  DEFAULT_SDK_VERSION,
  type CapabilityCache,
  type CapabilityProbeAdapter,
  type CapabilityProbeOptions,
  type MediaCapabilityProbeOptions,
  type MediaDecodingQuery,
} from './contracts'
export { createDefaultProbeAdapter } from './default-adapter'

const pendingSnapshots = new Map<string, Promise<CapabilitySnapshot>>()
const pendingReports = new Map<string, Promise<MediaCapabilityReport>>()

export async function detectCapabilities(options: CapabilityProbeOptions = {}): Promise<CapabilitySnapshot> {
  const adapter = options.adapter ?? createDefaultProbeAdapter()
  const sdkVersion = options.sdkVersion ?? DEFAULT_SDK_VERSION
  const cache = options.cache ?? defaultCapabilityCache
  const identity = readEnvironmentIdentity(adapter)
  const environmentKey = makeCacheKey('snapshot-index', sdkVersion, identity)

  if (!options.forceRefresh) {
    const snapshotKey = readCache(cache, environmentKey, isString)
    const cached = snapshotKey ? readCache(cache, snapshotKey, isCapabilitySnapshot) : undefined
    if (cached !== undefined) return cached
    const pending = pendingSnapshots.get(environmentKey)
    if (pending) return pending
  }

  const task = probeEnvironmentSnapshot(adapter, sdkVersion)
  pendingSnapshots.set(environmentKey, task)
  try {
    const snapshot = await task
    const snapshotKey = makeCacheKey('snapshot', sdkVersion, {
      browser: snapshot.browser,
      browserVersion: snapshot.browserVersion,
      platform: snapshot.platform,
      crossOriginIsolated: snapshot.crossOriginIsolated,
      sharedArrayBuffer: snapshot.sharedArrayBuffer,
      webGpuFeatures: snapshot.webGpuFeatures,
    })
    writeCache(cache, snapshotKey, snapshot)
    writeCache(cache, environmentKey, snapshotKey)
    return snapshot
  } finally {
    pendingSnapshots.delete(environmentKey)
  }
}

export async function probeMediaCapabilities(
  media: MediaDescriptor,
  options: MediaCapabilityProbeOptions = {},
): Promise<MediaCapabilityReport> {
  const adapter = options.adapter ?? createDefaultProbeAdapter()
  const sdkVersion = options.sdkVersion ?? DEFAULT_SDK_VERSION
  const snapshot = options.snapshot ?? await detectCapabilities({ ...options, adapter, sdkVersion })
  const query = createMediaCapabilityQuery(media)
  const key = makeCacheKey('media', sdkVersion, snapshot, query)
  const cache = options.cache ?? defaultCapabilityCache

  if (!options.forceRefresh) {
    const cached = readCache(cache, key, isMediaCapabilityReport)
    if (cached !== undefined) return cached
    const pending = pendingReports.get(key)
    if (pending) return pending
  }

  const task = probeMediaReport(adapter, snapshot, query)
  pendingReports.set(key, task)
  try {
    const report = await task
    writeCache(cache, key, report)
    return report
  } finally {
    pendingReports.delete(key)
  }
}

export function createCapabilityContext(
  snapshot: CapabilitySnapshot,
  media: MediaCapabilityReport,
): CapabilityContext {
  return { snapshot, media }
}
