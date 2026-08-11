import type { CapabilitySnapshot } from '@mx-player-max/types'
import type { PlatformEnhancements, PlatformRuntimeAdapter } from './contracts'
import { createDefaultPlatformRuntimeAdapter } from './runtime'

const HLS_CONTENT_TYPE = 'application/vnd.apple.mpegurl'
const HEVC_CONTENT_TYPE = 'video/mp4; codecs="hvc1.1.6.L93.B0"'

export function detectPlatformEnhancements(
  capabilities: CapabilitySnapshot,
  runtime: PlatformRuntimeAdapter = createDefaultPlatformRuntimeAdapter(),
): PlatformEnhancements {
  const playbackQuality = safeBoolean(runtime.hasPlaybackQuality)
  const geckoFrameCounters = safeBoolean(runtime.hasGeckoFrameCounters)
  return {
    nativeHls: safeCanPlayType(runtime, HLS_CONTENT_TYPE),
    nativeHevc: safeCanPlayType(runtime, HEVC_CONTENT_TYPE),
    hdrDisplay: safeBoolean(runtime.hasHighDynamicRangeDisplay),
    managedMediaSource: safeBoolean(runtime.hasManagedMediaSource),
    workerMediaSource: capabilities.workerMediaSource,
    webGpuExternalTexture: capabilities.webGpu
      && capabilities.webGpuFeatures.available
      && capabilities.webGpuFeatures.importExternalTexture,
    airPlay: safeBoolean(runtime.hasAirPlay),
    pictureInPicture: safeBoolean(runtime.hasPictureInPicture),
    fastSeek: safeBoolean(runtime.hasFastSeek),
    playbackQuality,
    geckoFrameCounters,
    diagnosticFrameCounters: playbackQuality || geckoFrameCounters,
  }
}

function safeCanPlayType(runtime: PlatformRuntimeAdapter, contentType: string): boolean {
  try {
    const result = runtime.canPlayType(contentType)
    return result === 'maybe' || result === 'probably'
  } catch {
    return false
  }
}

function safeBoolean(read: () => boolean): boolean {
  try {
    return read()
  } catch {
    return false
  }
}

