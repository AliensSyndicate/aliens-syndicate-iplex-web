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
