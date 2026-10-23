import { useState } from 'react'
import type { AccountIdentity } from '../../services/api/types'
import { classNames } from '../../utils/classNames'
import { IplexText } from '../ui/IplexText'

/**
 * Identificação da CONTA vinculada à TV (Gestor): foto do provedor quando existe,
 * senão as iniciais. Não é um perfil de visualização e não substitui o avatar deles.
 */
/** Iniciais sem foto: a primeira letra dos dois primeiros nomes ("Charles Santos" → "CS"). */
export function accountInitials(name: string): string {
  const letters = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]!)
    .join('')
  return (letters || '?').toLocaleUpperCase('pt-BR')
}

export function AccountAvatar({ account, className }: { account: AccountIdentity; className?: string }) {
  const [failed, setFailed] = useState(false)
  const initial = accountInitials(account.name)
  const photo = account.photoUrl && !failed ? account.photoUrl : null
  return (
    <span className={classNames('iplex-avatar', 'iplex-avatar--small', 'iplex-avatar--photo', className)} aria-hidden="true">
      {photo ? <img src={photo} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : initial}
    </span>
  )
}

export function AccountBadge({ account, className }: { account: AccountIdentity; className?: string }) {
  return (
    <div className={classNames('iplex-account-badge', className)}>
      <AccountAvatar account={account} />
      <IplexText variant="meta" className="iplex-account-badge__name">
        {account.name}
      </IplexText>
    </div>
  )
}
