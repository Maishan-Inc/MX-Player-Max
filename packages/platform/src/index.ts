import type {
  BackendCandidate,
  CapabilityContext,
  CapabilitySnapshot,
  MediaDescriptor,
  PlatformScoreAdjustment,
  PlaybackIntent,
} from '@mx-player-max/types'

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
  adjustScores(
    candidates: readonly BackendCandidate[],
    media: MediaDescriptor,
    intent: PlaybackIntent,
    context: CapabilityContext,
  ): readonly PlatformScoreAdjustment[]
}

export function createPlatformPolicy(capabilities: CapabilitySnapshot): PlatformPolicy {
  const enhancements = detectEnhancements(capabilities)
  const name = capabilities.browser === 'unknown' ? 'generic' : capabilities.browser
  return {
    name,
    detectEnhancements: () => enhancements,
    adjustScores(candidates, _media, intent, context) {
      return createScoreAdjustments(name, candidates, intent, context)
    },
  }
}

function detectEnhancements(capabilities: CapabilitySnapshot): PlatformEnhancements {
  const video = createVideoElement()
  return {
    nativeHls: safeBoolean(() => Boolean(video?.canPlayType('application/vnd.apple.mpegurl'))),
    managedMediaSource: 'ManagedMediaSource' in globalThis,
    workerMediaSource: capabilities.workerMediaSource,
    webGpuExternalTexture: capabilities.webGpu && capabilities.webGpuFeatures.importExternalTexture,
    fastSeek: typeof video?.fastSeek === 'function',
    diagnosticFrameCounters: hasDiagnosticFrameCounters(video),
  }
}

function createScoreAdjustments(
  name: PlatformPolicy['name'],
  candidates: readonly BackendCandidate[],
  intent: PlaybackIntent,
  context: CapabilityContext,
): PlatformScoreAdjustment[] {
  if (name === 'generic') return []

  return candidates.flatMap((candidate) => {
    if (name === 'chromium'
      && candidate.kind === 'webcodecs'
      && candidate.renderer === 'webgpu'
      && context.snapshot.webGpu) {
      return [{ candidateId: candidate.id, scoreDelta: 5, reasons: ['chromium-webcodecs-webgpu-hint'] }]
    }
    if (name === 'webkit'
      && candidate.kind === 'html-video'
      && context.media.native.playable === 'supported'
      && (intent === 'normal' || intent === 'low-power')) {
      return [{ candidateId: candidate.id, scoreDelta: 5, reasons: ['webkit-native-media-hint'] }]
    }
    if (name === 'gecko'
      && candidate.kind === 'webcodecs'
      && intent !== 'normal'
      && intent !== 'low-power'
      && context.media.webCodecs.playable === 'supported') {
      return [{ candidateId: candidate.id, scoreDelta: 5, reasons: ['gecko-frame-access-hint'] }]
    }
    return []
  })
}

function createVideoElement(): HTMLVideoElement | null {
  if (typeof document === 'undefined') return null
  try {
    return document.createElement('video')
  } catch {
    return null
  }
}

function hasDiagnosticFrameCounters(video: HTMLVideoElement | null): boolean {
  if (!video) return false
  return 'getVideoPlaybackQuality' in video
    || 'mozDecodedFrames' in video
    || 'mozPresentedFrames' in video
}

function safeBoolean(read: () => boolean): boolean {
  try {
    return read()
  } catch {
    return false
  }
}
