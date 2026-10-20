import { IplexButton } from '../ui/IplexButton'
import { Dialog } from './Dialog'

export function ConfirmDialog({ title, description, confirmLabel, cancelLabel = 'Cancelar', onConfirm, onCancel }: { title: string; description?: string; confirmLabel: string; cancelLabel?: string; onConfirm: () => void; onCancel: () => void }) {
  return (
    <Dialog title={title} description={description} onClose={onCancel}>
      <div className="iplex-dialog__actions">
        <IplexButton variant="secondary" onClick={onCancel} navId="confirm-cancel" autoFocus>
          {cancelLabel}
        </IplexButton>
        <IplexButton onClick={onConfirm} navId="confirm-ok">
          {confirmLabel}
        </IplexButton>
      </div>
    </Dialog>
  )
}
