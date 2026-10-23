import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useBackend } from '../app/providers/BackendProvider'
import { useReadySession } from '../app/providers/SessionProvider'
import { PATHS } from '../app/routes/paths'
import { itemYear } from '../services/catalog/normalize'
import { findCatalogTitle, type TmdbTitleRef } from '../services/catalog/tmdbAvailability'

/**
 * Abre um título citado pelo TMDB (filmografia de uma pessoa, recomendações)
 * somente se estiver no catálogo IPTV do perfil; senão, avisa.
 */
export function useOpenTmdbTitle() {
  const { tmdb } = useBackend()
  const session = useReadySession()
  const navigate = useNavigate()
  const [busy, setBusy] = useState<number | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const open = useCallback(
    async (target: TmdbTitleRef) => {
      if (busy !== null) return
      setBusy(target.tmdbId)
      setNotice(null)
      try {
        const item = await findCatalogTitle(
          (term) => session.catalog.search(term),
          (candidate) => tmdb.match(candidate.kind === 'series' ? 'series' : 'movie', candidate.title, itemYear(candidate.year), candidate),
          target,
        )
        if (item) navigate(PATHS.details(item.sourceId, item.id, item.title))
        else setNotice(`“${target.title}” não está disponível no seu catálogo.`)
      } catch {
        setNotice('Não foi possível consultar o catálogo agora. Tente novamente.')
      } finally {
        setBusy(null)
      }
    },
    [busy, session.catalog, tmdb, navigate],
  )
  return { open, busy, notice }
}
