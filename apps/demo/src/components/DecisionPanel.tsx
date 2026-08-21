import type { PlaybackDecisionTrace } from '@mx-player-max/types'
import type { DiagnosticState } from '../diagnostics'
import type { DemoDiagnosticsCopy } from '../i18n'

interface DecisionPanelProps {
  readonly state: DiagnosticState<PlaybackDecisionTrace>
  readonly resetKey: string
  readonly copy: DemoDiagnosticsCopy
}

export function DecisionPanel({ state, resetKey, copy }: DecisionPanelProps) {
  const trace = state.status === 'ready' ? state.value : state.status === 'failed' ? state.value : null
  return (
    <section className="diagnostic-panel" data-testid="decision-panel" data-status={state.status} data-reset-key={resetKey}>
      <header className="diagnostic-heading"><span>02</span><h2>{copy.decisionTitle}</h2><i data-tone={state.status}>{state.status}</i></header>
      {trace
        ? <DecisionTrace trace={trace} copy={copy} />
        : <p className="diagnostic-placeholder">{state.status === 'loading' ? copy.decisionLoading : copy.decisionEmpty}</p>}
    </section>
  )
}

function DecisionTrace({ trace, copy }: { readonly trace: PlaybackDecisionTrace; readonly copy: DemoDiagnosticsCopy }) {
  const selected = trace.candidates.find((candidate) => candidate.candidateId === trace.selectedCandidateId)
  return (
    <>
      <dl className="diagnostic-list">
        <div><dt>{copy.decisionBackend}</dt><dd>{selected?.kind ?? copy.pending}</dd></div>
        <div><dt>{copy.decisionRenderer}</dt><dd>{selected?.renderer ?? copy.pending}</dd></div>
        <div><dt>{copy.decisionContainer}</dt><dd>{trace.media.container || copy.unknown}</dd></div>
        <div><dt>{copy.decisionEpoch}</dt><dd>{trace.sessionEpoch}</dd></div>
      </dl>
      <ol className="candidate-list" aria-label={copy.decisionCandidates}>
        {trace.candidates.slice(0, 3).map((candidate) => {
          const attempt = trace.attempts.find((entry) => entry.candidateId === candidate.candidateId)
          return <li key={candidate.candidateId}><span>{candidate.kind}</span><strong>{candidate.finalScore}</strong><small>{attempt?.status ?? copy.decisionRanked}</small></li>
        })}
      </ol>
    </>
  )
}
