import type { PlaybackDecisionTrace } from '@mx-player-max/types'
import type { DiagnosticState } from '../diagnostics'

interface DecisionPanelProps {
  readonly state: DiagnosticState<PlaybackDecisionTrace>
  readonly resetKey: string
}

export function DecisionPanel({ state, resetKey }: DecisionPanelProps) {
  const trace = state.status === 'ready' ? state.value : state.status === 'failed' ? state.value : null
  return (
    <section className="diagnostic-panel" data-testid="decision-panel" data-status={state.status} data-reset-key={resetKey}>
      <header className="diagnostic-heading"><span>02</span><h2>Decision</h2><i data-tone={state.status}>{state.status}</i></header>
      {trace ? <DecisionTrace trace={trace} /> : <p className="diagnostic-placeholder">{state.status === 'loading' ? 'Ranking available playback candidates' : 'No decision trace for this epoch'}</p>}
    </section>
  )
}

function DecisionTrace({ trace }: { readonly trace: PlaybackDecisionTrace }) {
  const selected = trace.candidates.find((candidate) => candidate.candidateId === trace.selectedCandidateId)
  return (
    <>
      <dl className="diagnostic-list">
        <div><dt>Backend</dt><dd>{selected?.kind ?? 'Pending'}</dd></div>
        <div><dt>Renderer</dt><dd>{selected?.renderer ?? 'Pending'}</dd></div>
        <div><dt>Container</dt><dd>{trace.media.container || 'Unknown'}</dd></div>
        <div><dt>Epoch</dt><dd>{trace.sessionEpoch}</dd></div>
      </dl>
      <ol className="candidate-list" aria-label="Playback candidates">
        {trace.candidates.slice(0, 3).map((candidate) => {
          const attempt = trace.attempts.find((entry) => entry.candidateId === candidate.candidateId)
          return <li key={candidate.candidateId}><span>{candidate.kind}</span><strong>{candidate.finalScore}</strong><small>{attempt?.status ?? 'ranked'}</small></li>
        })}
      </ol>
    </>
  )
}
