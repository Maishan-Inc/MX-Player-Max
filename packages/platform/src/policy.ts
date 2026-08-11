import type {
  BackendCandidate,
  CapabilityContext,
  CapabilitySnapshot,
  MediaDescriptor,
  PlatformScoreAdjustment,
  PlaybackIntent,
} from '@mx-player-max/types'
import type { PlatformEnhancements, PlatformName, PlatformPolicy, PlatformPolicyOptions } from './contracts'
import { detectPlatformEnhancements } from './enhancements'
import {
  BUILT_IN_PLATFORM_ISSUES,
  matchesPlatformIssue,
  normalizePlatformIssueRules,
} from './issues'
import { createDefaultPlatformRuntimeAdapter } from './runtime'

export function createPlatformPolicy(
  capabilities: CapabilitySnapshot,
  options: PlatformPolicyOptions = {},
): PlatformPolicy {
  const runtime = options.runtime ?? createDefaultPlatformRuntimeAdapter()
  const enhancements = detectPlatformEnhancements(capabilities, runtime)
  const name = capabilities.browser === 'unknown' ? 'generic' : capabilities.browser
  const issueRules = normalizePlatformIssueRules(options.issueRules ?? BUILT_IN_PLATFORM_ISSUES)
  const now = options.now ? new Date(options.now.getTime()) : new Date()
  return {
    name,
    enhancements,
    issueRules,
    detectEnhancements: (snapshot) => detectPlatformEnhancements(snapshot, runtime),
    adjustScores(candidates, media, intent, context) {
      return createScoreAdjustments(
        name,
        candidates,
        media,
        intent,
        context,
        enhancements,
        issueRules,
        now,
      )
    },
  }
}

function createScoreAdjustments(
  name: PlatformName,
  candidates: readonly BackendCandidate[],
  media: MediaDescriptor,
  intent: PlaybackIntent,
  context: CapabilityContext,
  enhancements: PlatformEnhancements,
  issueRules: PlatformPolicy['issueRules'],
  now: Date,
): PlatformScoreAdjustment[] {
  if (name === 'generic') return []
  const adjustments: PlatformScoreAdjustment[] = []
  for (const candidate of candidates) {
    let scoreDelta = 0
    const reasons: string[] = []
    const add = (delta: number, reason: string): void => {
      scoreDelta += delta
      reasons.push(reason)
    }

    addEnhancementHints(name, candidate, media, intent, context, enhancements, add)
    for (const rule of issueRules) {
      if (!matchesPlatformIssue(rule, context.snapshot, candidate, intent, now)) continue
      add(rule.scoreDelta, `platform-issue:${rule.id}`)
    }
    if (scoreDelta !== 0 && Number.isFinite(scoreDelta)) {
      adjustments.push({
        candidateId: candidate.id,
        scoreDelta,
        reasons: [...new Set(reasons)].sort(),
      })
    }
  }
  return adjustments
}

function addEnhancementHints(
  name: PlatformName,
  candidate: BackendCandidate,
  media: MediaDescriptor,
  intent: PlaybackIntent,
  context: CapabilityContext,
  enhancements: PlatformEnhancements,
  add: (delta: number, reason: string) => void,
): void {
  if (name === 'chromium'
    && candidate.kind === 'webcodecs'
    && candidate.renderer === 'webgpu'
    && enhancements.webGpuExternalTexture
    && context.media.webCodecs.playable === 'supported') {
    add(5, 'chromium-webcodecs-external-texture-hint')
  }

  if (name === 'webkit'
    && candidate.kind === 'html-video'
    && context.media.native.playable === 'supported'
    && (intent === 'normal' || intent === 'low-power')) {
    add(5, 'webkit-native-media-hint')
    if (isHevc(candidate.videoCodec) && enhancements.nativeHevc) {
      add(10, 'webkit-native-hevc-hint')
    }
    if (hasHdrVideo(media) && enhancements.hdrDisplay) {
      add(10, 'webkit-native-hdr-display-hint')
    }
    if (isHls(media) && enhancements.nativeHls) {
      add(10, 'webkit-native-hls-hint')
    }
  }

  if (name === 'gecko'
    && candidate.kind === 'webcodecs'
    && intent !== 'normal'
    && intent !== 'low-power'
    && context.media.webCodecs.playable === 'supported') {
    add(5, 'gecko-frame-access-hint')
  }
}

function isHevc(codec: string | null): boolean {
  if (!codec) return false
  const normalized = codec.toLowerCase()
  return normalized.startsWith('hvc1') || normalized.startsWith('hev1')
}

function hasHdrVideo(media: MediaDescriptor): boolean {
  const video = media.tracks.find((track) => track.kind === 'video')
  return video?.hdr === true
    || (video?.color?.hdrFormat !== undefined && video.color.hdrFormat !== 'none')
}

function isHls(media: MediaDescriptor): boolean {
  const mimeType = media.mimeType?.toLowerCase()
  return mimeType === 'application/vnd.apple.mpegurl' || mimeType === 'application/x-mpegurl'
}
