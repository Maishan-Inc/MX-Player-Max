import type { BackendCandidate, CapabilitySnapshot, MediaDescriptor, PlaybackIntent, PlaybackSelection } from '@mx-player-max/types'

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
      const backend = adjusted.sort((left, right) => right.score - left.score)[0]
      if (!backend) throw new Error('NO_PLAYBACK_BACKEND')
      return { backend, intent, capabilities }
    },
  }
}

function createCandidates(media: MediaDescriptor, intent: PlaybackIntent, capabilities: CapabilitySnapshot): BackendCandidate[] {
  const normal = intent === 'normal' || intent === 'low-power'
  const candidates: BackendCandidate[] = []
  if (normal) candidates.push({ id: 'native-html-video', kind: 'html-video', videoCodec: media.tracks.find((track) => track.kind === 'video')?.codec ?? null, audioCodec: media.tracks.find((track) => track.kind === 'audio')?.codec ?? null, renderer: 'native', score: 100, reasons: ['normal-playback'], requires: [] })
  if (capabilities.webCodecsVideo && capabilities.webCodecsAudio) candidates.push({ id: 'webcodecs-custom', kind: 'webcodecs', videoCodec: media.tracks.find((track) => track.kind === 'video')?.codec ?? null, audioCodec: media.tracks.find((track) => track.kind === 'audio')?.codec ?? null, renderer: intent === 'normal' ? 'webgpu' : capabilities.webGpu ? 'webgpu' : capabilities.webGl2 ? 'webgl2' : 'canvas2d', score: intent === 'normal' ? 70 : 120, reasons: ['custom-frame-access'], requires: ['VideoDecoder', 'AudioDecoder'] })
  candidates.push({ id: 'wasm-custom', kind: 'wasm', videoCodec: media.tracks.find((track) => track.kind === 'video')?.codec ?? null, audioCodec: media.tracks.find((track) => track.kind === 'audio')?.codec ?? null, renderer: capabilities.webGpu ? 'webgpu' : capabilities.webGl2 ? 'webgl2' : 'canvas2d', score: 10, reasons: ['compatibility-fallback'], requires: [] })
  return candidates
}

