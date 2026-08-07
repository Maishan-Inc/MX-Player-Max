import type { CapabilitySnapshot, OperatingSystem, WebGpuFeatureSnapshot } from '@mx-player-max/types'
import { CAPABILITY_SCHEMA_VERSION, createFallbackGpuFeatures, type CapabilityProbeAdapter } from './contracts'

export interface EnvironmentIdentity {
  browser: CapabilitySnapshot['browser']
  browserVersion: string | null
  platform: OperatingSystem
  crossOriginIsolated: boolean
  sharedArrayBuffer: boolean
}

export function readEnvironmentIdentity(adapter: CapabilityProbeAdapter): EnvironmentIdentity {
  const userAgent = safeString(() => adapter.getUserAgent())
  const platform = safeString(() => adapter.getPlatform())
  return {
    browser: detectBrowser(userAgent),
    browserVersion: detectBrowserVersion(userAgent),
    platform: detectOperatingSystem(userAgent, platform),
    crossOriginIsolated: safeBoolean(() => adapter.isCrossOriginIsolated()),
    sharedArrayBuffer: safeBoolean(() => adapter.hasSharedArrayBuffer()),
  }
}

export async function probeEnvironmentSnapshot(
  adapter: CapabilityProbeAdapter,
  sdkVersion: string,
): Promise<CapabilitySnapshot> {
  const identity = readEnvironmentIdentity(adapter)
  const wasmSimd = safeBoolean(() => adapter.probeWasmSimd())
  const wasmThreads = identity.crossOriginIsolated
    && identity.sharedArrayBuffer
    && safeBoolean(() => adapter.probeWasmThreads())
  const webGpuFeatures = await safeGpuProbe(adapter)
  return {
    schemaVersion: CAPABILITY_SCHEMA_VERSION,
    sdkVersion,
    ...identity,
    wasmSimd,
    wasmThreads,
    htmlVideo: safeBoolean(() => adapter.hasHtmlVideo()),
    mediaCapabilities: safeBoolean(() => adapter.hasMediaCapabilities()),
    webCodecsVideo: safeBoolean(() => adapter.hasVideoDecoder()),
    webCodecsAudio: safeBoolean(() => adapter.hasAudioDecoder()),
    webGpu: webGpuFeatures.available,
    webGl2: safeBoolean(() => adapter.hasWebGl2()),
    canvas2d: safeBoolean(() => adapter.hasCanvas2d()),
    workerMediaSource: safeBoolean(() => adapter.hasWorkerMediaSource()),
    webGpuFeatures,
    quirks: [],
  }
}

function detectBrowser(userAgent: string): CapabilitySnapshot['browser'] {
  if (/Firefox\//i.test(userAgent)) return 'gecko'
  if (/(Chrome|Chromium|CriOS|Edg)\//i.test(userAgent)) return 'chromium'
  if (/Safari\//i.test(userAgent) && !/(Chrome|Chromium|CriOS|Edg)\//i.test(userAgent)) return 'webkit'
  return 'unknown'
}

function detectBrowserVersion(userAgent: string): string | null {
  const match = userAgent.match(/(?:Firefox|Chrome|Chromium|CriOS|Edg|Version)\/(\d+)/i)
  return match?.[1] ?? null
}

function detectOperatingSystem(userAgent: string, platform: string): OperatingSystem {
  if (/Android/i.test(userAgent)) return 'android'
  if (/(iPhone|iPad|iPod)/i.test(userAgent)) return 'ios'
  if (/Windows/i.test(userAgent) || /^Win/i.test(platform)) return 'windows'
  if (/Macintosh|Mac OS X/i.test(userAgent) || /^Mac/i.test(platform)) return 'macos'
  if (/Linux/i.test(userAgent) || /^Linux/i.test(platform)) return 'linux'
  return 'unknown'
}

function safeBoolean(read: () => boolean): boolean {
  try {
    return read()
  } catch {
    return false
  }
}

function safeString(read: () => string): string {
  try {
    return read()
  } catch {
    return ''
  }
}

async function safeGpuProbe(adapter: CapabilityProbeAdapter): Promise<WebGpuFeatureSnapshot> {
  try {
    return { ...await adapter.probeWebGpu() }
  } catch {
    return createFallbackGpuFeatures()
  }
}
