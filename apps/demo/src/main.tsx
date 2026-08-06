import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

const root = document.getElementById('root')
if (!root) throw new Error('DEMO_ROOT_NOT_FOUND')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

