import { useEffect, useRef } from 'react'
import { ERROR_COPY } from '../../components/feedback/errorCopy'
import { AccountBadge } from '../../components/navigation/AccountBadge'
import { useBackend } from '../../app/providers/BackendProvider'
import { IplexLogo } from '../../components/ui/IplexLogo'
import { IplexText } from '../../components/ui/IplexText'
import { initialTarget, focusElement } from '../../navigation/spatial'
import { useBackHandler } from '../../navigation/FocusProvider'
import type { AppError } from '../../services/api/errors'
import type { Profile } from '../../services/api/types'
import { classNames } from '../../utils/classNames'
import { ProfileGrid } from './ProfileGrid'

/**
 * Seleção de perfis: ÚNICA tela oficial, usada na inicialização e ao tocar no avatar do menu principal.
 * Com `onClose` ela abre por cima do app (sem reiniciá-lo), com o perfil atual marcado; Voltar fecha.
 * A edição de perfis é do iPlex Gestor (não existe aqui).
 */
export function ProfileSelectScreen({ profiles, notice, currentId, onClose }: { profiles: Profile[]; notice?: AppError | null; currentId?: string; onClose?: () => void }) {
  const { backend } = useBackend()
  const account = backend.accountIdentity()
  const ref = useRef<HTMLElement>(null)
  useBackHandler(() => {
    onClose?.()
    return true
  }, !!onClose)
  useEffect(() => {
    const previous = onClose ? (document.activeElement as HTMLElement | null) : null
    const id = setTimeout(() => {
      const target = initialTarget(onClose ? ref.current ?? undefined : undefined)
      if (target) focusElement(target)
    }, 0)
    return () => {
      clearTimeout(id)
      if (previous && document.body.contains(previous)) focusElement(previous)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <main ref={ref} className={classNames('iplex-screen', 'iplex-profile-select', onClose && 'iplex-profile-select--overlay')} {...(onClose ? { 'data-nav-scope': '' } : {})}>
      <IplexLogo size="small" className="iplex-profile-select__logo" />
      {account && account.name && <AccountBadge account={account} className="iplex-profile-select__account" />}
      <IplexText variant="page-title" className="iplex-profile-select__title">
        Quem está assistindo?
      </IplexText>
      {notice && (
        <div className="iplex-notice" role="alert">
          <IplexText variant="content-title" as="p">{ERROR_COPY[notice.kind].title}</IplexText>
          <IplexText variant="meta">{ERROR_COPY[notice.kind].description}</IplexText>
        </div>
      )}
      <ProfileGrid profiles={profiles} currentId={currentId} autoFocusId={currentId} onEntered={onClose} />
      <IplexText variant="caption" className="iplex-profile-select__hint">
        Perfis são criados e editados no iPlex Gestor.
      </IplexText>
    </main>
  )
}
