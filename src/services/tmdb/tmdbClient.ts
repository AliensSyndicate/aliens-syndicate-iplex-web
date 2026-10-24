/** Metadados somente para itens autorizados pelo backend do Player. */
import type { TmdbDetails, TmdbMatchResult, TmdbPersonDetails, TmdbPersonResult, TmdbSeason } from '../../../functions/src/tmdb/service'
import { CATALOG } from '../../config/features'
import { createLimiter } from '../../utils/limiter'
export type { TmdbCredit, TmdbDetails, TmdbMatchResult, TmdbPerson, TmdbPersonDetails, TmdbPersonResult, TmdbRecommendation, TmdbSeason, TmdbSummary } from '../../../functions/src/tmdb/service'
export interface TmdbAuth { getIdToken(): Promise<string | null>; getAppCheckToken(): Promise<string | null> }
export interface MetadataItem { sourceId: string; id: string }
export function createTmdbClient(auth: TmdbAuth, fetchImpl: typeof fetch = (...args) => fetch(...args)) {
  const limit = createLimiter(CATALOG.tmdbConcurrency)
  async function request<T>(path: string, item: MetadataItem): Promise<T> {
    return limit(async () => {
      const idToken = await auth.getIdToken()
      const headers: Record<string, string> = { Accept: 'application/json' }
      if (idToken) headers.Authorization = `Bearer ${idToken}`
      const separator = path.includes('?') ? '&' : '?'
      const scope = new URLSearchParams({ sourceId: item.sourceId, itemId: item.id })
      const response = await fetchImpl(`${path}${separator}${scope}`, { headers, credentials: 'omit', cache: 'no-store' })
      if (!response.ok) throw new Error(`tmdb_${response.status}`)
      return await response.json() as T
    })
  }
  return {
    match(kind: 'movie' | 'series', title: string, year: number | null | undefined, item: MetadataItem): Promise<TmdbMatchResult> {
      const qs = new URLSearchParams({ kind, title })
      if (year) qs.set('year', String(year))
      return request(`/api/tmdb/match?${qs}`, item)
    },
    details(kind: 'movie' | 'series', tmdbId: number, item: MetadataItem): Promise<TmdbDetails> {
      return request(kind === 'movie' ? `/api/tmdb/movie/${tmdbId}` : `/api/tmdb/tv/${tmdbId}`, item)
    },
    season(tmdbId: number, seasonNumber: number, item: MetadataItem): Promise<TmdbSeason> {
      return request(`/api/tmdb/tv/${tmdbId}/season/${seasonNumber}`, item)
    },
    /** Pessoa creditada no título autorizado `item` (biografia e filmografia). */
    person(personId: number, item: MetadataItem, viaSearch = false): Promise<TmdbPersonDetails> {
      return request(`/api/tmdb/person/${personId}${viaSearch ? '?via=search' : ''}`, item)
    },
    /** Atores pelo nome (TMDB). `item` é qualquer título autorizado do perfil: prova o acesso do dispositivo. */
    async searchPeople(term: string, item: MetadataItem): Promise<TmdbPersonResult[]> {
      const found = await request<{ results: TmdbPersonResult[] }>(`/api/tmdb/search/person?q=${encodeURIComponent(term)}`, item)
      return found.results
    },
  }
}
export type TmdbClient = ReturnType<typeof createTmdbClient>
