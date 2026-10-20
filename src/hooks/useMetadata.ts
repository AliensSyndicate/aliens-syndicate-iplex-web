import { useEffect, useState } from 'react'
import { useBackend } from '../app/providers/BackendProvider'
import type { CatalogItem } from '../services/api/types'
import { itemYear } from '../services/catalog/normalize'
import type { TmdbDetails, TmdbMatchResult, TmdbSummary } from '../services/tmdb/tmdbClient'

export type MetadataState = { status: 'idle' | 'loading' | 'missing' | 'error' } | { status: 'ready'; summary: TmdbSummary }

/**
 * Correspondência TMDB de um item IPTV (filme/série). `enabled` permite
 * adiar até o card ficar visível. Resultados ambíguos ou de baixa confiança
 * ficam sem metadados (o card mostra o nome da fonte).
 */
export function useMatch(item: Pick<CatalogItem, 'kind' | 'title' | 'year'> | null, enabled = true): MetadataState {
  const { tmdb } = useBackend()
  const [state, setState] = useState<MetadataState>({ status: 'idle' })
  const kind = item?.kind
  const title = item?.title
  const year = item ? itemYear(item.year) : null
  useEffect(() => {
    if (!enabled || !title || (kind !== 'movie' && kind !== 'series')) return
    let alive = true
    setState({ status: 'loading' })
    tmdb.match(kind, title, year).then(
      (result: TmdbMatchResult) => {
        if (!alive) return
        setState(result.status === 'matched' && result.summary ? { status: 'ready', summary: result.summary } : { status: 'missing' })
      },
      () => alive && setState({ status: 'error' }),
    )
    return () => {
      alive = false
    }
  }, [tmdb, kind, title, year, enabled])
  return state
}

export function useDetails(kind: 'movie' | 'series' | null, tmdbId: number | null): { details: TmdbDetails | null; loading: boolean } {
  const { tmdb } = useBackend()
  const [details, setDetails] = useState<TmdbDetails | null>(null)
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    if (!kind || !tmdbId) return
    let alive = true
    setLoading(true)
    tmdb.details(kind, tmdbId).then(
      (value) => alive && (setDetails(value), setLoading(false)),
      () => alive && setLoading(false),
    )
    return () => {
      alive = false
    }
  }, [tmdb, kind, tmdbId])
  return { details, loading }
}
