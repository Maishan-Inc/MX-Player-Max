import type { PlayerUiLabels } from './contracts'
import { frameCounters, type StatsInput } from './stats'

export interface TroubleshootFinding {
  readonly code: string
  readonly message: string
}

export interface TroubleshootReport {
  readonly findings: readonly TroubleshootFinding[]
  readonly environment: readonly (readonly [string, string])[]
}

/** Ratio of dropped frames above which the report calls out a rendering problem. */
export const DROPPED_FRAME_THRESHOLD = 0.01

export function buildTroubleshootReport(input: StatsInput, labels: PlayerUiLabels, userAgent: string): TroubleshootReport {
  const { snapshot } = input
  const findings: TroubleshootFinding[] = []
  const counters = frameCounters(input)
  if (snapshot.lastError) findings.push({ code: snapshot.lastError.code, message: labels.troubleshootError })
  if (counters !== null && counters.total > 60 && counters.dropped / counters.total > DROPPED_FRAME_THRESHOLD) {
    findings.push({ code: 'UI_DROPPED_FRAMES', message: labels.troubleshootDroppedFrames })
  }
  if (snapshot.buffering || (snapshot.state === 'playing' && snapshot.bufferedAhead < 1_000_000)) {
    findings.push({ code: 'UI_BUFFER_STARVED', message: labels.troubleshootBuffering })
  }
  if (input.customVideoStats !== null && input.audioClock !== null && input.audioClock.source !== 'audio-context') {
    findings.push({ code: 'UI_NO_AUDIO_CLOCK', message: labels.troubleshootNoAudioClock })
  }
  if (input.selection?.backend.kind === 'wasm') {
    findings.push({ code: 'UI_SOFTWARE_DECODE', message: labels.troubleshootSoftwareDecode })
  }
  const environment: (readonly [string, string])[] = [
    ['backend', input.selection?.backend.kind ?? '-'],
    ['renderer', input.rendererKind ?? input.selection?.backend.renderer ?? '-'],
    ['intent', input.selection?.intent ?? '-'],
    ['container', input.media?.container ?? '-'],
    ['state', snapshot.state],
    ['bufferedAhead', `${(snapshot.bufferedAhead / 1_000_000).toFixed(2)} s`],
    ['frames', counters === null ? '-' : `${counters.dropped}/${counters.total}`],
    ['rate', `${snapshot.playbackRate}x`],
    ['viewport', `${Math.round(input.viewport.width)}x${Math.round(input.viewport.height)}@${input.viewport.devicePixelRatio}`],
    ['userAgent', userAgent],
  ]
  return { findings, environment }
}
