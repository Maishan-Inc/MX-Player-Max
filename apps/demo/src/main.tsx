import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import '@mx-player-max/ui/style.css'
import './styles.css'

const root = document.getElementById('root')
if (!root) throw new Error('DEMO_ROOT_NOT_FOUND')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
