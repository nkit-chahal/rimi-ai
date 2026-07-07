import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/tokens.css'
import './styles/base.css'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import { initObservability } from './observability.js'

initObservability()

const tree = (
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
)

createRoot(document.getElementById('root')).render(
  import.meta.env.DEV ? <StrictMode>{tree}</StrictMode> : tree
)
