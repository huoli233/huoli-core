/** Mount the local React renderer before Electron reveals the welcome window. */
import '@huoli/huoli-client-ui-theme/src/styles/design-platform.css'
import '@huoli/huoli-client-ui-theme/src/styles/gradient-shadow-text.css'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { Welcome } from './WelcomePage.tsx'
import type { WelcomeApi } from '../welcome-api.ts'

declare global {
  interface Window {
    huoliWelcome: WelcomeApi
  }
}

const container = document.getElementById('root')
if (container === null) throw new Error('desktop welcome: missing React root')
const root = createRoot(container)
flushSync(() => { root.render(<Welcome api={window.huoliWelcome} />) })
window.addEventListener('pagehide', () => { root.unmount() }, { once: true })
