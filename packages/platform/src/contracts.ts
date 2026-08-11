import type {
  BackendCandidate,
  CapabilityContext,
  CapabilitySnapshot,
  CapabilitySupport,
  MediaDescriptor,
  PlatformScoreAdjustment,
  PlaybackIntent,
  RendererKind,
} from '@mx-player-max/types'

export type PlatformName = 'chromium' | 'webkit' | 'gecko' | 'generic'

export interface PlatformEnhancements {
  nativeHls: boolean
  nativeHevc: boolean
  hdrDisplay: boolean
  managedMediaSource: boolean
  workerMediaSource: boolean
  webGpuExternalTexture: boolean
  airPlay: boolean
  pictureInPicture: boolean
  fastSeek: boolean
  playbackQuality: boolean
  geckoFrameCounters: boolean
  diagnosticFrameCounters: boolean
}

export interface PlatformRuntimeAdapter {
  canPlayType(contentType: string): '' | 'maybe' | 'probably'
  hasManagedMediaSource(): boolean
  hasHighDynamicRangeDisplay(): boolean
  hasAirPlay(): boolean
  hasPictureInPicture(): boolean
  hasFastSeek(): boolean
  hasPlaybackQuality(): boolean
  hasGeckoFrameCounters(): boolean
}

export interface PlatformVersionRange {
  minInclusive?: string
  maxExclusive?: string
}

export interface PlatformIssueMatcher {
  candidateKinds?: readonly BackendCandidate['kind'][]
  renderers?: readonly RendererKind[]
  videoCodecPrefixes?: readonly string[]
  audioCodecPrefixes?: readonly string[]
  intents?: readonly PlaybackIntent[]
}

export interface PlatformIssueRule {
  id: string
  browser: Exclude<CapabilitySnapshot['browser'], 'unknown'>
  versions: PlatformVersionRange
  issueUrl: string
  expiresOn: string
  testSample: string
  scoreDelta: number
  match: PlatformIssueMatcher
}

export interface PlatformPolicyOptions {
  runtime?: PlatformRuntimeAdapter
  issueRules?: readonly PlatformIssueRule[]
  now?: Date
}

export interface PlatformPolicy {
  readonly name: PlatformName
  readonly enhancements: PlatformEnhancements
  readonly issueRules: readonly PlatformIssueRule[]
  detectEnhancements(capabilities: CapabilitySnapshot): PlatformEnhancements
  adjustScores(
    candidates: readonly BackendCandidate[],
    media: MediaDescriptor,
    intent: PlaybackIntent,
    context: CapabilityContext,
  ): readonly PlatformScoreAdjustment[]
}

export interface StandardPlaybackQuality {
  totalVideoFrames: number | null
  droppedVideoFrames: number | null
  corruptedVideoFrames: number | null
}

export interface GeckoPlaybackQuality {
  decodedFrames: number | null
  presentedFrames: number | null
  paintedFrames: number | null
  frameDelaySeconds: number | null
}

export interface PlaybackQualityDiagnostics {
  standard: StandardPlaybackQuality | null
  gecko: GeckoPlaybackQuality | null
}

export type WebCodecsHardwarePreference = 'prefer-hardware' | 'prefer-software' | 'no-preference'
export type WebCodecsAcceleration = 'hardware' | 'software' | 'unknown'

export interface WebCodecsAccelerationObservation {
  codec: string
  requestedPreference: WebCodecsHardwarePreference
  support: CapabilitySupport
  selected: WebCodecsAcceleration
  reasons: readonly string[]
}

export interface PlatformDiagnosticSnapshot {
  playbackQuality: PlaybackQualityDiagnostics
  webCodecsAcceleration: readonly WebCodecsAccelerationObservation[]
}

export interface PlatformDiagnostics {
  recordWebCodecsAcceleration(observation: WebCodecsAccelerationObservation): void
  snapshot(video?: HTMLVideoElement | null): PlatformDiagnosticSnapshot
  reset(): void
}
