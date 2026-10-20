import { useState } from 'react'
import { useBackend } from '../../app/providers/BackendProvider'
import { useSession } from '../../app/providers/SessionProvider'
import { PinDialog } from '../../components/dialogs/PinDialog'
import { ProfileAvatar } from '../../components/navigation/ProfileAvatar'
import type { Profile } from '../../services/api/types'
import { classNames } from '../../utils/classNames'
import { isKids, requiresPin } from './profileRules'

const TYPE_LABEL: Record<Profile['type'], string | null> = { admin: null, regular: null, kids: 'Infantil', guest: 'Visitante' }

/** Perfis disponíveis (avatar, nome, indicação infantil) com proteção por PIN. */
export function ProfileGrid({ profiles, currentId, onEntered, autoFocusId }: { profiles: Profile[]; currentId?: string; onEntered?: () => void; autoFocusId?: string | null }) {
  const { backend } = useBackend()
  const session = useSession()
  const [pinFor, setPinFor] = useState<Profile | null>(null)
  const [busy, setBusy] = useState(false)

  const enter = async (profile: Profile, pinVerified = false) => {
    setBusy(true)
    try {
      await session.enterProfile(profile, { pinVerified })
      onEntered?.()
    } finally {
      setBusy(false)
    }
  }

  const select = (profile: Profile) => {
    if (busy) return
    if (profile.id === currentId) return onEntered?.()
    if (requiresPin(profile, profiles)) return setPinFor(profile)
    void enter(profile)
  }

  return (
    <>
      <ul className="iplex-profiles" aria-label="Perfis">
        {profiles.map((profile, index) => {
          const tag = TYPE_LABEL[profile.type]
          const locked = requiresPin(profile, profiles)
          return (
            <li key={profile.id} className="iplex-profiles__item">
              <button
                type="button"
                className={classNames('iplex-profile', 'iplex-focusable', profile.id === currentId && 'is-current')}
                onClick={() => select(profile)}
                aria-label={`${profile.name}${tag ? `, ${tag}` : ''}${locked ? ', protegido por PIN' : ''}${profile.id === currentId ? ', perfil atual' : ''}`}
                data-nav=""
                data-nav-id={`profile-${profile.id}`}
                data-nav-group="profiles"
                {...((autoFocusId ? profile.id === autoFocusId : index === 0) ? { 'data-nav-autofocus': '' } : {})}
              >
                <ProfileAvatar profile={profile} size="large" />
                <span className="iplex-profile__name">{profile.name}</span>
                {tag && <span className={classNames('iplex-profile__tag', isKids(profile) && 'is-kids')}>{tag}</span>}
              </button>
            </li>
          )
        })}
      </ul>
      {pinFor && (
        <PinDialog
          profileName={pinFor.name}
          verify={(pin) => backend.verifyProfilePin(pinFor.id, pin)}
          onCancel={() => setPinFor(null)}
          onSuccess={() => {
            const target = pinFor
            setPinFor(null)
            void enter(target, true)
          }}
        />
      )}
    </>
  )
}
