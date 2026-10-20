import type { AppError } from '../../services/api/errors'
import { useSession } from '../../app/providers/SessionProvider'
import { ErrorState } from './ErrorState'
import { EmptyState } from './EmptyState'

/** Estados das fontes IPTV numa seção (sem fonte, fonte fora do ar, tipo ausente). */
export function SourceStates({ spacesError, noSources, noKind, error, kindLabel, onRetry }: { spacesError: AppError | null; noSources: boolean; noKind: boolean; error: AppError | null; kindLabel: string; onRetry: () => void }) {
  const session = useSession()
  if (spacesError) return <ErrorState inline error={spacesError} onRetry={() => void session.reloadSpaces()} />
  if (noSources) return <ErrorState inline kind="iptv-not-configured" onRetry={() => void session.reloadSpaces()} />
  if (noKind) return <EmptyState title={`Nenhum conteúdo de ${kindLabel} disponível`} description="As fontes deste perfil não têm esse tipo de conteúdo, ou ele não é permitido para o perfil." />
  if (error) return <ErrorState inline error={error} onRetry={onRetry} />
  return null
}
