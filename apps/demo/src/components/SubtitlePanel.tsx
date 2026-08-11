import type { DiagnosticState, SubtitleDiagnostics } from '../diagnostics'

interface SubtitlePanelProps {
  readonly state: DiagnosticState<SubtitleDiagnostics>
  readonly resetKey: string
}

export function SubtitlePanel({ state, resetKey }: SubtitlePanelProps) {
  const value = state.status === 'ready' ? state.value : state.status === 'failed' ? state.value : null
  const selected = value?.tracks.find((track) => track.id === value.selectedTrackId)
  return (
    <section className="diagnostic-panel" data-testid="subtitles-panel" data-status={state.status} data-reset-key={resetKey}>
      <header className="diagnostic-heading"><span>04</span><h2>Subtitles</h2><i data-tone={state.status}>{state.status}</i></header>
      {value ? (
        <dl className="diagnostic-list">
          <div><dt>Overlay state</dt><dd>{value.state}</dd></div>
          <div><dt>Tracks</dt><dd>{value.tracks.length}</dd></div>
          <div><dt>Selected</dt><dd>{selected?.name ?? 'Off'}</dd></div>
          <div><dt>Format</dt><dd>{selected?.format?.toUpperCase() ?? 'Pending'}</dd></div>
        </dl>
      ) : <p className="diagnostic-placeholder">{state.status === 'loading' ? 'Enumerating subtitle tracks' : 'No subtitle state available'}</p>}
    </section>
  )
}
