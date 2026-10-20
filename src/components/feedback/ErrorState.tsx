import { useEffect, useRef } from 'react'
import { AppError, type AppErrorKind } from '../../services/api/errors'
import { IplexButton } from '../ui/IplexButton'
import { IplexLogo } from '../ui/IplexLogo'
import { IplexText } from '../ui/IplexText'
import { ERROR_COPY } from './errorCopy'

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
  onRetry?: () => void
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

  useEffect(() => {
    if (inline) return
    buttonRef.current?.focus()
  }, [inline, resolved])

  return (
    <section className={inline ? 'iplex-state iplex-state--inline' : 'iplex-state iplex-state--screen'} role="alert" aria-live="assertive" data-error-kind={resolved}>
      {showLogo && !inline && <IplexLogo size="small" className="iplex-state__logo" />}
      <IplexText variant="page-title" as="h1" className="iplex-state__title">
        {copy.title}
      </IplexText>
      <IplexText variant="description" className="iplex-state__description">
        {copy.description}
      </IplexText>
      {detail && <IplexText variant="caption" className="iplex-state__detail">{detail}</IplexText>}
      {(canRetry || secondary) && (
        <div className="iplex-state__actions">
          {canRetry && (
            <IplexButton ref={buttonRef} onClick={onRetry} navId="error-retry" autoFocus>
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
