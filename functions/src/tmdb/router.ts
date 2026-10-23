/**
 * Endpoints internos /api/tmdb/* (lista fechada). Usado pela Cloud Function
 * (produção) e pelo middleware do Vite (desenvolvimento). Nunca repassa
 * caminhos arbitrários ao TMDB: não é um proxy aberto.
 */
import { TmdbError, type TmdbService } from './service.ts'

export interface RouteResult {
  status: number
  body: unknown
  /** Segundos de cache no cliente (Cache-Control: private). */
  maxAge: number
}

const ID = /^\d{1,9}$/

export async function routeTmdb(service: TmdbService, pathname: string, query: URLSearchParams): Promise<RouteResult> {
  const path = pathname.replace(/^\/api\/tmdb/, '').replace(/\/+$/, '')
  try {
    if (path === '/match') {
      const kind = query.get('kind')
      const title = (query.get('title') ?? '').trim()
      const yearRaw = query.get('year')
      const year = yearRaw && /^(19|20)\d{2}$/.test(yearRaw) ? Number(yearRaw) : null
      if ((kind !== 'movie' && kind !== 'series') || !title || title.length > 300) return bad()
      return ok(await service.match(kind, title, year), 3600)
    }
    let m = /^\/movie\/(\d+)$/.exec(path)
    if (m && ID.test(m[1]!)) return ok(await service.movie(Number(m[1])), 86400)
    m = /^\/tv\/(\d+)$/.exec(path)
    if (m && ID.test(m[1]!)) return ok(await service.tv(Number(m[1])), 86400)
    m = /^\/tv\/(\d+)\/season\/(\d{1,3})$/.exec(path)
    if (m && ID.test(m[1]!)) return ok(await service.season(Number(m[1]), Number(m[2])), 86400)
    // Pessoa creditada num título autorizado (o escopo é verificado em routeAuthorizedTmdb).
    m = /^\/person\/(\d+)$/.exec(path)
    if (m && ID.test(m[1]!)) return ok(await service.person(Number(m[1])), 86400)
    return { status: 404, body: { error: 'unknown_endpoint' }, maxAge: 0 }
  } catch (error) {
    if (error instanceof TmdbError) {
      return { status: error.status === 404 ? 404 : error.status === 429 ? 503 : 502, body: { error: error.message }, maxAge: 0 }
    }
    return { status: 502, body: { error: 'metadata_unavailable' }, maxAge: 0 }
  }
}

/**
 * Descoberta editorial do iPlex Control (/api/tmdb/discover/*): títulos, pessoas e
 * filmografias inclusive fora do catálogo IPTV. Lista fechada, sem conteúdo adulto.
 * A autorização (conta + App Check, nunca TV, nunca perfil infantil) é feita antes.
 */
export async function routeDiscovery(service: TmdbService, pathname: string, query?: URLSearchParams): Promise<RouteResult> {
  const path = pathname.replace(/^\/api\/tmdb\/discover/, '').replace(/\/+$/, '')
  try {
    let m = /^\/movie\/(\d{1,9})$/.exec(path)
    if (m) return ok(await service.movie(Number(m[1]), true), 86400)
    m = /^\/tv\/(\d{1,9})$/.exec(path)
    if (m) return ok(await service.tv(Number(m[1]), true), 86400)
    m = /^\/tv\/(\d{1,9})\/season\/(\d{1,3})$/.exec(path)
    if (m) return ok(await service.season(Number(m[1]), Number(m[2])), 86400)
    m = /^\/person\/(\d{1,9})$/.exec(path)
    if (m) return ok(await service.person(Number(m[1])), 86400)
    if (path === '/search/person') {
      const q = (query?.get('q') ?? '').trim()
      if (q.length < 2 || q.length > 100) return { status: 400, body: { error: 'invalid_request' }, maxAge: 0 }
      return ok({ results: await service.searchPeople(q) }, 3600)
    }
    return { status: 404, body: { error: 'unknown_endpoint' }, maxAge: 0 }
  } catch (error) {
    if (error instanceof TmdbError) {
      return { status: error.status === 404 ? 404 : error.status === 429 ? 503 : 502, body: { error: error.message }, maxAge: 0 }
    }
    return { status: 502, body: { error: 'metadata_unavailable' }, maxAge: 0 }
  }
}

const ok = (body: unknown, maxAge: number): RouteResult => ({ status: 200, body, maxAge })
const bad = (): RouteResult => ({ status: 400, body: { error: 'invalid_request' }, maxAge: 0 })
