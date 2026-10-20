import { useState, type ReactNode } from 'react'
import { ErrorState } from '../components/feedback/ErrorState'
import type { TypographyResult } from '../styles/fonts'

/**
 * Falha ao carregar a Google Sans (rede, prazo): estado recuperável, nunca
 * bloqueio permanente. "Tentar novamente" recarrega a página (a fonte é
 * buscada de novo); "Continuar" segue com a fonte alternativa documentada
 * (--iplex-font-family) — única situação em que ela aparece.
 * Fica dentro do PlatformProvider: o handshake com o shell já aconteceu.
 */
export function TypographyGate({ result, children }: { result: TypographyResult; children: ReactNode }) {
  const [accepted, setAccepted] = useState(result.ok)
  if (accepted) return <>{children}</>
  return (
    <ErrorState
      kind="typography"
      detail={`Diagnóstico: ${result.ok ? '' : result.reason}`}
      onRetry={() => window.location.reload()}
      secondary={{ label: 'Continuar', onClick: () => setAccepted(true) }}
    />
  )
}
