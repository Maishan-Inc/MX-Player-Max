import type { CapabilitySnapshot } from '@mx-player-max/types'

export interface CapabilityProbeOptions {
  forceRefresh?: boolean
}

export async function detectCapabilities(_options: CapabilityProbeOptions = {}): Promise<CapabilitySnapshot> {
  const userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent
  const browser = /Firefox\//i.test(userAgent)
    ? 'gecko'
    : /Safari\//i.test(userAgent) && !/Chrome\//i.test(userAgent)
      ? 'webkit'
      : /Chrome\//i.test(userAgent) || /Chromium\//i.test(userAgent)
        ? 'chromium'
        : 'unknown'
  const crossOriginIsolated = typeof globalThis.crossOriginIsolated === 'boolean' && globalThis.crossOriginIsolated
  const hasSharedArrayBuffer = typeof globalThis.SharedArrayBuffer !== 'undefined'
  const hasVideoDecoder = typeof globalThis.VideoDecoder !== 'undefined'
  const hasAudioDecoder = typeof globalThis.AudioDecoder !== 'undefined'
  const hasWebGpu = typeof navigator !== 'undefined' && 'gpu' in navigator
  const hasWebGl2 = typeof document !== 'undefined' && Boolean(document.createElement('canvas').getContext('webgl2'))
  const hasCanvas2d = typeof document !== 'undefined' && Boolean(document.createElement('canvas').getContext('2d'))
  return {
    browser,
    browserVersion: null,
    platform: typeof navigator === 'undefined' ? 'unknown' : navigator.platform,
    crossOriginIsolated,
    sharedArrayBuffer: hasSharedArrayBuffer,
    wasmSimd: false,
    wasmThreads: crossOriginIsolated && hasSharedArrayBuffer,
    webCodecsVideo: hasVideoDecoder,
    webCodecsAudio: hasAudioDecoder,
    webGpu: hasWebGpu,
    webGl2: hasWebGl2,
    canvas2d: hasCanvas2d,
    workerMediaSource: false,
    quirks: [],
  }
}

