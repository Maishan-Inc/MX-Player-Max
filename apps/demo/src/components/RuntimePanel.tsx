import type { DiagnosticState, RuntimeDiagnostics } from '../diagnostics'
import { secondsFromMicros } from '../diagnostics'
import type { DemoDiagnosticsCopy } from '../i18n'

interface RuntimePanelProps {
  readonly state: DiagnosticState<RuntimeDiagnostics>
  readonly resetKey: string
  readonly copy: DemoDiagnosticsCopy
}

export function RuntimePanel({ state, resetKey, copy }: RuntimePanelProps) {
  const value = state.status === 'ready' ? state.value : state.status === 'failed' ? state.value : null
  return (
    <section className="diagnostic-panel" data-testid="runtime-panel" data-status={state.status} data-reset-key={resetKey}>
      <header className="diagnostic-heading"><span>03</span><h2>{copy.runtimeTitle}</h2><i data-tone={state.status}>{state.status}</i></header>
      {value ? (
        <dl className="diagnostic-list">
          <div><dt>{copy.runtimePlayback}</dt><dd>{value.playback.state}</dd></div>
          <div><dt>{copy.runtimeBackend}</dt><dd>{value.selection?.backend.kind ?? copy.pending}</dd></div>
          <div><dt>{copy.runtimeRenderer}</dt><dd>{value.rendererKind ?? value.selection?.backend.renderer ?? 'native'}</dd></div>
          <div><dt>{copy.runtimeBuffer}</dt><dd>{secondsFromMicros(value.playback.bufferedAhead) ?? copy.pending}</dd></div>
          <div><dt>{copy.runtimeDropped}</dt><dd>{value.droppedFrames ?? copy.pending}</dd></div>
          <div><dt>{copy.runtimeClock}</dt><dd>{value.clockSource ?? copy.nativeClock}</dd></div>
        </dl>
      ) : <p className="diagnostic-placeholder">{state.status === 'loading' ? copy.runtimeLoading : copy.runtimeEmpty}</p>}
    </section>
  )
}
