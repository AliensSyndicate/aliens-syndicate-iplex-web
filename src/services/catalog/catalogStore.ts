/**
 * Catálogo autorizado do perfil atual, carregado progressivamente.
 *
 * Limitação do backend atual (readSourceCatalog): 30 itens por página, em
 * ordem alfabética, sem filtro por tipo ou categoria. Por isso:
 *  - cada fonte carrega algumas páginas iniciais e mais páginas sob demanda;
 *  - tipo/categoria são filtrados no cliente sobre o que já foi carregado;
 *  - nunca se carregam milhares de itens de uma vez (CATALOG.maxPages).
 * O backend filtra tudo pelo perfil do lease (infantil, espaços permitidos).
 */
import { categoryKey, categoryLabel } from './categoryLabels'
import { CATALOG } from '../../config/features'
import type { Backend } from '../api/backend'
import { AppError, toAppError } from '../api/errors'
import type { CatalogCategory, CatalogItem, ContentKind, Space } from '../api/types'

interface SpaceState {
  space: Space
  items: Map<string, CatalogItem>
  categories: CatalogCategory[]
  cursor: number
  hasMore: boolean
  pages: number
  version: string | null
  loading: Promise<void> | null
  error: AppError | null
}

export interface CatalogSnapshot {
  revision: number
  loading: boolean
  error: AppError | null
}

export class CatalogStore {
  private readonly states = new Map<string, SpaceState>()
  private readonly listeners = new Set<() => void>()
  private snapshot: CatalogSnapshot = { revision: 0, loading: false, error: null }
  private readonly backend: Pick<Backend, 'readCatalog'>
  private readonly profileId: string
  private disposed = false

  constructor(backend: Pick<Backend, 'readCatalog'>, profileId: string, spaces: Space[]) {
    this.backend = backend
    this.profileId = profileId
    spaces.forEach((space) => {
      this.states.set(space.sourceId, {
        space,
        items: new Map(),
        categories: [],
        cursor: 0,
        hasMore: true,
        pages: 0,
        version: null,
        loading: null,
        error: null,
      })
    })
  }

  /**
   * Carrega uma fonte inteira a partir dos seis conjuntos (preparados na inicialização, do cache
   * local ou do backend). Fica completa: sem páginas pendentes e sem carregamento progressivo.
   */
  hydrate(sourceId: string, sets: Record<'live' | 'vod' | 'series' | 'live_categories' | 'vod_categories' | 'series_categories', Array<Record<string, unknown>>>, version: string) {
    const state = this.states.get(sourceId)
    if (!state) return
    state.items.clear()
    for (const records of [sets.live, sets.vod, sets.series]) {
      for (const record of records) state.items.set(String(record.id), { ...(record as unknown as CatalogItem), sourceId })
    }
    state.categories = [...sets.live_categories, ...sets.vod_categories, ...sets.series_categories].map((c) => ({ id: String(c.id), name: String(c.name), kind: c.kind as ContentKind }))
    state.version = version
    state.pages = CATALOG.maxPages
    state.hasMore = false
    state.error = null
    this.bump()
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot = (): CatalogSnapshot => this.snapshot

  dispose() {
    this.disposed = true
    this.listeners.clear()
  }

  spaces(kind?: ContentKind): Space[] {
    return Array.from(this.states.values())
      .map((s) => s.space)
      .filter((space) => !kind || space.kinds.includes(kind))
  }

  /** Garante as páginas iniciais das fontes que têm o tipo pedido. */
  async ensure(kind: ContentKind, pages: number = CATALOG.initialPages): Promise<void> {
    await Promise.all(this.statesFor(kind).map((state) => this.loadUntil(state, pages)))
  }

  async loadMore(kind: ContentKind): Promise<void> {
    await Promise.all(this.statesFor(kind).map((state) => this.loadUntil(state, state.pages + CATALOG.morePages)))
  }

  hasMore(kind: ContentKind): boolean {
    return this.statesFor(kind).some((s) => s.hasMore && s.pages < CATALOG.maxPages)
  }

  items(kind: ContentKind): CatalogItem[] {
    const out: CatalogItem[] = []
    this.statesFor(kind).forEach((state) => state.items.forEach((item) => item.kind === kind && out.push(item)))
    return out
  }

  /**
   * Categorias (das fontes) com pelo menos um item carregado do tipo. A mesma
   * categoria em várias fontes é um único grupo (por nome), não um chip por fonte.
   */
  categories(kind: ContentKind): Array<{ key: string; name: string; items: CatalogItem[] }> {
    const groups = new Map<string, { key: string; name: string; items: CatalogItem[]; order: number }>()
    this.statesFor(kind).forEach((state) => {
      const order = new Map(state.categories.filter((c) => c.kind === kind).map((c, i) => [c.id, i]))
      const names = new Map(state.categories.filter((c) => c.kind === kind).map((c) => [c.id, c.name]))
      state.items.forEach((item) => {
        if (item.kind !== kind) return
        // De-para: nomes diferentes que viram o mesmo texto são um só grupo; adultas viram "Adulto".
        const name = categoryLabel((item.categoryId && names.get(item.categoryId)) || item.category || 'Sem categoria')
        const key = categoryKey(name)
        const rank = order.get(item.categoryId ?? '') ?? 10_000
        const group = groups.get(key) ?? { key, name, items: [], order: rank }
        group.order = Math.min(group.order, rank)
        group.items.push(item)
        groups.set(key, group)
      })
    })
    return Array.from(groups.values())
      .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'pt-BR'))
      .map(({ key, name, items }) => ({ key, name, items }))
  }

  findLoaded(itemId: string): CatalogItem | null {
    for (const state of this.states.values()) {
      const item = state.items.get(itemId)
      if (item) return item
    }
    return null
  }

  /**
   * Localiza um item pelo id público. Se ainda não carregado, consulta o
   * backend pela busca de título (o backend aplica as permissões do perfil:
   * conteúdo bloqueado simplesmente não é encontrado).
   */
  async findItem(sourceId: string | null, itemId: string, titleHint: string): Promise<CatalogItem | null> {
    const loaded = this.findLoaded(itemId)
    if (loaded) return loaded
    const targets = sourceId ? [this.states.get(sourceId)].filter(Boolean) : Array.from(this.states.values())
    for (const state of targets as SpaceState[]) {
      try {
        const page = await this.backend.readCatalog(this.profileId, { sourceId: state.space.sourceId, search: titleHint.slice(0, 300) })
        const match = page.items.find((item) => item.id === itemId)
        if (match) {
          state.items.set(match.id, match)
          this.bump()
          return match
        }
      } catch (error) {
        const appError = toAppError(error)
        if (appError.kind !== 'content-unavailable') throw appError
      }
    }
    return null
  }

  /** Busca global nas fontes autorizadas (primeira página de cada). */
  async search(term: string): Promise<CatalogItem[]> {
    const results = await Promise.all(
      Array.from(this.states.values()).map(async (state) => {
        try {
          const page = await this.backend.readCatalog(this.profileId, { sourceId: state.space.sourceId, search: term })
          return page.items
        } catch (error) {
          const appError = toAppError(error)
          if (appError.kind === 'content-unavailable') return []
          throw appError
        }
      }),
    )
    return results.flat()
  }

  errorFor(kind: ContentKind): AppError | null {
    const states = this.statesFor(kind)
    const failed = states.filter((s) => s.error)
    // Erro só quando nenhuma fonte do tipo respondeu; fontes parciais seguem visíveis.
    return failed.length && failed.length === states.length ? failed[0]!.error : null
  }

  isLoading(kind: ContentKind): boolean {
    return this.statesFor(kind).some((s) => s.loading !== null)
  }

  /** Recarrega do zero (ex.: tentar novamente após falha da fonte). */
  async reload(kind: ContentKind) {
    this.statesFor(kind).forEach((state) => this.reset(state))
    this.bump()
    await this.ensure(kind)
  }

  private statesFor(kind: ContentKind): SpaceState[] {
    return Array.from(this.states.values()).filter((s) => s.space.kinds.includes(kind))
  }

  private reset(state: SpaceState) {
    state.items.clear()
    state.categories = []
    state.cursor = 0
    state.hasMore = true
    state.pages = 0
    state.version = null
    state.error = null
  }

  private async loadUntil(state: SpaceState, pages: number): Promise<void> {
    const target = Math.min(pages, CATALOG.maxPages)
    while (!this.disposed && state.hasMore && state.pages < target) {
      if (state.loading) {
        await state.loading
        continue
      }
      state.loading = this.loadPage(state)
      this.bump()
      try {
        await state.loading
      } finally {
        state.loading = null
        this.bump()
      }
      if (state.error) return
    }
  }

  private async loadPage(state: SpaceState) {
    try {
      const page = await this.backend.readCatalog(this.profileId, { sourceId: state.space.sourceId, cursor: state.cursor })
      if (state.version && page.version !== state.version) {
        // Catálogo republicado durante a navegação: recomeça para não misturar versões.
        this.reset(state)
        return
      }
      state.version = page.version
      page.items.forEach((item) => state.items.set(item.id, item))
      if (page.categories.length) state.categories = page.categories
      state.cursor = page.cursor
      state.hasMore = page.hasMore
      state.pages += 1
      state.error = null
    } catch (error) {
      const appError = toAppError(error)
      if (appError.code === 'source-conflict') {
        this.reset(state)
        return
      }
      state.error = appError
      state.hasMore = appError.kind !== 'content-unavailable' && state.hasMore
    }
  }

  private bump() {
    if (this.disposed) return
    const anyLoading = Array.from(this.states.values()).some((s) => s.loading !== null)
    this.snapshot = { revision: this.snapshot.revision + 1, loading: anyLoading, error: null }
    this.listeners.forEach((listener) => listener())
  }
}
