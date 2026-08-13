import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import '@mx-player-max/ui/style.css'
import './styles.css'

const acceptanceMode = new URL(location.href).searchParams.get('wasmAcceptance')
const mediaAcceptanceMode = new URL(location.href).searchParams.get('mediaAcceptance')
const performanceAcceptanceMode = new URL(location.href).searchParams.get('performanceAcceptance')
if (performanceAcceptanceMode !== null) {
  void import('./performance-acceptance').then(({ runPerformanceAcceptance }) => runPerformanceAcceptance(performanceAcceptanceMode))
} else if (mediaAcceptanceMode !== null) {
  void import('./media-acceptance').then(({ runMediaAcceptance }) => runMediaAcceptance(mediaAcceptanceMode))
} else if (acceptanceMode !== null) {
  void import('./wasm-acceptance').then(({ runWasmAcceptance }) => runWasmAcceptance(acceptanceMode))
} else {
  const root = document.getElementById('root')
  if (!root) throw new Error('DEMO_ROOT_NOT_FOUND')
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
