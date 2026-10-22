/**
 * Cliente TMDB do lado do servidor. Recebe o token por injeção (segredo do
 * ambiente servidor) e devolve DTOs compactos e já normalizados para o Web.
 *
 * O TMDB é fonte de METADADOS. Nada aqui indica disponibilidade de reprodução:
 * isso vem exclusivamente das fontes IPTV autorizadas (backend do Gestor).
 */
import { decideMatch, parseSourceTitle, type MatchCandidate, type MatchKind } from './matching.ts'

export const TMDB_API = 'https://api.themoviedb.org/3'
/** Base pública e estável de imagens (configuration.images.secure_base_url). */
export const TMDB_IMAGES = 'https://image.tmdb.org/t/p/'
export const PRIMARY_LANGUAGE = 'pt-BR'
export const FALLBACK_LANGUAGE = 'en-US'

export interface TmdbImageSet {
  poster: string | null
  backdrop: string | null
}

export interface TmdbPerson {
  /** TMDB person id (abre a tela da pessoa no iPlex Control); null quando ausente. */
  id: number | null
  name: string
  role: string
  photo: string | null
}

export interface TmdbSummary extends TmdbImageSet {
  tmdbId: number
  kind: MatchKind
  title: string
  originalTitle: string
  overview: string
  year: number | null
  /** Data completa de lançamento/estreia (AAAA-MM-DD), quando o TMDB a fornece. */
  releaseDate: string | null
  rating: number | null
  genres: string[]
}

export interface TmdbDetails extends TmdbSummary {
  runtimeMinutes: number | null
  seasonCount: number | null
  episodeCount: number | null
  certification: string | null
  /** Motivos da classificação indicativa no Brasil (ex.: "Violência", "Drogas"), quando o TMDB os publica. */
  certificationDescriptors: string[]
  /** Pôster na resolução original (fundo da tela de detalhes do Control). */
  posterOriginal: string | null
  cast: TmdbPerson[]
  crew: TmdbPerson[]
  seasons: { seasonNumber: number; name: string; episodeCount: number; poster: string | null }[]
  /** "Você também pode gostar": TMDB recommendations (adult excluded). */
  recommendations: TmdbRecommendation[]
}

export interface TmdbRecommendation {
  tmdbId: number
  kind: MatchKind
  title: string
  year: number | null
  poster: string | null
}

/** Actor search result (Busca → Atores). */
export interface TmdbPersonResult {
  tmdbId: number
  name: string
  knownFor: string
  photo: string | null
}

export interface TmdbEpisode {
  seasonNumber: number
  episodeNumber: number
  name: string
  overview: string
  runtimeMinutes: number | null
  still: string | null
  airDate: string | null
}

export interface TmdbSeason {
  tmdbId: number
  seasonNumber: number
  name: string
  overview: string
  episodes: TmdbEpisode[]
}

/** Participação de uma pessoa (filmografia). */
export interface TmdbCredit {
  tmdbId: number
  kind: MatchKind
  title: string
  originalTitle: string
  character: string
  job: string
  date: string | null
  year: number | null
  poster: string | null
  episodeCount: number | null
}

export type SocialNetwork = 'instagram' | 'x' | 'facebook' | 'tiktok' | 'youtube' | 'imdb'

/** Só identificadores simples; nunca uma URL vinda do TMDB. */
const SOCIAL: { network: SocialNetwork; key: string; url: (id: string) => string; id: RegExp }[] = [
  { network: 'instagram', key: 'instagram_id', url: (id) => `https://www.instagram.com/${id}/`, id: /^[A-Za-z0-9._]{1,30}$/ },
  { network: 'x', key: 'twitter_id', url: (id) => `https://x.com/${id}`, id: /^[A-Za-z0-9_]{1,15}$/ },
  { network: 'facebook', key: 'facebook_id', url: (id) => `https://www.facebook.com/${id}`, id: /^[A-Za-z0-9.]{1,80}$/ },
  { network: 'tiktok', key: 'tiktok_id', url: (id) => `https://www.tiktok.com/@${id}`, id: /^[A-Za-z0-9._]{1,24}$/ },
  { network: 'youtube', key: 'youtube_id', url: (id) => `https://www.youtube.com/${id.startsWith('UC') ? `channel/${id}` : `@${id}`}`, id: /^[A-Za-z0-9_.-]{1,100}$/ },
  { network: 'imdb', key: 'imdb_id', url: (id) => `https://www.imdb.com/name/${id}/`, id: /^nm\d{1,10}$/ },
]

export function socialLinks(ids: Json): { network: SocialNetwork; url: string }[] {
  return SOCIAL.flatMap(({ network, key, url, id }) => {
    const value = str(ids?.[key]).trim().replace(/^@/, '')
    return id.test(value) ? [{ network, url: url(value) }] : []
  })
}

export interface TmdbPersonDetails {
  tmdbId: number
  name: string
  biography: string
  birthday: string | null
  deathday: string | null
  placeOfBirth: string | null
  knownFor: string
  photo: string | null
  /** Perfis oficiais (TMDB external_ids); URLs montadas aqui com hosts fixos. */
  social: { network: SocialNetwork; url: string }[]
  /** Ordem cronológica decrescente; sem data ficam no fim. Conteúdo adulto excluído. */
  credits: TmdbCredit[]
}

export interface TmdbMatchResult {
  status: 'matched' | 'ambiguous' | 'not_found'
  confidence: number
  /** Título original da fonte IPTV (auditoria). */
  sourceTitle: string
  query: string
  year: number | null
  summary: TmdbSummary | null
}

export class TmdbError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

type FetchLike = (url: string, init: { headers: Record<string, string> }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

interface CacheEntry {
  value: unknown
  expiresAt: number
}

/** Cache LRU simples em memória (por instância do servidor). */
export class TtlCache {
  private readonly entries = new Map<string, CacheEntry>()
  private readonly max: number
  private readonly now: () => number
  constructor(max = 2000, now: () => number = Date.now) {
    this.max = max
    this.now = now
  }
  get<T>(key: string): T | undefined {
    const entry = this.entries.get(key)
    if (!entry) return undefined
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key)
      return undefined
    }
    this.entries.delete(key)
    this.entries.set(key, entry)
    return entry.value as T
  }
  set(key: string, value: unknown, ttlMs: number) {
    if (this.entries.has(key)) this.entries.delete(key)
    this.entries.set(key, { value, expiresAt: this.now() + ttlMs })
    while (this.entries.size > this.max) this.entries.delete(this.entries.keys().next().value!)
  }
  get size() {
    return this.entries.size
  }
}

const HOUR = 3600_000
export const CACHE_TTL = { details: 24 * HOUR, match: 24 * HOUR, miss: 6 * HOUR }

const image = (path: unknown, size: string): string | null =>
  typeof path === 'string' && path.startsWith('/') ? `${TMDB_IMAGES}${size}${path}` : null
const yearOf = (date: unknown): number | null => {
  const y = typeof date === 'string' ? Number(date.slice(0, 4)) : NaN
  return Number.isFinite(y) && y > 1800 ? y : null
}
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any

export interface TmdbServiceOptions {
  readAccessToken: string
  fetchImpl?: FetchLike
  cache?: TtlCache
}

export function createTmdbService({ readAccessToken, fetchImpl, cache = new TtlCache() }: TmdbServiceOptions) {
  if (!readAccessToken) throw new Error('TMDB_READ_ACCESS_TOKEN ausente')
  const doFetch: FetchLike = fetchImpl ?? ((url, init) => fetch(url, init))

  async function get(path: string, params: Record<string, string | number | undefined>, ttl = CACHE_TTL.details): Promise<Json> {
    const query = Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== '')
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&')
    const url = `${TMDB_API}${path}${query ? `?${query}` : ''}`
    const cached = cache.get<Json>(url)
    if (cached !== undefined) return cached
    const response = await doFetch(url, {
      headers: { Authorization: `Bearer ${readAccessToken}`, Accept: 'application/json' },
    })
    if (response.status === 404) throw new TmdbError(404, 'not_found')
    if (response.status === 429) throw new TmdbError(429, 'rate_limited')
    if (!response.ok) throw new TmdbError(502, `tmdb_${response.status}`)
    const body = await response.json()
    cache.set(url, body, ttl)
    return body
  }

  function summaryFrom(kind: MatchKind, row: Json, genreNames: string[] = []): TmdbSummary {
    return {
      tmdbId: row.id,
      kind,
      title: str(kind === 'movie' ? row.title : row.name),
      originalTitle: str(kind === 'movie' ? row.original_title : row.original_name),
      overview: str(row.overview),
      year: yearOf(kind === 'movie' ? row.release_date : row.first_air_date),
      releaseDate: str(kind === 'movie' ? row.release_date : row.first_air_date) || null,
      rating: num(row.vote_average) && row.vote_count > 0 ? Math.round(row.vote_average * 10) / 10 : null,
      genres: genreNames.length ? genreNames : Array.isArray(row.genres) ? row.genres.map((g: Json) => str(g.name)).filter(Boolean) : [],
      poster: image(row.poster_path, 'w342'),
      backdrop: image(row.backdrop_path, 'w1280'),
    }
  }

  /** Sinopse em pt-BR; se vazia, usa en-US (fallback de idioma). */
  async function withFallback(path: string, params: Record<string, string | number | undefined>): Promise<Json> {
    const primary = await get(path, { ...params, language: PRIMARY_LANGUAGE })
    if (str(primary.overview)) return primary
    try {
      const fallback = await get(path, { language: FALLBACK_LANGUAGE })
      return { ...primary, overview: str(fallback.overview) }
    } catch {
      return primary
    }
  }

  async function match(kind: MatchKind, sourceTitle: string, hintYear?: number | null): Promise<TmdbMatchResult> {
    const parsed = parseSourceTitle(sourceTitle)
    const year = hintYear ?? parsed.year
    const base = { sourceTitle, query: parsed.query, year }
    if (!parsed.key) return { ...base, status: 'not_found', confidence: 0, summary: null }
    const cacheKey = `match:${kind}:${parsed.key}:${year ?? ''}`
    const cached = cache.get<TmdbMatchResult>(cacheKey)
    if (cached) return { ...cached, sourceTitle }

    const path = kind === 'movie' ? '/search/movie' : '/search/tv'
    const yearParam = kind === 'movie' ? 'primary_release_year' : 'first_air_date_year'
    const search = async (withYear: boolean) =>
      ((await get(path, { query: parsed.query, language: PRIMARY_LANGUAGE, include_adult: 'false', [yearParam]: withYear && year ? year : undefined }, CACHE_TTL.match))
        .results ?? []) as Json[]
    let rows = await search(true)
    if (!rows.length && year) rows = await search(false)
    const candidates: MatchCandidate[] = rows.slice(0, 10).map((row) => ({
      id: row.id,
      title: str(kind === 'movie' ? row.title : row.name),
      originalTitle: str(kind === 'movie' ? row.original_title : row.original_name),
      year: yearOf(kind === 'movie' ? row.release_date : row.first_air_date),
      popularity: num(row.popularity) ?? 0,
    }))
    const decision = decideMatch({ ...parsed, year }, candidates)
    const row = decision.candidate ? rows.find((r) => r.id === decision.candidate!.id) : null
    const result: TmdbMatchResult = {
      ...base,
      status: decision.status,
      confidence: decision.confidence,
      summary: row ? summaryFrom(kind, row) : null,
    }
    cache.set(cacheKey, result, result.summary ? CACHE_TTL.match : CACHE_TTL.miss)
    return result
  }

  async function movie(id: number, editorial = false): Promise<TmdbDetails> {
    const row = await withFallback(`/movie/${id}`, { append_to_response: 'credits,release_dates,recommendations' })
    // Descoberta editorial nunca devolve conteúdo adulto.
    if (editorial && row.adult === true) throw new TmdbError(404, 'not_found')
    const br = (row.release_dates?.results ?? []).find((r: Json) => r.iso_3166_1 === 'BR')
    // Certificação e motivos vêm do mesmo lançamento brasileiro.
    const rated = (br?.release_dates ?? []).find((d: Json) => str(d.certification))
    const certification = str(rated?.certification) || null
    return {
      ...summaryFrom('movie', row),
      runtimeMinutes: num(row.runtime) || null,
      seasonCount: null,
      episodeCount: null,
      certification,
      certificationDescriptors: descriptors(rated?.descriptors),
      posterOriginal: image(row.poster_path, 'original'),
      cast: people(row.credits?.cast, 'character'),
      crew: (row.credits?.crew ?? [])
        .filter((p: Json) => p.job === 'Director')
        .slice(0, 3)
        .map((p: Json) => ({ id: num(p.id), name: str(p.name), role: 'Direção', photo: image(p.profile_path, 'w185') })),
      seasons: [],
      recommendations: recommendations(row.recommendations, 'movie'),
    }
  }

  async function tv(id: number, editorial = false): Promise<TmdbDetails> {
    const row = await withFallback(`/tv/${id}`, { append_to_response: 'credits,content_ratings,recommendations' })
    if (editorial && row.adult === true) throw new TmdbError(404, 'not_found')
    const br = (row.content_ratings?.results ?? []).find((r: Json) => r.iso_3166_1 === 'BR')
    return {
      ...summaryFrom('series', row),
      runtimeMinutes: num(row.episode_run_time?.[0]),
      seasonCount: num(row.number_of_seasons),
      episodeCount: num(row.number_of_episodes),
      certification: str(br?.rating) || null,
      certificationDescriptors: descriptors(br?.descriptors),
      posterOriginal: image(row.poster_path, 'original'),
      cast: people(row.credits?.cast, 'character'),
      crew: (row.created_by ?? []).slice(0, 3).map((p: Json) => ({ id: num(p.id), name: str(p.name), role: 'Criação', photo: image(p.profile_path, 'w185') })),
      seasons: (row.seasons ?? [])
        .filter((s: Json) => typeof s.season_number === 'number')
        .map((s: Json) => ({ seasonNumber: s.season_number, name: str(s.name), episodeCount: num(s.episode_count) ?? 0, poster: image(s.poster_path, 'w342') })),
      recommendations: recommendations(row.recommendations, 'series'),
    }
  }

  async function season(id: number, seasonNumber: number): Promise<TmdbSeason> {
    const row = await get(`/tv/${id}/season/${seasonNumber}`, { language: PRIMARY_LANGUAGE })
    return {
      tmdbId: id,
      seasonNumber,
      name: str(row.name),
      overview: str(row.overview),
      episodes: (row.episodes ?? []).map((e: Json) => ({
        seasonNumber: e.season_number,
        episodeNumber: e.episode_number,
        name: str(e.name),
        overview: str(e.overview),
        runtimeMinutes: num(e.runtime),
        still: image(e.still_path, 'w300'),
        airDate: str(e.air_date) || null,
      })),
    }
  }

  async function person(id: number): Promise<TmdbPersonDetails> {
    const row = await get(`/person/${id}`, { language: PRIMARY_LANGUAGE, append_to_response: 'combined_credits,external_ids' })
    if (row.adult === true) throw new TmdbError(404, 'not_found')
    let biography = str(row.biography)
    if (!biography) {
      try { biography = str((await get(`/person/${id}`, { language: FALLBACK_LANGUAGE })).biography) } catch { /* sem biografia */ }
    }
    const credits = new Map<string, TmdbCredit>()
    for (const [group, role] of [['cast', 'character'], ['crew', 'job']] as const) {
      for (const c of (row.combined_credits?.[group] ?? []) as Json[]) {
        if (c.adult === true || typeof c.id !== 'number' || (c.media_type !== 'movie' && c.media_type !== 'tv')) continue
        const kind: MatchKind = c.media_type === 'movie' ? 'movie' : 'series'
        const key = `${kind}:${c.id}`
        const date = str(kind === 'movie' ? c.release_date : c.first_air_date) || null
        const previous = credits.get(key)
        const value = str(c[role])
        if (previous) {
          // Mesma obra com vários papéis: um item só.
          if (value && group === 'cast' && !previous.character) previous.character = value
          if (value && group === 'crew' && !previous.job) previous.job = value
          continue
        }
        credits.set(key, {
          tmdbId: c.id, kind,
          title: str(kind === 'movie' ? c.title : c.name),
          originalTitle: str(kind === 'movie' ? c.original_title : c.original_name),
          character: group === 'cast' ? value : '',
          job: group === 'crew' ? value : '',
          date, year: yearOf(date),
          poster: image(c.poster_path, 'w342'),
          episodeCount: num(c.episode_count),
        })
      }
    }
    return {
      tmdbId: row.id,
      name: str(row.name),
      biography,
      birthday: str(row.birthday) || null,
      deathday: str(row.deathday) || null,
      placeOfBirth: str(row.place_of_birth) || null,
      knownFor: str(row.known_for_department),
      photo: image(row.profile_path, 'h632'),
      social: socialLinks(row.external_ids),
      credits: [...credits.values()]
        .filter((c) => c.title)
        .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || a.title.localeCompare(b.title))
        .slice(0, 300),
    }
  }

  async function searchPeople(query: string): Promise<TmdbPersonResult[]> {
    const rows = ((await get('/search/person', { query, language: PRIMARY_LANGUAGE, include_adult: 'false' }, CACHE_TTL.match)).results ?? []) as Json[]
    return rows
      .filter((p) => p.adult !== true && typeof p.id === 'number' && str(p.name))
      .slice(0, 20)
      .map((p) => ({ tmdbId: p.id, name: str(p.name), knownFor: str(p.known_for_department), photo: image(p.profile_path, 'w185') }))
  }

  return { match, movie, tv, season, person, searchPeople }
}

function recommendations(block: Json, kind: MatchKind): TmdbRecommendation[] {
  return ((block?.results ?? []) as Json[])
    .filter((r) => r.adult !== true && typeof r.id === 'number')
    .slice(0, 12)
    .map((r) => ({
      tmdbId: r.id,
      kind,
      title: str(kind === 'movie' ? r.title : r.name),
      year: yearOf(kind === 'movie' ? r.release_date : r.first_air_date),
      poster: image(r.poster_path, 'w342'),
    }))
    .filter((r) => r.title)
}

function descriptors(rows: Json): string[] {
  return (Array.isArray(rows) ? rows : []).map(str).map((d: string) => d.trim()).filter(Boolean).slice(0, 8)
}

function people(rows: Json, roleKey: string): TmdbPerson[] {
  return (Array.isArray(rows) ? rows : []).slice(0, 20).map((p: Json) => ({
    id: num(p.id),
    name: str(p.name),
    role: str(p[roleKey]),
    photo: image(p.profile_path, 'w185'),
  }))
}

export type TmdbService = ReturnType<typeof createTmdbService>
