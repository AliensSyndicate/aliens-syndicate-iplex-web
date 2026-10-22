import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'
import { useReadySession } from '../app/providers/SessionProvider'
import type { ContentKind } from '../services/api/types'

/** Catálogo do perfil atual para um tipo de conteúdo (carregamento progressivo). */
export function useCatalog(kind: ContentKind, enabled = true) {
  const { catalog, spaces, spacesError } = useReadySession()
  const snapshot = useSyncExternalStore(catalog.subscribe, catalog.getSnapshot)
  const kindSpaces = useMemo(() => spaces.filter((s) => s.kinds.includes(kind)), [spaces, kind])

  useEffect(() => {
    if (enabled) void catalog.ensure(kind)
  }, [catalog, kind, enabled])

  const loadMore = useCallback(() => {
    if (catalog.hasMore(kind) && !catalog.isLoading(kind)) void catalog.loadMore(kind)
  }, [catalog, kind])
  const reload = useCallback(() => void catalog.reload(kind), [catalog, kind])

  // revision força recomputar quando o store muda.
  const items = useMemo(() => catalog.items(kind), [catalog, kind, snapshot.revision]) // eslint-disable-line react-hooks/exhaustive-deps
  const categories = useMemo(() => catalog.categories(kind), [catalog, kind, snapshot.revision]) // eslint-disable-line react-hooks/exhaustive-deps

  return {
    catalog,
    items,
    categories,
    spaces: kindSpaces,
    spacesError,
    noSources: !spacesError && spaces.length === 0,
    noKind: !spacesError && spaces.length > 0 && kindSpaces.length === 0,
    loading: catalog.isLoading(kind),
    error: catalog.errorFor(kind),
    hasMore: catalog.hasMore(kind),
    loadMore,
    reload,
  }
}
