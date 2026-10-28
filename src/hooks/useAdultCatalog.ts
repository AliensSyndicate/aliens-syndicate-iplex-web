import { useMemo, useSyncExternalStore } from 'react'
import { useReadySession } from '../app/providers/SessionProvider'
import type { CatalogItem } from '../services/api/types'

/** Ordem fixa das categorias do conteúdo adulto: Ao Vivo, Filmes e Séries (só as que têm itens). */
const KINDS: Array<{ kind: CatalogItem['kind']; key: string; name: string }> = [
  { kind: 'channel', key: 'adult-live', name: 'Ao Vivo' },
  { kind: 'movie', key: 'adult-movies', name: 'Filmes' },
  { kind: 'series', key: 'adult-series', name: 'Séries' },
]

/**
 * Catálogo adulto do perfil (7º e 8º conjuntos): mesma forma de `useCatalog`, para a tela Adulto reaproveitar o
 * layout de Filmes/Séries. Já vem completo (sem páginas) e só existe para perfis habilitados no iPlex Control.
 */
export function useAdultCatalog(enabled = true) {
  const { catalog, spaces, spacesError, unavailable } = useReadySession()
  const snapshot = useSyncExternalStore(catalog.subscribe, catalog.getSnapshot)
  const items = useMemo(() => (enabled ? catalog.adultItems() : []), [catalog, enabled, snapshot.revision]) // eslint-disable-line react-hooks/exhaustive-deps
  const categories = useMemo(
    () => KINDS.map((k) => ({ key: k.key, name: k.name, items: items.filter((i) => i.kind === k.kind) })).filter((c) => c.items.length > 0),
    [items],
  )
  return useMemo(
    () => ({
      catalog,
      items,
      categories,
      spaces,
      spacesError,
      noSources: !spacesError && !unavailable && spaces.length === 0,
      noKind: false,
      loading: false,
      error: null,
      hasMore: false,
      loadMore: () => undefined,
      reload: () => undefined,
    }),
    [catalog, items, categories, spaces, spacesError, unavailable],
  )
}
