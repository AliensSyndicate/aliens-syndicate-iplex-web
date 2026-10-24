import type { MetadataGrant } from '../tmdbAccess.ts'
import { routeTmdb, type RouteResult } from './router.ts'
import type { TmdbService } from './service.ts'

const PERSON = /^\/api\/tmdb\/person\/(\d{1,9})$/

/** A caller cannot substitute an arbitrary TMDB title/id behind an allowed item. */
export async function routeAuthorizedTmdb(service: TmdbService, pathname: string, query: URLSearchParams, item: MetadataGrant): Promise<RouteResult> {
  // Busca de atores da Busca da TV: vale para qualquer dispositivo/perfil com acesso a ALGUM título (a autorização
  // do dispositivo, assinatura e perfil já foi feita antes). Só atores sem conteúdo adulto; nenhum caminho livre.
  // A pessoa aberta a partir dessa busca (`via=search`) é a mesma ficha pública do TMDB (sem adultos).
  const clean = pathname.replace(/\/+$/, '')
  if (clean === '/api/tmdb/search/person') return routeTmdb(service, clean, query)
  if (query.get('via') === 'search' && PERSON.test(clean)) return routeTmdb(service, clean, query)
  const year = Number(item.year)
  const params = new URLSearchParams({ kind: item.kind, title: item.title })
  if (Number.isInteger(year) && year >= 1900 && year <= 2099) params.set('year', String(year))
  if (pathname.replace(/\/+$/, '') === '/api/tmdb/match') return routeTmdb(service, pathname, params)
  const matched = await service.match(item.kind, item.title, Number.isInteger(year) && year >= 1900 && year <= 2099 ? year : null)
  const prefix = item.kind === 'movie' ? '/api/tmdb/movie/' : '/api/tmdb/tv/'
  const allowed = matched.status === 'matched' && matched.summary ? `${prefix}${matched.summary.tmdbId}` : null
  // TV: a person (biography + filmography) only through a title the profile may watch, and only
  // someone credited in it. Open people search/discovery stays Control-only (routeDiscovery).
  const person = PERSON.exec(pathname)
  if (person && allowed) {
    const details = item.kind === 'movie' ? await service.movie(matched.summary!.tmdbId) : await service.tv(matched.summary!.tmdbId)
    const id = Number(person[1])
    if (![...details.cast, ...details.crew].some((p) => p.id === id)) return { status: 403, body: { error: 'content_unavailable' }, maxAge: 0 }
    return routeTmdb(service, pathname, query)
  }
  if (!allowed || (pathname !== allowed && !(item.kind === 'series' && new RegExp(`^${allowed}/season/\\d{1,3}$`).test(pathname)))) {
    return { status: 403, body: { error: 'content_unavailable' }, maxAge: 0 }
  }
  return routeTmdb(service, pathname, query)
}
