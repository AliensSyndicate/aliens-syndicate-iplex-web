import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'
import { useReadySession } from '../app/providers/SessionProvider'
import type { ContentKind } from '../services/api/types'

const EMPTY_ITEMS: ReturnType<ReturnType<typeof useReadySession>['catalog']['items']> = []
const EMPTY_CATEGORIES: ReturnType<ReturnType<typeof useReadySession>['catalog']['categories']> = []

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
  const items = useMemo(() => (enabled ? catalog.items(kind) : EMPTY_ITEMS), [catalog, kind, enabled, snapshot.revision]) // eslint-disable-line react-hooks/exhaustive-deps
  const categories = useMemo(() => (enabled ? catalog.categories(kind) : EMPTY_CATEGORIES), [catalog, kind, enabled, snapshot.revision]) // eslint-disable-line react-hooks/exhaustive-deps

  // Objeto estável enquanto o store não muda: as telas derivam listas enormes dele (categorias, ordenação)
  // e não podem refazer esse trabalho a cada renderização (foco, rolagem).
  return useMemo(
    () => ({
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
    }),
    // snapshot.revision: loading/error/hasMore mudam junto com o store.
    [catalog, kind, items, categories, kindSpaces, spacesError, spaces.length, snapshot.revision, loadMore, reload], // eslint-disable-line react-hooks/exhaustive-deps
  )
}
