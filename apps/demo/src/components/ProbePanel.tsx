import type { DemoDiagnosticsCopy } from '../i18n'
import type { CapabilitySupport } from '@mx-player-max/types'
import type { DiagnosticState, ProbeDiagnostics, SupportTone } from '../diagnostics'
import { supportPresentation } from '../diagnostics'

interface ProbePanelProps {
  readonly state: DiagnosticState<ProbeDiagnostics>
  readonly resetKey: string
  readonly copy: DemoDiagnosticsCopy
}

export function ProbePanel({ state, resetKey, copy }: ProbePanelProps) {
  const value = state.status === 'ready' ? state.value : state.status === 'failed' ? state.value : null
  const toneText = (tone: SupportTone): string =>
    tone === 'supported' ? copy.supported : tone === 'unsupported' ? copy.unsupported : copy.unknown
  const evidence = (input: CapabilitySupport | boolean): { readonly tone: SupportTone; readonly text: string } => {
    const tone = supportPresentation(input).tone
    return { tone, text: toneText(tone) }
  }
  return (
    <section className="diagnostic-panel" data-testid="probe-panel" data-status={state.status} data-reset-key={resetKey}>
      <header className="diagnostic-heading"><span>01</span><h2>{copy.probeTitle}</h2><i data-tone={state.status}>{state.status}</i></header>
      {value ? (
        <dl className="diagnostic-list">
          <Metric label={copy.probeBrowser} value={value.browser} />
          <Metric label={copy.probePlatform} value={value.platform} />
          <SupportMetric label={copy.probeNativeMedia} evidence={evidence(value.nativePlayable)} />
          <SupportMetric label={copy.probeWebCodecs} evidence={evidence(value.webCodecsPlayable)} />
          <SupportMetric label={copy.probeWebGpu} evidence={evidence(value.webGpu)} />
          <SupportMetric label={copy.probeWasmThreads} evidence={evidence(value.wasmThreads)} />
          <SupportMetric label={copy.probeIsolated} evidence={evidence(value.crossOriginIsolated)} />
        </dl>
      ) : (
        <p className="diagnostic-placeholder">
          {state.status === 'loading' ? copy.probeLoading : state.status === 'failed' ? copy.probeFailed : copy.probeEmpty}
        </p>
      )}
    </section>
  )
}

interface SupportEvidence {
  readonly tone: SupportTone
  readonly text: string
}

function SupportMetric({ label, evidence }: { readonly label: string; readonly evidence: SupportEvidence }) {
  return <Metric label={label} value={evidence.text} support={evidence.tone} />
}

function Metric({ label, value, support }: { readonly label: string; readonly value: string; readonly support?: string }) {
  return <div><dt>{label}</dt><dd data-support={support}>{value}</dd></div>
}
