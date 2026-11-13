import { useEffect, useRef, useState } from 'react'
import { TIMING } from '../../config/features'
import { AppError, type AppErrorKind } from '../../services/api/errors'
import { IplexButton } from '../ui/IplexButton'
import { IplexLogo } from '../ui/IplexLogo'
import { IplexText } from '../ui/IplexText'
import { ERROR_COPY } from './errorCopy'
import { Spinner } from './LoadingState'

/** Falhas da fonte IPTV costumam voltar na hora: o pedido só é refeito ao fim do spinner, para a nova tentativa ser percebida. */
const DELAYED_RETRY = new Set<AppErrorKind>(['iptv-unavailable', 'iptv-not-configured', 'playback-error'])
/** Tempo mínimo do spinner nos demais erros (o pedido sai na hora). */
const MIN_RETRY_SPINNER_MS = 800

/**
 * Tela de erro e recuperação. Design obrigatório: fundo sólido #0F0F0F, sem
 * card, logo pequeno, título #F1F1F1, descrição #B7B7B7, botão Primary sem ícone.
 */
export function ErrorState({
  error,
  kind,
  onRetry,
  retryLabel,
  secondary,
  inline,
  showLogo = true,
  detail,
}: {
  error?: AppError | null
  kind?: AppErrorKind
  /** Pode devolver uma Promise: o spinner fica até ela terminar. */
  onRetry?: () => void | Promise<unknown>
  retryLabel?: string
  secondary?: { label: string; onClick: () => void }
  /** Dentro de uma seção (sem ocupar a tela toda). */
  inline?: boolean
  showLogo?: boolean
  detail?: string
}) {
  const resolved: AppErrorKind = kind ?? error?.kind ?? 'unknown'
  const copy = ERROR_COPY[resolved]
  const buttonRef = useRef<HTMLButtonElement>(null)
  const canRetry = !!onRetry && !!(retryLabel ?? copy.retry)
  const [retrying, setRetrying] = useState(false)
  const retried = useRef(false)
  const retryRef = useRef(onRetry)
  useEffect(() => {
    retryRef.current = onRetry
  }, [onRetry])

  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  /** Falha da fonte: o pedido sai ao fim do spinner; se a tela sair antes, nada é repetido. */
  const [delayed, setDelayed] = useState(false)
  useEffect(() => {
    if (!delayed) return
    const id = setTimeout(() => {
      setDelayed(false)
      setRetrying(false)
      void retryRef.current?.()
    }, TIMING.retryFeedbackMs)
    return () => clearTimeout(id)
  }, [delayed])

  useEffect(() => {
    if (retrying || (inline && !retried.current)) return
    retried.current = false
    buttonRef.current?.focus()
  }, [inline, resolved, retrying])

  /**
   * "Tentar novamente" sempre mostra o spinner. Nos demais erros o pedido sai na hora e o spinner
   * fica o tempo mínimo e enquanto a Promise devolvida por onRetry estiver pendente.
   */
  const retry = () => {
    if (retrying) return
    retried.current = true
    setRetrying(true)
    if (DELAYED_RETRY.has(resolved)) {
      setDelayed(true)
      return
    }
    let pending: unknown
    try {
      pending = onRetry?.()
    } catch {
      pending = undefined
    }
    const minimum = new Promise((resolve) => setTimeout(resolve, MIN_RETRY_SPINNER_MS))
    void Promise.all([minimum, Promise.resolve(pending).catch(() => undefined)]).then(() => {
      if (mounted.current) setRetrying(false)
    })
  }

  if (retrying) {
    return (
      <section className={inline ? 'iplex-state iplex-state--inline' : 'iplex-state iplex-state--screen'} data-error-kind={resolved}>
        <Spinner label="Tentando novamente" />
      </section>
    )
  }

  return (
    <section className={inline ? 'iplex-state iplex-state--inline' : 'iplex-state iplex-state--screen'} role="alert" aria-live="assertive" data-error-kind={resolved}>
      {showLogo && !inline && <IplexLogo size="screen" className="iplex-state__logo" />}
      <IplexText variant="page-title" as="h1" className="iplex-state__title">
        {copy.title}
      </IplexText>
      <IplexText variant={inline ? 'description' : 'body'} secondary className="iplex-state__description">
        {copy.description}
      </IplexText>
      {detail && <IplexText variant="caption" className="iplex-state__detail">{detail}</IplexText>}
      {(canRetry || secondary) && (
        <div className="iplex-state__actions">
          {canRetry && (
            <IplexButton ref={buttonRef} onClick={retry} navId="error-retry" autoFocus>
              {retryLabel ?? copy.retry!}
            </IplexButton>
          )}
          {secondary && (
            <IplexButton variant="secondary" onClick={secondary.onClick} navId="error-secondary" autoFocus={!canRetry}>
              {secondary.label}
            </IplexButton>
          )}
        </div>
      )}
    </section>
  )
}
