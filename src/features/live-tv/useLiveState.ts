/**
 * Estado do modo Ao Vivo do Catálogo: canal selecionado e painel de informações dele.
 * - 1º clique num canal: seleciona e abre o painel (acima da linha do canal).
 * - 2º clique no mesmo canal (ou "Assistir"): abre o player em tela cheia.
 * - Voltar com o painel aberto: fecha o painel (com animação) antes de sair da tela.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { contentPath } from '../../app/routes/paths'
import { useBackHandler } from '../../navigation/FocusProvider'
import type { CatalogItem } from '../../services/api/types'
import type { CatalogStore } from '../../services/catalog/catalogStore'
import { isAdultItem } from '../../services/catalog/adult'
import type { LibraryStore } from '../../services/library/libraryStore'

/** Tempo da animação de fechar (igual ao da transição do painel em CSS). */
export const PANEL_CLOSE_MS = 380

export function useLiveState({
  enabled,
  catalog,
  store,
  favoriteIds,
  personal,
}: {
  enabled: boolean
  catalog: CatalogStore
  store: LibraryStore
  favoriteIds: Set<string>
  personal: boolean
}) {
  const navigate = useNavigate()
  const [armedId, setArmedId] = useState<string | null>(null)
  /** Canal mostrado no painel: fica montado enquanto a animação de fechar acontece. */
  const [shownId, setShownId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (armedId) {
      setShownId(armedId)
      return
    }
    const timer = setTimeout(() => setShownId(null), PANEL_CLOSE_MS)
    return () => clearTimeout(timer)
  }, [armedId])

  const armed = useMemo(() => (shownId ? catalog.findLoaded(shownId) : null), [catalog, shownId])

  const activate = useCallback(
    (item: CatalogItem) => {
      if (armedId === item.id) navigate(contentPath(item))
      else setArmedId(item.id)
    },
    [armedId, navigate],
  )
  const watch = useCallback(() => {
    if (armed) navigate(contentPath(armed))
  }, [armed, navigate])
  const close = useCallback(() => setArmedId(null), [])

  const toggleFavorite = useCallback(async () => {
    if (!armed) return
    setBusy(true)
    try {
      await store.setFavorite(armed, !favoriteIds.has(armed.id))
    } catch {
      // estado revertido pelo store
    } finally {
      setBusy(false)
    }
  }, [armed, store, favoriteIds])

  useBackHandler(() => {
    if (!armedId) return false
    close()
    return true
  }, enabled)

  return {
    armed,
    armedId,
    shownId,
    open: !!armedId,
    activate,
    watch,
    close,
    toggleFavorite,
    favorite: !!armed && favoriteIds.has(armed.id),
    canFavorite: personal && !!armed && !isAdultItem(armed),
    busy,
  }
}
