import { useReadySession } from '../../app/providers/SessionProvider'
import { Dialog } from '../../components/dialogs/Dialog'
import { ProfileGrid } from './ProfileGrid'

/** Menu do avatar: seletor de perfis (as Configurações têm botão próprio no menu principal). */
export function ProfileMenu({ onClose }: { onClose: () => void }) {
  const session = useReadySession()
  return (
    <Dialog title="Trocar perfil" onClose={onClose}>
      <ProfileGrid profiles={session.profiles} currentId={session.profile.id} autoFocusId={session.profile.id} onEntered={onClose} />
    </Dialog>
  )
}
