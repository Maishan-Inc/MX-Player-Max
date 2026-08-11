import type {
  GeckoPlaybackQuality,
  PlatformDiagnostics,
  PlaybackQualityDiagnostics,
  StandardPlaybackQuality,
  WebCodecsAccelerationObservation,
} from './contracts'

interface DiagnosticVideoElement extends HTMLVideoElement {
  mozDecodedFrames?: number
  mozPresentedFrames?: number
  mozPaintedFrames?: number
  mozFrameDelay?: number
}

const MAX_ACCELERATION_OBSERVATIONS = 32

export function createPlatformDiagnostics(): PlatformDiagnostics {
  const observations: WebCodecsAccelerationObservation[] = []
  return {
    recordWebCodecsAcceleration(observation) {
      const normalized = normalizeObservation(observation)
      if (!normalized) return
      observations.push(normalized)
      if (observations.length > MAX_ACCELERATION_OBSERVATIONS) observations.shift()
    },
    snapshot(video = null) {
      return {
        playbackQuality: readPlaybackQualityDiagnostics(video),
        webCodecsAcceleration: observations.map(cloneObservation),
      }
    },
    reset() {
      observations.length = 0
    },
  }
}

export function readPlaybackQualityDiagnostics(
  video: HTMLVideoElement | null | undefined,
): PlaybackQualityDiagnostics {
  if (!video) return { standard: null, gecko: null }
  const diagnosticVideo = video as DiagnosticVideoElement
  return {
    standard: readStandardQuality(diagnosticVideo),
    gecko: readGeckoQuality(diagnosticVideo),
  }
}

function readStandardQuality(video: DiagnosticVideoElement): StandardPlaybackQuality | null {
  if (typeof video.getVideoPlaybackQuality !== 'function') return null
  try {
    const quality = video.getVideoPlaybackQuality()
    const result = {
      totalVideoFrames: normalizeCounter(quality.totalVideoFrames),
      droppedVideoFrames: normalizeCounter(quality.droppedVideoFrames),
      corruptedVideoFrames: normalizeCounter(quality.corruptedVideoFrames),
    }
    return Object.values(result).some((value) => value !== null) ? result : null
  } catch {
    return null
  }
}

function readGeckoQuality(video: DiagnosticVideoElement): GeckoPlaybackQuality | null {
  const result = {
    decodedFrames: normalizeCounter(video.mozDecodedFrames),
    presentedFrames: normalizeCounter(video.mozPresentedFrames),
    paintedFrames: normalizeCounter(video.mozPaintedFrames),
    frameDelaySeconds: normalizeNumber(video.mozFrameDelay),
  }
  return Object.values(result).some((value) => value !== null) ? result : null
}

function normalizeObservation(
  observation: WebCodecsAccelerationObservation,
): WebCodecsAccelerationObservation | null {
  const codec = observation.codec.trim()
  if (codec.length === 0 || codec.length > 128) return null
  return {
    codec,
    requestedPreference: observation.requestedPreference,
    support: observation.support,
    selected: observation.selected,
    reasons: [...new Set(observation.reasons.filter((reason) => reason.length > 0 && reason.length <= 128))].sort(),
  }
}

function cloneObservation(
  observation: WebCodecsAccelerationObservation,
): WebCodecsAccelerationObservation {
  return { ...observation, reasons: [...observation.reasons] }
}

function normalizeCounter(value: number | undefined): number | null {
  return Number.isSafeInteger(value) && (value ?? -1) >= 0 ? value ?? null : null
}

function normalizeNumber(value: number | undefined): number | null {
  return Number.isFinite(value) && (value ?? -1) >= 0 ? value ?? null : null
}
