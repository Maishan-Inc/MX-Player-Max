import { useEffect, useState } from 'react'
import type { MXPlayer } from '@mx-player-max/sdk'
import type { PlaybackDecisionTrace } from '@mx-player-max/types'
import {
  decisionDiagnostic,
  emptyDiagnostic,
  failedDiagnostic,
  loadingDiagnostic,
  probeDiagnostics,
  readyDiagnostic,
  runtimeDiagnostics,
  subtitleDiagnostics,
  type DiagnosticState,
  type ProbeDiagnostics,
  type RuntimeDiagnostics,
  type SubtitleDiagnostics,
} from '../diagnostics'
import { DecisionPanel } from './DecisionPanel'
import { ProbePanel } from './ProbePanel'
import { RuntimePanel } from './RuntimePanel'
import { SubtitlePanel } from './SubtitlePanel'
import type { DemoDiagnosticsCopy } from '../i18n'

interface DiagnosticsPanelProps {
  readonly player: MXPlayer | null
  readonly resetKey: string
  readonly copy: DemoDiagnosticsCopy
}

interface DiagnosticsSnapshot {
  readonly probe: DiagnosticState<ProbeDiagnostics>
  readonly decision: DiagnosticState<PlaybackDecisionTrace>
  readonly runtime: DiagnosticState<RuntimeDiagnostics>
  readonly subtitles: DiagnosticState<SubtitleDiagnostics>
}

const EMPTY: DiagnosticsSnapshot = {
  probe: emptyDiagnostic(),
  decision: emptyDiagnostic(),
  runtime: emptyDiagnostic(),
  subtitles: emptyDiagnostic(),
}

export function DiagnosticsPanel({ player, resetKey, copy }: DiagnosticsPanelProps) {
  const [snapshot, setSnapshot] = useState<DiagnosticsSnapshot>(EMPTY)

  useEffect(() => {
    if (!player) { setSnapshot(EMPTY); return }
    let active = true
    setSnapshot({ probe: loadingDiagnostic(), decision: loadingDiagnostic(), runtime: loadingDiagnostic(), subtitles: loadingDiagnostic() })

    const updateRuntime = (): void => {
      if (!active) return
      try {
        const value = runtimeDiagnostics(player)
        setSnapshot((current) => ({ ...current, runtime: value.playback.lastError ? failedDiagnostic(value.playback.lastError.code, value) : value.playback.state === 'loading' ? loadingDiagnostic() : readyDiagnostic(value) }))
      } catch {
        setSnapshot((current) => ({ ...current, runtime: failedDiagnostic('RUNTIME_SNAPSHOT_UNAVAILABLE') }))
      }
    }
    const updateSubtitles = (): void => {
      if (!active) return
      try {
        const value = subtitleDiagnostics(player)
        const next = value.state === 'loading' ? loadingDiagnostic<SubtitleDiagnostics>() : value.state === 'error' ? failedDiagnostic('SUBTITLE_STATE_ERROR', value) : readyDiagnostic(value)
        setSnapshot((current) => ({ ...current, subtitles: next }))
      } catch {
        setSnapshot((current) => ({ ...current, subtitles: failedDiagnostic('SUBTITLE_SNAPSHOT_UNAVAILABLE') }))
      }
    }
    const updateDecision = (trace: PlaybackDecisionTrace): void => {
      if (active) setSnapshot((current) => ({ ...current, decision: decisionDiagnostic(trace) }))
    }

    const unsubscribers = [
      player.on('capabilities', ({ context }) => { if (active) setSnapshot((current) => ({ ...current, probe: readyDiagnostic(probeDiagnostics(context)) })) }),
      player.on('decisionchange', ({ trace }) => updateDecision(trace)),
      player.on('playbackchange', updateRuntime),
      player.on('backendchange', updateRuntime),
      player.on('rendererchange', updateRuntime),
      player.on('rendererstats', updateRuntime),
      player.on('clockupdate', updateRuntime),
      player.on('subtitletrackchange', updateSubtitles),
      player.on('subtitlestatechange', updateSubtitles),
      player.on('error', ({ error }) => {
        if (!active) return
        setSnapshot((current) => ({
          ...current,
          probe: current.probe.status === 'loading' ? failedDiagnostic(error.code) : current.probe,
          runtime: failedDiagnostic(error.code, safeRuntime(player)),
        }))
      }),
    ]

    queueMicrotask(() => {
      if (!active) return
      updateRuntime()
      updateSubtitles()
      const trace = player.decisionTrace
      if (trace && trace.sessionEpoch === player.playback.sessionEpoch) updateDecision(trace)
    })

    return (): void => {
      active = false
      for (const unsubscribe of unsubscribers) unsubscribe()
    }
  }, [player, resetKey])

  return (
    <section className="diagnostics" aria-label={copy.sectionLabel} data-demo-reveal>
      <div className="diagnostics-title"><span>{copy.eyebrow}</span><strong>{copy.title}</strong></div>
      <div className="diagnostics-grid">
        <ProbePanel state={snapshot.probe} resetKey={resetKey} copy={copy} />
        <DecisionPanel state={snapshot.decision} resetKey={resetKey} copy={copy} />
        <RuntimePanel state={snapshot.runtime} resetKey={resetKey} copy={copy} />
        <SubtitlePanel state={snapshot.subtitles} resetKey={resetKey} copy={copy} />
      </div>
    </section>
  )
}

function safeRuntime(player: MXPlayer): RuntimeDiagnostics | null {
  try { return runtimeDiagnostics(player) } catch { return null }
}
