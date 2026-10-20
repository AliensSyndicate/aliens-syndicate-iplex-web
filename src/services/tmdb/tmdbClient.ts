/**
 * Metadados TMDB via endpoints internos /api/tmdb (nunca direto ao TMDB:
 * o token é exclusivo do servidor). Os resultados enriquecem itens que JÁ
 * existem no catálogo IPTV autorizado; um título do TMDB nunca vira
 * reproduzível por si só.
 */
import type { TmdbDetails, TmdbMatchResult, TmdbSeason } from '../../../functions/src/tmdb/service'
import { CATALOG } from '../../config/features'
import { createLimiter } from '../../utils/limiter'
import { readJson, writeJson } from '../../utils/storage'

export type { TmdbDetails, TmdbMatchResult, TmdbSeason, TmdbSummary } from '../../../functions/src/tmdb/service'

export interface TmdbAuth {
  getIdToken(): Promise<string | null>
  getAppCheckToken(): Promise<string | null>
}

const MATCH_STORE = 'iplex.tmdb.matches.v1'
const MATCH_TTL_MS = 7 * 86400_000
const MAX_STORED = 600

interface StoredMatch {
  at: number
  value: TmdbMatchResult
}

export function createTmdbClient(auth: TmdbAuth, fetchImpl: typeof fetch = (...args) => fetch(...args)) {
  const limit = createLimiter(CATALOG.tmdbConcurrency)
  const memory = new Map<string, Promise<unknown>>()
  let stored = readJson<Record<string, StoredMatch>>(MATCH_STORE) ?? {}
  let persistTimer: ReturnType<typeof setTimeout> | null = null

  const persist = () => {
    if (persistTimer) return
    persistTimer = setTimeout(() => {
      persistTimer = null
      const entries = Object.entries(stored).sort((a, b) => b[1].at - a[1].at).slice(0, MAX_STORED)
      stored = Object.fromEntries(entries)
      writeJson(MATCH_STORE, stored)
    }, 1500)
  }

  async function request<T>(path: string): Promise<T> {
    const [idToken, appCheck] = await Promise.all([auth.getIdToken(), auth.getAppCheckToken()])
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (idToken) headers.Authorization = `Bearer ${idToken}`
    if (appCheck) headers['X-Firebase-AppCheck'] = appCheck
    const response = await fetchImpl(path, { headers, credentials: 'omit' })
    if (!response.ok) throw new Error(`tmdb_${response.status}`)
    return (await response.json()) as T
  }

  function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    const hit = memory.get(key)
    if (hit) return hit as Promise<T>
    const promise = limit(load).catch((error) => {
      memory.delete(key)
      throw error
    })
    memory.set(key, promise)
    return promise
  }

  return {
    match(kind: 'movie' | 'series', title: string, year?: number | null): Promise<TmdbMatchResult> {
      const key = `match:${kind}:${title}:${year ?? ''}`
      const saved = stored[key]
      if (saved && Date.now() - saved.at < MATCH_TTL_MS) return Promise.resolve(saved.value)
      return cached(key, async () => {
        const qs = new URLSearchParams({ kind, title })
        if (year) qs.set('year', String(year))
        const value = await request<TmdbMatchResult>(`/api/tmdb/match?${qs.toString()}`)
        stored[key] = { at: Date.now(), value }
        persist()
        return value
      })
    },
    details(kind: 'movie' | 'series', tmdbId: number): Promise<TmdbDetails> {
      const path = kind === 'movie' ? `/api/tmdb/movie/${tmdbId}` : `/api/tmdb/tv/${tmdbId}`
      return cached(path, () => request<TmdbDetails>(path))
    },
    season(tmdbId: number, seasonNumber: number): Promise<TmdbSeason> {
      const path = `/api/tmdb/tv/${tmdbId}/season/${seasonNumber}`
      return cached(path, () => request<TmdbSeason>(path))
    },
  }
}

export type TmdbClient = ReturnType<typeof createTmdbClient>
