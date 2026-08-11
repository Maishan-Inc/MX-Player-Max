import type { DiagnosticState, ProbeDiagnostics } from '../diagnostics'
import { supportPresentation } from '../diagnostics'

interface ProbePanelProps {
  readonly state: DiagnosticState<ProbeDiagnostics>
  readonly resetKey: string
}

export function ProbePanel({ state, resetKey }: ProbePanelProps) {
  const value = state.status === 'ready' ? state.value : state.status === 'failed' ? state.value : null
  return (
    <section className="diagnostic-panel" data-testid="probe-panel" data-status={state.status} data-reset-key={resetKey}>
      <PanelHeading index="01" title="Probe" status={state.status} />
      {value ? (
        <dl className="diagnostic-list">
          <Metric label="Browser" value={value.browser} />
          <Metric label="Platform" value={value.platform} />
          <SupportMetric label="Native media" value={value.nativePlayable} />
          <SupportMetric label="WebCodecs" value={value.webCodecsPlayable} />
          <SupportMetric label="WebGPU" value={value.webGpu} />
          <SupportMetric label="WASM threads" value={value.wasmThreads} />
          <SupportMetric label="Cross-origin isolated" value={value.crossOriginIsolated} />
        </dl>
      ) : <PanelPlaceholder state={state.status} />}
    </section>
  )
}

function SupportMetric({ label, value }: { readonly label: string; readonly value: Parameters<typeof supportPresentation>[0] }) {
  const presentation = supportPresentation(value)
  return <Metric label={label} value={presentation.label} support={presentation.tone} />
}

function Metric({ label, value, support }: { readonly label: string; readonly value: string; readonly support?: string }) {
  return <div><dt>{label}</dt><dd data-support={support}>{value}</dd></div>
}

function PanelHeading({ index, title, status }: { readonly index: string; readonly title: string; readonly status: string }) {
  return <header className="diagnostic-heading"><span>{index}</span><h2>{title}</h2><i data-tone={status}>{status}</i></header>
}

function PanelPlaceholder({ state }: { readonly state: string }) {
  const copy = state === 'loading' ? 'Collecting public capability evidence' : state === 'failed' ? 'Probe did not complete' : 'Waiting for a media source'
  return <p className="diagnostic-placeholder">{copy}</p>
}
