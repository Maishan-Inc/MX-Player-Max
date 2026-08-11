import type { DiagnosticState, RuntimeDiagnostics } from '../diagnostics'
import { secondsFromMicros } from '../diagnostics'

interface RuntimePanelProps {
  readonly state: DiagnosticState<RuntimeDiagnostics>
  readonly resetKey: string
}

export function RuntimePanel({ state, resetKey }: RuntimePanelProps) {
  const value = state.status === 'ready' ? state.value : state.status === 'failed' ? state.value : null
  return (
    <section className="diagnostic-panel" data-testid="runtime-panel" data-status={state.status} data-reset-key={resetKey}>
      <header className="diagnostic-heading"><span>03</span><h2>Runtime</h2><i data-tone={state.status}>{state.status}</i></header>
      {value ? (
        <dl className="diagnostic-list">
          <div><dt>Playback</dt><dd>{value.playback.state}</dd></div>
          <div><dt>Backend</dt><dd>{value.selection?.backend.kind ?? 'Pending'}</dd></div>
          <div><dt>Renderer</dt><dd>{value.rendererKind ?? value.selection?.backend.renderer ?? 'Native'}</dd></div>
          <div><dt>Buffer ahead</dt><dd>{secondsFromMicros(value.playback.bufferedAhead)}</dd></div>
          <div><dt>Dropped frames</dt><dd>{value.droppedFrames ?? 'Pending'}</dd></div>
          <div><dt>Master clock</dt><dd>{value.clockSource ?? 'Native media'}</dd></div>
        </dl>
      ) : <p className="diagnostic-placeholder">{state.status === 'loading' ? 'Waiting for the committed runtime' : 'Runtime is not initialized'}</p>}
    </section>
  )
}
