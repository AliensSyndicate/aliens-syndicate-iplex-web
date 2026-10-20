import { IplexButton } from '../ui/IplexButton'
import { IplexText } from '../ui/IplexText'

/** Estado vazio: mensagem curta e atalho para a área correspondente. Nunca cards falsos. */
export function EmptyState({ title, description, action }: { title: string; description?: string; action?: { label: string; onClick: () => void } }) {
  return (
    <div className="iplex-state iplex-state--inline iplex-state--empty">
      <IplexText variant="section-title" as="p" className="iplex-state__title">
        {title}
      </IplexText>
      {description && <IplexText variant="description" className="iplex-state__description">{description}</IplexText>}
      {action && (
        <div className="iplex-state__actions">
          <IplexButton variant="secondary" onClick={action.onClick} navId={`empty-${title}`}>
            {action.label}
          </IplexButton>
        </div>
      )}
    </div>
  )
}
