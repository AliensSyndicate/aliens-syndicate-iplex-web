import { useEffect } from 'react'
import { ERROR_COPY } from '../../components/feedback/errorCopy'
import { AccountBadge } from '../../components/navigation/AccountBadge'
import { useBackend } from '../../app/providers/BackendProvider'
import { IplexLogo } from '../../components/ui/IplexLogo'
import { IplexText } from '../../components/ui/IplexText'
import { initialTarget, focusElement } from '../../navigation/spatial'
import type { AppError } from '../../services/api/errors'
import type { Profile } from '../../services/api/types'
import { ProfileGrid } from './ProfileGrid'

/** Seleção de perfis. A edição de perfis é do iPlex Gestor (não existe aqui). */
export function ProfileSelectScreen({ profiles, notice }: { profiles: Profile[]; notice: AppError | null }) {
  const { backend } = useBackend()
  const account = backend.accountIdentity()
  useEffect(() => {
    const id = setTimeout(() => {
      const target = initialTarget()
      if (target) focusElement(target)
    }, 0)
    return () => clearTimeout(id)
  }, [])
  return (
    <main className="iplex-screen iplex-profile-select">
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
      <ProfileGrid profiles={profiles} />
      <IplexText variant="caption" className="iplex-profile-select__hint">
        Perfis são criados e editados no iPlex Gestor.
      </IplexText>
    </main>
  )
}
