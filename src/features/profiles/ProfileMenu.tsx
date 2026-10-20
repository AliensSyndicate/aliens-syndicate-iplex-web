import { useNavigate } from 'react-router-dom'
import { useReadySession } from '../../app/providers/SessionProvider'
import { Dialog } from '../../components/dialogs/Dialog'
import { IplexButton } from '../../components/ui/IplexButton'
import { ProfileGrid } from './ProfileGrid'

/** Menu do avatar: seletor de perfis + acesso às Configurações (sem nova aba no menu). */
export function ProfileMenu({ onClose }: { onClose: () => void }) {
  const session = useReadySession()
  const navigate = useNavigate()
  return (
    <Dialog title="Trocar perfil" onClose={onClose}>
      <ProfileGrid profiles={session.profiles} currentId={session.profile.id} autoFocusId={session.profile.id} onEntered={onClose} />
      <div className="iplex-dialog__actions">
        <IplexButton
          variant="secondary"
          navId="menu-settings"
          onClick={() => {
            onClose()
            navigate('/configuracoes')
          }}
        >
          Configurações
        </IplexButton>
      </div>
    </Dialog>
  )
}
