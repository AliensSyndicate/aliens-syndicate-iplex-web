import type { CatalogItem, ContentRef } from '../../services/api/types'

export const PATHS = {
  details: (sourceId: string, itemId: string, title: string) => `/titulo/${encodeURIComponent(sourceId)}/${encodeURIComponent(itemId)}?t=${encodeURIComponent(title)}`,
  watch: (ref: ContentRef & { resume?: boolean; resumeAtSec?: number }) => {
    const qs = new URLSearchParams({ s: ref.sourceId, i: ref.itemId, k: ref.kind, t: ref.title })
    if (ref.episodeId) qs.set('e', ref.episodeId)
    if (ref.resume) qs.set('r', '1')
    if (ref.resume && ref.resumeAtSec && ref.resumeAtSec > 0) qs.set('ra', String(Math.floor(ref.resumeAtSec)))
    return `/assistir?${qs.toString()}`
  },
  settings: '/configuracoes',
} as const

export function contentPath(item: CatalogItem): string {
  return item.kind === 'channel'
    ? PATHS.watch({ sourceId: item.sourceId, itemId: item.id, kind: 'channel', title: item.title })
    : PATHS.details(item.sourceId, item.id, item.title)
}
