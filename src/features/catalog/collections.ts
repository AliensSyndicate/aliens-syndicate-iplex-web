/**
 * Regras puras da tela Catálogo: coleções (menu lateral), ordenação e itens
 * derivados da biblioteca do perfil. Sem gêneros inventados: as categorias vêm
 * sempre da lista IPTV do fornecedor do usuário.
 */
import type { CatalogItem, ContentKind } from '../../services/api/types'
import type { IndexedItem } from '../../services/library/libraryStore'

export type CollectionId = 'continue' | 'favorites' | 'watched' | 'all' | `cat:${string}`
export type SortId = 'az' | 'za'

export const SORT_OPTIONS: Array<{ id: SortId; label: string }> = [
  { id: 'az', label: 'A–Z' },
  { id: 'za', label: 'Z–A' },
]

export interface SideEntry {
  id: CollectionId
  label: string
}

export const COLLECTION_TITLES: Record<'continue' | 'favorites' | 'watched' | 'all', string> = {
  continue: 'Continuar assistindo',
  favorites: 'Favoritos',
  watched: 'Recentemente assistidos',
  all: 'Todos',
}

const ADULT_NAME = /(^|[^a-z0-9])(adult[oa]?s?|xxx|\+\s?18|18\s?\+|er[óo]tic[oa]s?|porn[oô]?s?)([^a-z0-9]|$)/i

/** Categoria adulta do fornecedor (o backend já filtra por perfil; isto só a posiciona no fim). */
export const isAdultCategory = (name: string) => ADULT_NAME.test(name)

const collator = (() => {
  try {
    return new Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' })
  } catch {
    return null
  }
})()
const compareText = (a: string, b: string) => (collator ? collator.compare(a, b) : a.localeCompare(b))

/**
 * Menu lateral: Continuar assistindo, Favoritos, Todos, categorias do
 * fornecedor em ordem alfabética e, por último, as adultas (só se permitido).
 * Lista de desejos fica de fora até o backend ter essa coleção.
 */
export function buildSidebar(opts: { personal: boolean; allowAdult: boolean; categories: Array<{ key: string; name: string }> }): SideEntry[] {
  const out: SideEntry[] = []
  if (opts.personal) {
    out.push({ id: 'continue', label: COLLECTION_TITLES.continue }, { id: 'favorites', label: COLLECTION_TITLES.favorites })
  }
  out.push({ id: 'all', label: COLLECTION_TITLES.all })
  const sorted = [...opts.categories].sort((a, b) => compareText(a.name, b.name))
  const regular = sorted.filter((c) => !isAdultCategory(c.name))
  const adult = opts.allowAdult ? sorted.filter((c) => isAdultCategory(c.name)) : []
  for (const c of [...regular, ...adult]) out.push({ id: `cat:${c.key}`, label: c.name })
  return out
}

export function sortItems(items: CatalogItem[], sort: SortId): CatalogItem[] {
  const out = [...items]
  out.sort((a, b) => (sort === 'az' ? compareText(a.title, b.title) : compareText(b.title, a.title)))
  return out
}

export function itemFromIndexed(meta: IndexedItem): CatalogItem {
  return {
    id: meta.itemId,
    sourceId: meta.sourceId,
    kind: meta.kind,
    title: meta.title,
    category: meta.category ?? '',
    providerRef: '',
    version: '',
    ...(meta.year !== undefined ? { year: meta.year } : {}),
  }
}

export const parseKinds = (raw: string | null, fallback: ContentKind[]): ContentKind[] => {
  const kinds = (raw ?? '').split(',').filter((k): k is ContentKind => k === 'movie' || k === 'series')
  return kinds.length ? kinds : fallback
}

export function parseCollection(raw: string | null): CollectionId {
  if (raw === 'continue' || raw === 'favorites' || raw === 'watched' || raw === 'all') return raw
  if (raw && raw.startsWith('cat:')) return raw as CollectionId
  return 'all'
}
