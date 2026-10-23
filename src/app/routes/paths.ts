import type { CatalogItem, ContentRef } from '../../services/api/types'
import { isAdultItem } from '../../services/catalog/adult'

export const PATHS = {
  details: (sourceId: string, itemId: string, title: string) => `/titulo/${encodeURIComponent(sourceId)}/${encodeURIComponent(itemId)}?t=${encodeURIComponent(title)}`,
  seasons: (sourceId: string, itemId: string, title: string) => `/titulo/${encodeURIComponent(sourceId)}/${encodeURIComponent(itemId)}/temporadas?t=${encodeURIComponent(title)}`,
  watch: (ref: ContentRef & { resume?: boolean; resumeAtSec?: number }) => {
    const qs = new URLSearchParams({ s: ref.sourceId, i: ref.itemId, k: ref.kind, t: ref.title })
    if (ref.episodeId) qs.set('e', ref.episodeId)
    if (ref.resume) qs.set('r', '1')
    if (ref.resume && ref.resumeAtSec && ref.resumeAtSec > 0) qs.set('ra', String(Math.floor(ref.resumeAtSec)))
    return `/assistir?${qs.toString()}`
  },
  /** Pessoa do elenco/equipe, sempre no escopo de um título autorizado (s, i). */
  person: (personId: number, scope: { sourceId: string; itemId: string; title: string }) =>
    `/pessoa/${personId}?${new URLSearchParams({ s: scope.sourceId, i: scope.itemId, t: scope.title }).toString()}`,
  settings: '/configuracoes',
  /** Tela Catálogo reutilizável: coleção (c) e tipos (k) de entrada. */
  catalog: (collection: string, kinds: string[] = ['movie', 'series']) => `/catalogo?c=${encodeURIComponent(collection)}&k=${kinds.join(',')}`,
} as const

/** Para onde um item abre. Conteúdo adulto nunca abre a tela de detalhes: filme e canal tocam direto; série vai aos episódios. */
export function contentPath(item: CatalogItem): string {
  if (item.kind === 'channel') return PATHS.watch({ sourceId: item.sourceId, itemId: item.id, kind: 'channel', title: item.title })
  if (isAdultItem(item)) {
    return item.kind === 'series'
      ? PATHS.seasons(item.sourceId, item.id, item.title)
      : PATHS.watch({ sourceId: item.sourceId, itemId: item.id, kind: 'movie', title: item.title })
  }
  return PATHS.details(item.sourceId, item.id, item.title)
}
