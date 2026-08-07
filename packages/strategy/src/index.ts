import type {
  AiPlan,
  AiQualityTier,
  BackendCandidate,
  BackendKind,
  CapabilityContext,
  CapabilitySnapshot,
  EngineError,
  MediaDescriptor,
  PlatformScoreAdjustment,
  PlaybackIntent,
  PlaybackSelection,
  RendererKind,
  WasmDecoderDeclaration,
} from '@mx-player-max/types'
import { ErrorCodes } from '@mx-player-max/types'

export interface PlatformPolicy {
  adjustScores(
    candidates: readonly BackendCandidate[],
    media: MediaDescriptor,
    intent: PlaybackIntent,
    context: CapabilityContext,
  ): readonly PlatformScoreAdjustment[]
}

export interface StrategyEngine {
  rank(media: MediaDescriptor, intent: PlaybackIntent, context: CapabilityContext): readonly BackendCandidate[]
  select(media: MediaDescriptor, intent: PlaybackIntent, context: CapabilityContext): PlaybackSelection
}

export class StrategySelectionError extends Error implements EngineError {
  readonly code = ErrorCodes.STRATEGY_NO_VIABLE_BACKEND
  readonly recoverable = false

  constructor(message = 'No viable playback backend') {
    super(message)
    this.name = 'StrategySelectionError'
  }
}

export function createStrategyEngine(policy?: PlatformPolicy): StrategyEngine {
  const rank = (media: MediaDescriptor, intent: PlaybackIntent, context: CapabilityContext): readonly BackendCandidate[] => {
    const candidates = createCandidates(media, intent, context)
    const adjusted = applyPlatformAdjustments(candidates, policy?.adjustScores(candidates, media, intent, context) ?? [])
    return adjusted.sort(compareCandidates)
  }

  return {
    rank,
    select(media, intent, context) {
      const ranked = rank(media, intent, context)
      const backend = ranked[0]
      if (!backend) throw new StrategySelectionError()
      const selection: PlaybackSelection = {
        backend,
        intent,
        capabilities: context.snapshot,
        mediaCapabilities: context.media,
      }
      if (intent === 'ai-enhance') selection.aiPlan = proposeAiPlan(context.snapshot, ranked)
      return selection
    },
  }
}

export function applyPlatformAdjustments(
  candidates: readonly BackendCandidate[],
  adjustments: readonly PlatformScoreAdjustment[],
): BackendCandidate[] {
  const byId = new Map(candidates.map((candidate) => [candidate.id, cloneCandidate(candidate)]))
  const adjustedIds = new Set<string>()

  for (const adjustment of adjustments) {
    const candidate = byId.get(adjustment.candidateId)
    if (!candidate || adjustedIds.has(adjustment.candidateId) || !Number.isFinite(adjustment.scoreDelta)) continue
    candidate.score += adjustment.scoreDelta
    candidate.reasons = sortStrings([...candidate.reasons, ...adjustment.reasons])
    adjustedIds.add(adjustment.candidateId)
  }

  return candidates.map((candidate) => byId.get(candidate.id) ?? cloneCandidate(candidate))
}

function createCandidates(
  media: MediaDescriptor,
  intent: PlaybackIntent,
  context: CapabilityContext,
): BackendCandidate[] {
  const candidates: BackendCandidate[] = []
  const videoCodec = context.media.query.video?.codec ?? null
  const audioCodec = context.media.query.audio?.codec ?? null
  const nativeIntent = intent === 'normal' || intent === 'low-power'
  const hdr = hasHdrVideo(media)

  if (nativeIntent && context.media.native.playable === 'supported' && context.snapshot.htmlVideo) {
    const decodingInfo = context.media.native.video.decodingInfo ?? context.media.native.audio.decodingInfo
    const reasons = ['native-media-supported', intent === 'low-power' ? 'low-power-intent' : 'normal-playback']
    let score = 100
    if (decodingInfo?.powerEfficient) {
      score += 40
      reasons.push('power-efficient')
    }
    if (decodingInfo?.smooth) {
      score += 30
      reasons.push('smooth-decoding')
    }
    if (hdr) {
      score += 30
      reasons.push('native-hdr-color-management')
    }
    candidates.push({
      id: 'native-html-video',
      kind: 'html-video',
      videoCodec,
      audioCodec,
      renderer: 'native',
      score,
      reasons: sortStrings(reasons),
      requires: ['HTMLVideoElement'],
    })
  }

  const renderer = selectCustomRenderer(context.snapshot)
  if (renderer && context.media.webCodecs.playable === 'supported' && supportsRequiredWebCodecs(context)) {
    const advancedIntent = intent !== 'normal' && intent !== 'low-power'
    const reasons = [advancedIntent ? 'custom-frame-access' : 'webcodecs-fallback', `renderer:${renderer}`]
    let score = advancedIntent ? 120 : 70
    if (renderer === 'webgpu') {
      score += 20
      reasons.push('webgpu-renderer')
    }
    if (hdr) {
      score -= 20
      reasons.push('custom-hdr-color-management-required')
    }
    candidates.push({
      id: intent === 'ai-enhance' ? 'webcodecs-ai' : 'webcodecs-custom',
      kind: 'webcodecs',
      videoCodec,
      audioCodec,
      renderer,
      score,
      reasons: sortStrings(reasons),
      requires: webCodecsRequirements(context),
    })
  }

  if (renderer && supportsRequiredWasmDecoders(context)) {
    const reasons = ['declared-wasm-decoder', `renderer:${renderer}`]
    let score = intent === 'normal' || intent === 'low-power' ? 10 : 40
    if (context.snapshot.wasmSimd) {
      score += 10
      reasons.push('wasm-simd')
    }
    if (context.snapshot.wasmThreads) {
      score += 10
      reasons.push('wasm-threads')
    }
    candidates.push({
      id: 'wasm-custom',
      kind: 'wasm',
      videoCodec,
      audioCodec,
      renderer,
      score,
      reasons: sortStrings(reasons),
      requires: ['declared-wasm-decoder'],
    })
  }

  return candidates
}

function supportsRequiredWebCodecs(context: CapabilityContext): boolean {
  if (!context.media.query.video && !context.media.query.audio) return false
  const videoSupported = context.media.query.video === null
    || (context.snapshot.webCodecsVideo && context.media.webCodecs.video.status === 'supported')
  const audioSupported = context.media.query.audio === null
    || (context.snapshot.webCodecsAudio && context.media.webCodecs.audio.status === 'supported')
  return videoSupported && audioSupported
}

function supportsRequiredWasmDecoders(context: CapabilityContext): boolean {
  if (!context.media.query.video && !context.media.query.audio) return false
  const declarations = context.wasmDecoders ?? []
  const videoSupported = context.media.query.video === null
    || hasWasmDeclaration(declarations, context.media.query.video.codec, 'video')
  const audioSupported = context.media.query.audio === null
    || hasWasmDeclaration(declarations, context.media.query.audio.codec, 'audio')
  return declarations.length > 0 && videoSupported && audioSupported
}

function hasWasmDeclaration(
  declarations: readonly WasmDecoderDeclaration[],
  codec: string,
  kind: 'video' | 'audio',
): boolean {
  const normalizedCodec = codec.toLowerCase()
  return declarations.some((declaration) => declaration.codec.toLowerCase() === normalizedCodec
    && (kind === 'video' ? declaration.supportsVideo : declaration.supportsAudio))
}

function webCodecsRequirements(context: CapabilityContext): string[] {
  return [
    ...(context.media.query.video ? ['VideoDecoder'] : []),
    ...(context.media.query.audio ? ['AudioDecoder'] : []),
  ]
}

function selectCustomRenderer(capabilities: CapabilitySnapshot): Exclude<RendererKind, 'native'> | null {
  if (capabilities.webGpu) return 'webgpu'
  if (capabilities.webGl2) return 'webgl2'
  if (capabilities.canvas2d) return 'canvas2d'
  return null
}

function hasHdrVideo(media: MediaDescriptor): boolean {
  const video = media.tracks.find((track) => track.kind === 'video')
  const hdrFormat = video?.color?.hdrFormat
  return (hdrFormat !== undefined && hdrFormat !== 'none') || video?.hdr === true
}

function cloneCandidate(candidate: BackendCandidate): BackendCandidate {
  return {
    ...candidate,
    reasons: [...candidate.reasons],
    requires: [...candidate.requires],
  }
}

function compareCandidates(left: BackendCandidate, right: BackendCandidate): number {
  const score = right.score - left.score
  if (score !== 0) return score
  const priority = backendPriority(left.kind) - backendPriority(right.kind)
  if (priority !== 0) return priority
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0
}

function backendPriority(kind: BackendKind): number {
  if (kind === 'html-video') return 0
  if (kind === 'webcodecs') return 1
  if (kind === 'wasm') return 2
  return 3
}

function sortStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort()
}

function proposeAiPlan(capabilities: CapabilitySnapshot, candidates: readonly BackendCandidate[]): AiPlan {
  const features = capabilities.webGpuFeatures
  const gpuOk = capabilities.webGpu && !features.isFallbackAdapter
  if (!gpuOk) {
    return { interpolation: false, superResolution: false, proposedTier: 'off', reasons: ['webgpu-unavailable-or-software'] }
  }

  const hasCustom = candidates.some((candidate) => candidate.kind !== 'html-video' && candidate.renderer === 'webgpu')
  if (!hasCustom) {
    return { interpolation: false, superResolution: false, proposedTier: 'off', reasons: ['no-custom-pipeline-candidate'] }
  }

  const tier = pickStaticTier(features)
  const interpolation = tier !== 'off' && tier !== 'low' && features.shaderF16 && features.float32Filterable
  const reasons: string[] = [`static-tier:${tier}`]
  if (features.shaderF16) reasons.push('f16-available')
  if (features.float32Filterable) reasons.push('f32-filterable-available')
  return { interpolation, superResolution: tier !== 'off', proposedTier: tier, reasons: sortStrings(reasons) }
}

function pickStaticTier(features: CapabilitySnapshot['webGpuFeatures']): AiQualityTier {
  if (features.maxComputeWorkgroupStorageSize < 16384) return 'off'
  if (features.maxTextureDimension2d < 8192) return 'off'
  if (features.isFallbackAdapter) return 'off'
  if (features.shaderF16 && features.float32Filterable && features.maxBufferSize >= 2147483648) return 'high'
  if (features.shaderF16 && features.maxBufferSize >= 1073741824) return 'medium'
  return 'low'
}
