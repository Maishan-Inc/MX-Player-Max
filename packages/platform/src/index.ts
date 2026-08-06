import type { BackendCandidate, CapabilitySnapshot, MediaDescriptor, PlaybackIntent } from '@mx-player-max/types'

export interface PlatformEnhancements {
  nativeHls: boolean
  managedMediaSource: boolean
  workerMediaSource: boolean
  webGpuExternalTexture: boolean
  fastSeek: boolean
  diagnosticFrameCounters: boolean
}

export interface PlatformPolicy {
  readonly name: 'chromium' | 'webkit' | 'gecko' | 'generic'
  detectEnhancements(capabilities: CapabilitySnapshot): PlatformEnhancements
  adjustCandidates(candidates: BackendCandidate[], media: MediaDescriptor, intent: PlaybackIntent, capabilities: CapabilitySnapshot): BackendCandidate[]
}

export function createPlatformPolicy(capabilities: CapabilitySnapshot): PlatformPolicy {
  const enhancements = detectEnhancements(capabilities)
  return {
    name: capabilities.browser === 'unknown' ? 'generic' : capabilities.browser,
    detectEnhancements: () => enhancements,
    adjustCandidates(candidates) { return candidates },
  }
}

function detectEnhancements(capabilities: CapabilitySnapshot): PlatformEnhancements {
  const hasVideo = typeof document !== 'undefined' && 'createElement' in document
  const video = hasVideo ? document.createElement('video') : null
  return {
    nativeHls: Boolean(video?.canPlayType('application/vnd.apple.mpegurl')),
    managedMediaSource: 'ManagedMediaSource' in globalThis,
    workerMediaSource: capabilities.workerMediaSource,
    webGpuExternalTexture: false,
    fastSeek: typeof video?.fastSeek === 'function',
    diagnosticFrameCounters: capabilities.browser === 'gecko',
  }
}
