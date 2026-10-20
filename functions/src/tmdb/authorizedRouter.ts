import type { MetadataGrant } from '../tmdbAccess.ts'
import { routeTmdb, type RouteResult } from './router.ts'
import type { TmdbService } from './service.ts'

/** A caller cannot substitute an arbitrary TMDB title/id behind an allowed item. */
export async function routeAuthorizedTmdb(service: TmdbService, pathname: string, query: URLSearchParams, item: MetadataGrant): Promise<RouteResult> {
  const year = Number(item.year)
  const params = new URLSearchParams({ kind: item.kind, title: item.title })
  if (Number.isInteger(year) && year >= 1900 && year <= 2099) params.set('year', String(year))
  if (pathname.replace(/\/+$/, '') === '/api/tmdb/match') return routeTmdb(service, pathname, params)
  const matched = await service.match(item.kind, item.title, Number.isInteger(year) && year >= 1900 && year <= 2099 ? year : null)
  const prefix = item.kind === 'movie' ? '/api/tmdb/movie/' : '/api/tmdb/tv/'
  const allowed = matched.status === 'matched' && matched.summary ? `${prefix}${matched.summary.tmdbId}` : null
  if (!allowed || (pathname !== allowed && !(item.kind === 'series' && new RegExp(`^${allowed}/season/\\d{1,3}$`).test(pathname)))) {
    return { status: 403, body: { error: 'content_unavailable' }, maxAge: 0 }
  }
  return routeTmdb(service, pathname, query)
}
