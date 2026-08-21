import type { DiagnosticState, SubtitleDiagnostics } from '../diagnostics'
import type { DemoDiagnosticsCopy } from '../i18n'

interface SubtitlePanelProps {
  readonly state: DiagnosticState<SubtitleDiagnostics>
  readonly resetKey: string
  readonly copy: DemoDiagnosticsCopy
}

export function SubtitlePanel({ state, resetKey, copy }: SubtitlePanelProps) {
  const value = state.status === 'ready' ? state.value : state.status === 'failed' ? state.value : null
  const selected = value?.tracks.find((track) => track.id === value.selectedTrackId)
  return (
    <section className="diagnostic-panel" data-testid="subtitles-panel" data-status={state.status} data-reset-key={resetKey}>
      <header className="diagnostic-heading"><span>04</span><h2>{copy.subtitleTitle}</h2><i data-tone={state.status}>{state.status}</i></header>
      {value ? (
        <dl className="diagnostic-list">
          <div><dt>{copy.subtitleState}</dt><dd>{value.state}</dd></div>
          <div><dt>{copy.subtitleTracks}</dt><dd>{value.tracks.length}</dd></div>
          <div><dt>{copy.subtitleSelected}</dt><dd>{selected?.name ?? copy.off}</dd></div>
          <div><dt>{copy.subtitleFormat}</dt><dd>{selected?.format?.toUpperCase() ?? copy.pending}</dd></div>
        </dl>
      ) : <p className="diagnostic-placeholder">{state.status === 'loading' ? copy.subtitleLoading : copy.subtitleEmpty}</p>}
    </section>
  )
}
