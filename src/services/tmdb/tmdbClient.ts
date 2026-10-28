/** Metadados somente para itens autorizados pelo backend do Player. */
import type { TmdbDetails, TmdbMatchResult, TmdbPersonDetails, TmdbPersonResult, TmdbSeason } from '../../../functions/src/tmdb/service'
import { CATALOG } from '../../config/features'
import { createLimiter } from '../../utils/limiter'
import { readJson, writeJson } from '../../utils/storage'
export type { TmdbCredit, TmdbDetails, TmdbMatchResult, TmdbPerson, TmdbPersonDetails, TmdbPersonResult, TmdbRecommendation, TmdbSeason, TmdbSummary } from '../../../functions/src/tmdb/service'
export interface TmdbAuth { getIdToken(): Promise<string | null>; getAppCheckToken(): Promise<string | null> }
export interface MetadataItem { sourceId: string; id: string }
const MATCH_CACHE_KEY = 'iplex.tmdb.match.v1'
const MATCH_CACHE_MAX = 400
const MATCHED_TTL_MS = 7 * 24 * 3600_000
const MISSING_TTL_MS = 24 * 3600_000
interface MatchCacheEntry { at: number; result: TmdbMatchResult }

/**
 * Correspondências já resolvidas (capas, pôsteres, títulos) ficam no aparelho: o Meu iPlex e as demais telas
 * abrem sem refazer as consultas. Limitado (400 itens, os mais recentes) para não pesar na memória da TV.
 */
function createMatchCache() {
  let entries: Record<string, MatchCacheEntry> | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  const load = () => (entries ??= readJson<Record<string, MatchCacheEntry>>(MATCH_CACHE_KEY) ?? {})
  return {
    get(key: string): TmdbMatchResult | null {
      const hit = load()[key]
      if (!hit) return null
      const ttl = hit.result.status === 'matched' ? MATCHED_TTL_MS : MISSING_TTL_MS
      return Date.now() - hit.at < ttl ? hit.result : null
    },
    set(key: string, result: TmdbMatchResult) {
      const all = load()
      all[key] = { at: Date.now(), result }
      const keys = Object.keys(all)
      if (keys.length > MATCH_CACHE_MAX) {
        keys.sort((a, b) => all[a]!.at - all[b]!.at).slice(0, keys.length - MATCH_CACHE_MAX).forEach((k) => delete all[k])
      }
      if (timer) return
      timer = setTimeout(() => {
        timer = null
        writeJson(MATCH_CACHE_KEY, entries)
      }, 1500)
    },
  }
}

export function createTmdbClient(auth: TmdbAuth, fetchImpl: typeof fetch = (...args) => fetch(...args)) {
  const limit = createLimiter(CATALOG.tmdbConcurrency)
  const matches = createMatchCache()
  const inflight = new Map<string, Promise<TmdbMatchResult>>()
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
      const key = `${item.sourceId}:${item.id}`
      const cached = matches.get(key)
      if (cached) return Promise.resolve(cached)
      const pending = inflight.get(key)
      if (pending) return pending
      const fresh = request<TmdbMatchResult>(`/api/tmdb/match?${qs}`, item)
        .then((result) => {
          matches.set(key, result)
          return result
        })
        .finally(() => inflight.delete(key))
      inflight.set(key, fresh)
      return fresh
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
