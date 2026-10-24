/**
 * Regras puras da tela Catálogo: coleções (menu lateral), ordenação e itens
 * derivados da biblioteca do perfil. Sem gêneros inventados: as categorias vêm
 * sempre da lista IPTV do fornecedor do usuário.
 */
import type { CatalogItem, ContentKind } from '../../services/api/types'
import { isAdultItem } from '../../services/catalog/adult'
import { isAdultName } from '../../services/catalog/categoryLabels'
import type { IndexedItem } from '../../services/library/libraryStore'

export type PersonalCollection = 'continue' | 'favorites' | 'wishlist' | 'watched' | 'releases'
export type CollectionId = PersonalCollection | 'all' | `cat:${string}`
export type SortId = 'az' | 'za' | 'added'

export const SORT_OPTIONS: Array<{ id: SortId; label: string }> = [
  { id: 'az', label: 'A–Z' },
  { id: 'za', label: 'Z–A' },
  { id: 'added', label: 'Mais recentes' },
]

/** "Mais recentes" só existe com datas reais de inclusão vindas do catálogo. */
export const sortOptionsFor = (items: CatalogItem[]) => (items.some((i) => typeof i.addedAt === 'number') ? SORT_OPTIONS : SORT_OPTIONS.filter((o) => o.id !== 'added'))

export interface SideEntry {
  id: CollectionId
  label: string
}

export const COLLECTION_TITLES: Record<PersonalCollection | 'all', string> = {
  continue: 'Continuar assistindo',
  favorites: 'Favoritos',
  wishlist: 'Lista de desejos',
  releases: 'Lançamentos',
  watched: 'Assistidos',
  all: 'Todos',
}

/** Categoria adulta do fornecedor (o backend já filtra por perfil; isto só a posiciona no fim). */
export const isAdultCategory = isAdultName

const collator = (() => {
  try {
    return new Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' })
  } catch {
    return null
  }
})()
const compareText = (a: string, b: string) => (collator ? collator.compare(a, b) : a.localeCompare(b))

/**
 * Menu lateral, só com coleções que têm conteúdo: Continuar assistindo,
 * Favoritos, Todos, categorias do fornecedor em ordem alfabética e, por último,
 * as adultas (só se permitido). Lista de desejos fica de fora até o backend ter
 * essa coleção (hoje "Adicionar à lista" grava em Favoritos). Sem nenhum
 * conteúdo (ou ainda carregando), "Todos" permanece para sempre haver um item
 * selecionado e para hospedar o estado vazio/carregando.
 */
export function buildSidebar(opts: {
  personal: boolean
  allowAdult: boolean
  categories: Array<{ key: string; name: string }>
  has?: { continue?: boolean; favorites?: boolean; all?: boolean }
  /** false (tela Adulto): sem "Todos"; só as categorias. */
  showAll?: boolean
}): SideEntry[] {
  const has = { continue: true, favorites: true, all: true, ...opts.has }
  const out: SideEntry[] = []
  if (opts.personal && has.continue) out.push({ id: 'continue', label: COLLECTION_TITLES.continue })
  if (opts.personal && has.favorites) out.push({ id: 'favorites', label: COLLECTION_TITLES.favorites })
  const hasCategories = opts.categories.length > 0
  if (opts.showAll !== false && (has.all || (!hasCategories && out.length === 0))) out.push({ id: 'all', label: COLLECTION_TITLES.all })
  const sorted = [...opts.categories].sort((a, b) => compareText(a.name, b.name))
  const regular = sorted.filter((c) => !isAdultCategory(c.name))
  const adult = opts.allowAdult ? sorted.filter((c) => isAdultCategory(c.name)) : []
  for (const c of [...regular, ...adult]) out.push({ id: `cat:${c.key}`, label: c.name })
  return out
}

/**
 * Chave de ordenação A–Z: sem acentos, minúsculas e números com largura fixa
 * ("Título 2" < "Título 10"). Calculada uma vez por título (cache): comparar chaves
 * é muito mais barato que Intl.Collator em dezenas de milhares de itens na TV.
 */
const keyCache = new Map<string, string>()
const sortKey = (title: string): string => {
  const hit = keyCache.get(title)
  if (hit !== undefined) return hit
  let base = title.toLowerCase()
  try {
    base = base.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  } catch {
    /* sem normalize: segue com o texto original */
  }
  const key = base.replace(/\d+/g, (n) => (n.length < 10 ? '0'.repeat(10 - n.length) + n : n))
  if (keyCache.size > 100_000) keyCache.clear()
  keyCache.set(title, key)
  return key
}
const compareKeys = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

export function sortItems(items: CatalogItem[], sort: SortId): CatalogItem[] {
  const out = [...items]
  const keyed = sort === 'added' ? null : new Map<CatalogItem, string>(out.map((i) => [i, sortKey(i.title)]))
  if (sort === 'added') {
    // Mais recentes primeiro; sem data, no fim (A–Z entre si).
    return out.sort((a, b) => (b.addedAt ?? -Infinity) - (a.addedAt ?? -Infinity) || compareKeys(sortKey(a.title), sortKey(b.title)))
  }
  const dir = sort === 'az' ? 1 : -1
  out.sort((a, b) => dir * compareKeys(keyed!.get(a)!, keyed!.get(b)!))
  return out
}

export function itemFromIndexed(meta: IndexedItem): CatalogItem {
  return {
    id: meta.itemId,
    sourceId: meta.sourceId,
    kind: meta.kind,
    title: meta.title,
    category: meta.category ?? '',
    imageRef: meta.imageRef,
    providerRef: '',
    version: '',
    ...(meta.year !== undefined ? { year: meta.year } : {}),
    ...(meta.isAdult ? { isAdult: true } : {}),
  }
}

export const parseKinds = (raw: string | null, fallback: ContentKind[]): ContentKind[] => {
  const kinds = (raw ?? '').split(',').filter((k): k is ContentKind => k === 'movie' || k === 'series' || k === 'channel')
  return kinds.length ? kinds : fallback
}

export function parseCollection(raw: string | null): CollectionId {
  if (raw === 'continue' || raw === 'favorites' || raw === 'watched' || raw === 'wishlist' || raw === 'releases' || raw === 'all') return raw
  if (raw && raw.startsWith('cat:')) return raw as CollectionId
  return 'all'
}

/** One title per series, chosen before excluding completed playback. Older unfinished
 * episodes must never replace a newer completed episode in Continue watching. */
export function continuing(progress: import('../../services/api/types').ProgressEntry[], indexed: (id: string) => IndexedItem | null) {
  const seen = new Set<string>()
  const result: Array<{ entry: (typeof progress)[number]; meta: IndexedItem }> = []
  for (const entry of [...progress].sort((a, b) => b.updatedAt - a.updatedAt)) {
    const meta = indexed(entry.contentId)
    if (!meta || isAdultItem(meta) || (meta.kind === 'series' && !meta.episodeId)) continue
    if (seen.has(meta.itemId)) continue
    seen.add(meta.itemId)
    if (entry.duration > 0 && entry.position / entry.duration >= 0.95) continue
    result.push({ entry, meta })
  }
  return result
}

export function libraryTitles(entries: import('../../services/api/types').LibraryEntry[], indexed: (id: string) => IndexedItem | null, channels = false): CatalogItem[] {
  const seen = new Set<string>()
  return [...entries].sort((a, b) => b.updatedAt - a.updatedAt)
    .map((entry) => indexed(entry.contentId))
    .filter((meta): meta is IndexedItem => !!meta && !isAdultItem(meta) && (channels || meta.kind !== 'channel'))
    .filter((meta) => !seen.has(meta.itemId) && !!seen.add(meta.itemId))
    .map(itemFromIndexed)
}

/** Provider inclusion date, never the film's release year. Undated items remain
 * in provider order after dated entries, rather than pretending A–Z is chronology. */
export function latestReleases(items: CatalogItem[], limit = 5): CatalogItem[] {
  return [...items].filter((item) => item.kind !== 'channel' && !isAdultItem(item))
    .sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0)).slice(0, limit)
}
