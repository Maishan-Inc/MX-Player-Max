import type { AiPlan, AiQualityTier, BackendCandidate, CapabilitySnapshot, MediaDescriptor, PlaybackIntent, PlaybackSelection } from '@mx-player-max/types'

export interface PlatformPolicy {
  adjustCandidates(candidates: BackendCandidate[], media: MediaDescriptor, intent: PlaybackIntent, capabilities: CapabilitySnapshot): BackendCandidate[]
}

export interface StrategyEngine {
  select(media: MediaDescriptor, intent: PlaybackIntent, capabilities: CapabilitySnapshot): PlaybackSelection
}

export function createStrategyEngine(policy?: PlatformPolicy): StrategyEngine {
  return {
    select(media, intent, capabilities) {
      const candidates = createCandidates(media, intent, capabilities)
      const adjusted = policy ? policy.adjustCandidates(candidates, media, intent, capabilities) : candidates
      const sorted = adjusted.sort((left, right) => right.score - left.score)
      const backend = sorted[0]
      if (!backend) throw new Error('NO_PLAYBACK_BACKEND')
      const selection: PlaybackSelection = { backend, intent, capabilities }
      if (intent === 'ai-enhance') {
        selection.aiPlan = proposeAiPlan(media, capabilities, sorted)
      }
      return selection
    },
  }
}

function createCandidates(media: MediaDescriptor, intent: PlaybackIntent, capabilities: CapabilitySnapshot): BackendCandidate[] {
  const normal = intent === 'normal' || intent === 'low-power'
  /* AI-enhancement always requires a CustomMediaPipeline. HTMLVideo cannot feed frames into the AI layer
     in phase 1 (see ADR-0003), so the native candidate is excluded for this intent. */
  const includeNative = normal
  const candidates: BackendCandidate[] = []

  if (includeNative) {
    candidates.push({
      id: 'native-html-video',
      kind: 'html-video',
      videoCodec: media.tracks.find((track) => track.kind === 'video')?.codec ?? null,
      audioCodec: media.tracks.find((track) => track.kind === 'audio')?.codec ?? null,
      renderer: 'native',
      score: 100,
      reasons: ['normal-playback'],
      requires: [],
    })
  }

  /* For ai-enhance the renderer *must* be 'webgpu'. WebGL2/Canvas2D cannot run WGSL compute shaders,
     so falling back to them for AI is equivalent to disabling AI entirely. */
  const aiPreferredRenderer = intent === 'ai-enhance' && capabilities.webGpu ? 'webgpu' as const : undefined
  const defaultRenderer = aiPreferredRenderer
    ?? (capabilities.webGpu ? 'webgpu' as const : capabilities.webGl2 ? 'webgl2' as const : 'canvas2d' as const)

  if (capabilities.webCodecsVideo && capabilities.webCodecsAudio) {
    candidates.push({
      id: intent === 'ai-enhance' ? 'webcodecs-ai' : 'webcodecs-custom',
      kind: 'webcodecs',
      videoCodec: media.tracks.find((track) => track.kind === 'video')?.codec ?? null,
      audioCodec: media.tracks.find((track) => track.kind === 'audio')?.codec ?? null,
      renderer: defaultRenderer,
      score: intent === 'ai-enhance' ? 110 : intent === 'normal' ? 70 : 120,
      reasons: intent === 'ai-enhance' ? ['ai-custom-pipeline'] : ['custom-frame-access'],
      requires: ['VideoDecoder', 'AudioDecoder'],
    })
  }

  /* WASM decoder stays as a compatibility fallback, but its score is always lower
     because software decoding + AI is the worst performance combination. */
  candidates.push({
    id: 'wasm-custom',
    kind: 'wasm',
    videoCodec: media.tracks.find((track) => track.kind === 'video')?.codec ?? null,
    audioCodec: media.tracks.find((track) => track.kind === 'audio')?.codec ?? null,
    renderer: capabilities.webGpu ? 'webgpu' : capabilities.webGl2 ? 'webgl2' : 'canvas2d',
    score: 10,
    reasons: ['compatibility-fallback'],
    requires: [],
  })

  return candidates
}

function proposeAiPlan(
  _media: MediaDescriptor,
  capabilities: CapabilitySnapshot,
  candidates: BackendCandidate[],
): AiPlan {
  const features = capabilities.webGpuFeatures

  /* Gate: WebGPU must be available with a real (non-fallback) adapter.
     Software rasterisers cannot sustain real-time AI at any resolution. */
  const gpuOk = capabilities.webGpu && !features.isFallbackAdapter
  if (!gpuOk) {
    return { interpolation: false, superResolution: false, proposedTier: 'off', reasons: ['webgpu-unavailable-or-software'] }
  }

  /* Gate: the selected backend must be a custom pipeline.
     AI on html-video is blocked in phase 1 (ADR-0003). */
  const hasCustom = candidates.some((c) => c.kind !== 'html-video' && c.renderer === 'webgpu')
  if (!hasCustom) {
    return { interpolation: false, superResolution: false, proposedTier: 'off', reasons: ['no-custom-pipeline-candidate'] }
  }

  const tier = pickStaticTier(features)
  /* Interpolation is proposed when the hardware looks capable and full-featured.
     The governor has final say at runtime; this is only the strategy engine’s static best guess. */
  const interpolation = tier !== 'off' && tier !== 'low' && features.shaderF16 && features.float32Filterable
  const reasons: string[] = [`static-tier:${tier}`]
  if (features.shaderF16) reasons.push('f16-available')
  if (features.float32Filterable) reasons.push('f32-filterable-available')

  return { interpolation, superResolution: tier !== 'off', proposedTier: tier, reasons }
}

/** Pick a starting quality tier based purely on GPU capability heuristics.
 *  This is a static guess — the runtime governor will refine it after measuring real frame times. */
function pickStaticTier(features: CapabilitySnapshot['webGpuFeatures']): AiQualityTier {
  if (features.maxComputeWorkgroupStorageSize < 16384) return 'off'
  if (features.maxTextureDimension2d < 8192) return 'off'
  /* Fallback adapter — software rasteriser. Blocked. */
  if (features.isFallbackAdapter) return 'off'

  /* Heuristic: high-end discrete GPU detected by large buffer limits + shader-f16.
     This is deliberately coarse — the governor will recalibrate at runtime. */
  if (features.shaderF16 && features.float32Filterable && features.maxBufferSize >= 2147483648) return 'high'
  if (features.shaderF16 && features.maxBufferSize >= 1073741824) return 'medium'
  if (features.float32Filterable) return 'low'
  return 'low'
}
