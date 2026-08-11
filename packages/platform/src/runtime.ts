import type { PlatformRuntimeAdapter } from './contracts'

interface ExtendedVideoElement extends HTMLVideoElement {
  webkitShowPlaybackTargetPicker?: () => void
  webkitSupportsPresentationMode?: (mode: string) => boolean
  mozDecodedFrames?: number
  mozPresentedFrames?: number
  mozPaintedFrames?: number
  mozFrameDelay?: number
}
export function createDefaultPlatformRuntimeAdapter(): PlatformRuntimeAdapter {
  const video = createVideoElement()
  return {
    canPlayType: (contentType) => safeCanPlayType(video, contentType),
    hasManagedMediaSource: () => safeBoolean(() => 'ManagedMediaSource' in globalThis),
    hasHighDynamicRangeDisplay: () => safeBoolean(() => typeof matchMedia === 'function'
      && matchMedia('(dynamic-range: high)').matches),
    hasAirPlay: () => typeof video?.webkitShowPlaybackTargetPicker === 'function',
    hasPictureInPicture: () => hasPictureInPicture(video),
    hasFastSeek: () => typeof video?.fastSeek === 'function',
    hasPlaybackQuality: () => typeof video?.getVideoPlaybackQuality === 'function',
    hasGeckoFrameCounters: () => hasGeckoFrameCounters(video),
  }
}

function createVideoElement(): ExtendedVideoElement | null {
  if (typeof document === 'undefined') return null
  try {
    return document.createElement('video') as ExtendedVideoElement
  } catch {
    return null
  }
}

function safeCanPlayType(
  video: ExtendedVideoElement | null,
  contentType: string,
): '' | 'maybe' | 'probably' {
  if (!video) return ''
  try {
    const result = video.canPlayType(contentType)
    return result === 'maybe' || result === 'probably' ? result : ''
  } catch {
    return ''
  }
}

function hasPictureInPicture(video: ExtendedVideoElement | null): boolean {
  if (!video) return false
  return safeBoolean(() => {
    const standard = typeof document !== 'undefined'
      && document.pictureInPictureEnabled === true
      && typeof video.requestPictureInPicture === 'function'
    const webkit = typeof video.webkitSupportsPresentationMode === 'function'
      && video.webkitSupportsPresentationMode('picture-in-picture')
    return standard || webkit
  })
}

function hasGeckoFrameCounters(video: ExtendedVideoElement | null): boolean {
  if (!video) return false
  return 'mozDecodedFrames' in video
    || 'mozPresentedFrames' in video
    || 'mozPaintedFrames' in video
    || 'mozFrameDelay' in video
}

function safeBoolean(read: () => boolean): boolean {
  try {
    return read()
  } catch {
    return false
  }
}
