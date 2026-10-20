import type { Profile } from '../../services/api/types'
import { classNames } from '../../utils/classNames'

/**
 * Representação do perfil. O backend não fornece imagem de avatar: usa-se a
 * inicial do nome sobre a superfície oficial (sem cores novas).
 */
export function ProfileAvatar({ profile, size = 'small', className }: { profile: Pick<Profile, 'name' | 'type'>; size?: 'small' | 'large'; className?: string }) {
  const initial = (profile.name.trim()[0] ?? '?').toLocaleUpperCase('pt-BR')
  return (
    <span className={classNames('iplex-avatar', `iplex-avatar--${size}`, profile.type === 'kids' && 'iplex-avatar--kids', className)} aria-hidden="true">
      {initial}
    </span>
  )
}
