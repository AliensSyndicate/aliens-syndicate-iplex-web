import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/tokens.css'
import './styles/base.css'
import './styles/components.css'
import './styles/app.css'
import { App } from './app/App'
import { diag, diagnosticsEnabled, installDiagnostics } from './platform/diagnostics'
import { prepareTypography } from './styles/fonts'

installDiagnostics()

/**
 * A interface só é montada com a Google Sans pronta (sem FOUT). Enquanto
 * isso, o index.html mostra o indicador sem texto; dentro do app Samsung, a
 * tela do shell continua visível até o handshake app.ready.
 */
prepareTypography().then((typography) => {
  diag('typography', typography.ok ? `ok ${typography.ms}ms` : `fail ${typography.reason} ${typography.ms}ms`)
  if (!typography.ok) document.documentElement.classList.add('iplex-typography-fallback')
  document.getElementById('iplex-boot')?.remove()
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App typography={typography} />
    </StrictMode>,
  )
  // Verificação na TV (somente com ?diag=1&selftest=1 dentro do shell).
  if (diagnosticsEnabled()) void import('./platform/tvSelfTest').then((m) => {
    if (m.selfTestRequested()) void m.runTvSelfTest()
  })
})
