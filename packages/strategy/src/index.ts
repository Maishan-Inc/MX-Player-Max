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
  StrategyEvaluation,
  StrategyExclusion,
  WasmDecoderDeclaration,
} from '@mx-player-max/types'
import { codecWithinDecoderScope, ErrorCodes } from '@mx-player-max/types'

export interface PlatformPolicy {
  adjustScores(
    candidates: readonly BackendCandidate[],
    media: MediaDescriptor,
    intent: PlaybackIntent,
    context: CapabilityContext,
  ): readonly PlatformScoreAdjustment[]
}

export interface StrategyEngine {
  evaluate(media: MediaDescriptor, intent: PlaybackIntent, context: CapabilityContext): StrategyEvaluation
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
  const evaluate = (media: MediaDescriptor, intent: PlaybackIntent, context: CapabilityContext): StrategyEvaluation => {
    const { candidates: baseCandidates, exclusions } = createCandidates(media, intent, context)
    const policyInput = baseCandidates.map(cloneCandidate)
    const requestedAdjustments = policy?.adjustScores(policyInput, media, intent, context) ?? []
    const adjustments = normalizePlatformAdjustments(baseCandidates, requestedAdjustments)
    const rankedCandidates = applyPlatformAdjustments(baseCandidates, adjustments).sort(compareCandidates)
    const backend = rankedCandidates[0]
    let selection: PlaybackSelection | null = null
    if (backend) {
      selection = {
        backend: cloneCandidate(backend),
        intent,
        capabilities: context.snapshot,
        mediaCapabilities: context.media,
      }
      if (intent === 'ai-enhance') selection.aiPlan = proposeAiPlan(context.snapshot, rankedCandidates)
    }
    return {
      baseCandidates: baseCandidates.map(cloneCandidate),
      adjustments: adjustments.map(cloneAdjustment),
      rankedCandidates: rankedCandidates.map(cloneCandidate),
      selection,
      ...(exclusions.length === 0 ? {} : { exclusions: exclusions.map(cloneExclusion) }),
    }
  }

  return {
    evaluate,
    rank: (media, intent, context) => evaluate(media, intent, context).rankedCandidates.map(cloneCandidate),
    select: (media, intent, context) => {
      const selection = evaluate(media, intent, context).selection
      if (!selection) throw new StrategySelectionError()
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

function normalizePlatformAdjustments(
  candidates: readonly BackendCandidate[],
  adjustments: readonly PlatformScoreAdjustment[],
): PlatformScoreAdjustment[] {
  const candidateIds = new Set(candidates.map((candidate) => candidate.id))
  const adjustedIds = new Set<string>()
  const normalized: PlatformScoreAdjustment[] = []
  for (const adjustment of adjustments) {
    if (!candidateIds.has(adjustment.candidateId)
      || adjustedIds.has(adjustment.candidateId)
      || !Number.isFinite(adjustment.scoreDelta)) continue
    adjustedIds.add(adjustment.candidateId)
    normalized.push(cloneAdjustment(adjustment))
  }
  return normalized
}

function createCandidates(
  media: MediaDescriptor,
  intent: PlaybackIntent,
  context: CapabilityContext,
): { candidates: BackendCandidate[]; exclusions: StrategyExclusion[] } {
  const candidates: BackendCandidate[] = []
  const exclusions: StrategyExclusion[] = []
  const videoCodec = context.media.query.video?.codec ?? null
  const audioCodec = context.media.query.audio?.codec ?? null
  const nativeIntent = intent === 'normal' || intent === 'low-power'
  const aiIntent = intent === 'ai-enhance'
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
    const webCodecsId = intent === 'ai-enhance' ? 'webcodecs-ai' : 'webcodecs-custom'
    const outsideEngineScope = codecOutsideEngineScope(context)
    if (outsideEngineScope !== null) {
      exclusions.push({
        candidateId: webCodecsId,
        kind: 'webcodecs',
        errorCode: outsideEngineScope.errorCode,
        reasons: sortStrings(outsideEngineScope.reasons),
      })
    } else {
      const advancedIntent = intent !== 'normal' && intent !== 'low-power'
      const aiCapable = !context.snapshot.webGpuFeatures.isFallbackAdapter
        && context.snapshot.webGpu
        && context.snapshot.webGpuFeatures.maxTextureDimension2d > 0
        && renderer === 'webgpu'
      const reasons = [advancedIntent ? 'custom-frame-access' : 'webcodecs-fallback', `renderer:${renderer}`, `renderer-fallback-chain:${rendererFallbackChain(context.snapshot).join('>')}`]
      if (aiIntent && !aiCapable) reasons.push('ai-passthrough-fallback')
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
        id: webCodecsId,
        kind: 'webcodecs',
        videoCodec,
        audioCodec,
        renderer,
        score,
        reasons: sortStrings(reasons),
        requires: webCodecsRequirements(context),
      })
    }
  }

  if (!aiIntent && renderer && supportsRequiredWasmDecoders(context)) {
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

  return { candidates, exclusions }
}

/**
 * The probe result says whether the browser can decode the track; this says whether the WebCodecs
 * backend will attempt it. Chrome's `AudioDecoder` decodes Vorbis given the container's
 * CodecPrivate, so `flower.webm` used to be ranked, selected, and then fail with
 * `WEBCODECS_AUDIO_NOT_SUPPORTED` during pipeline initialisation. Returning the code the backend
 * would have raised keeps that reason available to callers without creating the candidate.
 * A host that declares no scope keeps the previous behaviour.
 */
function codecOutsideEngineScope(context: CapabilityContext): { errorCode: string; reasons: string[] } | null {
  const declarations = context.webCodecsCodecs
  if (declarations === undefined || declarations.length === 0) return null
  const video = context.media.query.video
  if (video !== null && !codecWithinDecoderScope(declarations, 'video', video.codec)) {
    return { errorCode: ErrorCodes.WEBCODECS_NOT_SUPPORTED, reasons: [`video-codec-outside-engine-scope:${video.codec}`] }
  }
  const audio = context.media.query.audio
  if (audio === null) return null
  if (!codecWithinDecoderScope(declarations, 'audio', audio.codec)) {
    return { errorCode: ErrorCodes.WEBCODECS_AUDIO_NOT_SUPPORTED, reasons: [`audio-codec-outside-engine-scope:${audio.codec}`] }
  }
  if (!codecWithinDecoderScope(declarations, 'audio', audio.codec, audio.numberOfChannels)) {
    return {
      errorCode: ErrorCodes.AUDIO_CHANNEL_LAYOUT_UNSUPPORTED,
      reasons: [`audio-channels-outside-engine-scope:${audio.numberOfChannels ?? 'unknown'}`],
    }
  }
  return null
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
  if (capabilities.webGpu && capabilities.webGpuFeatures.maxTextureDimension2d > 0) return 'webgpu'
  if (capabilities.webGl2) return 'webgl2'
  if (capabilities.canvas2d) return 'canvas2d'
  return null
}

function rendererFallbackChain(capabilities: CapabilitySnapshot): string[] {
  const chain: string[] = []
  if (capabilities.webGpu && capabilities.webGpuFeatures.maxTextureDimension2d > 0) chain.push('webgpu')
  if (capabilities.webGl2) chain.push('webgl2')
  if (capabilities.canvas2d) chain.push('canvas2d')
  return chain
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

function cloneAdjustment(adjustment: PlatformScoreAdjustment): PlatformScoreAdjustment {
  return {
    candidateId: adjustment.candidateId,
    scoreDelta: adjustment.scoreDelta,
    reasons: [...adjustment.reasons],
  }
}

function cloneExclusion(exclusion: StrategyExclusion): StrategyExclusion {
  return {
    candidateId: exclusion.candidateId,
    kind: exclusion.kind,
    errorCode: exclusion.errorCode,
    reasons: [...exclusion.reasons],
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
