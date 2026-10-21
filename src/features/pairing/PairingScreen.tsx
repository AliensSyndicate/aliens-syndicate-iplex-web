import { useEffect, useMemo, useRef, useState } from 'react'
import { useBackend } from '../../app/providers/BackendProvider'
import { usePlatform } from '../../app/providers/PlatformProvider'
import { useSession } from '../../app/providers/SessionProvider'
import { ErrorState } from '../../components/feedback/ErrorState'
import { Spinner } from '../../components/feedback/LoadingState'
import { IplexButton } from '../../components/ui/IplexButton'
import { IplexLogo } from '../../components/ui/IplexLogo'
import { IplexText } from '../../components/ui/IplexText'
import { TIMING } from '../../config/features'
import { createPairingController, PAIRING_URI, type PairingState } from './pairingController'
import { buildPairingRequest } from './pairingRequest'
import { QrCode } from './QrCode'

function useCountdown(expiresAt: number | null) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!expiresAt) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [expiresAt])
  if (!expiresAt) return null
  const total = Math.max(0, Math.round((expiresAt - now) / 1000))
  const seconds = total % 60
  return `${Math.floor(total / 60)}:${seconds < 10 ? '0' : ''}${seconds}`
}

/** Vinculação da TV a uma família pelo iPlex Gestor. */
export function PairingScreen() {
  const { backend } = useBackend()
  const platform = usePlatform()
  const session = useSession()
  const [state, setState] = useState<PairingState>({ phase: 'creating' })
  // Only the device identity: visibility/network changes must not restart the
  // pairing (a new code would invalidate the one the Gestor is confirming).
  const { kind, info } = platform
  const request = useMemo(() => buildPairingRequest({ kind, info }), [kind, info])
  const controller = useMemo(
    () =>
      createPairingController({
        backend,
        request,
        initialDelayMs: TIMING.pairingPollInitialMs,
        maxDelayMs: TIMING.pairingPollMaxMs,
        onChange: setState,
      }),
    [backend, request],
  )
  const regenerate = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    void controller.start()
    return () => controller.cancel()
  }, [controller])

  useEffect(() => {
    if (state.phase !== 'linked') return
    const id = setTimeout(() => session.paired(state.identity), 1500)
    return () => clearTimeout(id)
  }, [state, session])

  useEffect(() => {
    if (state.phase === 'expired' || state.phase === 'waiting') regenerate.current?.focus()
  }, [state.phase])

  const countdown = useCountdown(state.phase === 'waiting' ? state.session.expiresAt : null)

  if (state.phase === 'error') {
    return <ErrorState error={state.error} onRetry={() => void controller.start()} retryLabel="Tentar novamente" />
  }

  return (
    <main className="iplex-screen iplex-pairing">
      <IplexLogo size="small" className="iplex-pairing__logo" />
      <div className="iplex-pairing__layout">
        <div className="iplex-pairing__text">
          <IplexText variant="page-title">Vincule esta TV à sua família</IplexText>
          {state.phase === 'linked' ? (
            <IplexText variant="description" className="iplex-pairing__lead">
              TV vinculada com sucesso. Carregando seus perfis…
            </IplexText>
          ) : state.phase === 'expired' ? (
            <IplexText variant="description" className="iplex-pairing__lead">
              O código expirou. Gere um novo código para continuar.
            </IplexText>
          ) : (
            <>
              <ol className="iplex-pairing__steps">
                <li>Abra o iPlex Gestor no celular do administrador da família.</li>
                <li>Vá em Dispositivos e toque em Adicionar.</li>
                <li>{state.phase === 'waiting' && !state.session.formattedCode ? 'Leia o QR Code ao lado.' : 'Leia o QR Code ou digite o código abaixo.'}</li>
              </ol>
              <div className="iplex-pairing__code" aria-live="polite">
                {state.phase === 'waiting' ? (
                  <>
                    {state.session.formattedCode && state.session.code && (
                      <span className="iplex-pairing__digits" aria-label={`Código ${state.session.code.split('').join(' ')}`}>
                        {state.session.formattedCode}
                      </span>
                    )}
                    <IplexText variant="meta">
                      Aguardando confirmação no Gestor{countdown ? ` · expira em ${countdown}` : ''}
                    </IplexText>
                  </>
                ) : (
                  <Spinner label="Gerando código" />
                )}
              </div>
            </>
          )}
          <div className="iplex-pairing__actions">
            {(state.phase === 'waiting' || state.phase === 'expired') && (
              <IplexButton ref={regenerate} variant={state.phase === 'expired' ? 'primary' : 'secondary'} onClick={() => void controller.start()} navId="pair-new" autoFocus>
                Gerar novo código
              </IplexButton>
            )}
          </div>
        </div>
        {state.phase === 'waiting' && (
          <div className="iplex-pairing__qr">
            <QrCode value={PAIRING_URI(state.session.token)} label="QR Code de vinculação para o iPlex Gestor" />
          </div>
        )}
      </div>
    </main>
  )
}
