import { useState } from 'react'
import type { Profile } from '../../services/api/types'
import { classNames } from '../../utils/classNames'
import { accountInitials } from './AccountBadge'

/**
 * Avatar do perfil: a foto, quando existe (`photoUrl`); senão as iniciais das duas primeiras palavras do nome
 * ("Charles Santos" → "CS"; nome de uma palavra → uma letra). Visitante: sempre "V".
 */
export function ProfileAvatar({ profile, size = 'small', className, photoUrl }: { profile: Pick<Profile, 'name' | 'type'>; size?: 'small' | 'large'; className?: string; photoUrl?: string | null }) {
  const [failed, setFailed] = useState(false)
  const photo = photoUrl && !failed ? photoUrl : null
  const initials = profile.type === 'guest' ? 'V' : accountInitials(profile.name)
  return (
    <span className={classNames('iplex-avatar', `iplex-avatar--${size}`, profile.type === 'kids' && 'iplex-avatar--kids', photo && 'iplex-avatar--photo', className)} aria-hidden="true">
      {photo ? <img src={photo} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : initials}
    </span>
  )
}
