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
import { diag } from '../../platform/diagnostics'
import { isAdultItem } from './adult'
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
  /** Perfil habilitado ao conteúdo adulto (manifesto do Control). */
  adultEnabled: boolean
  /** Grupos (tipos e 'adult') ainda sendo carregados do cache em segundo plano. */
  pending: Set<string>
}

/** Conjunto de registros do catálogo (cache/backend) como o store o recebe. */
export type SetRecords = Array<Record<string, unknown>>
const SLICE = 2000
/** Cede a thread à interface (foco e rolagem) entre fatias de trabalho longo. */
const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

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
        adultEnabled: false,
        pending: new Set(),
      })
    })
  }

  /**
   * Carrega uma fonte inteira a partir dos conjuntos (preparados na inicialização, do cache
   * local ou do backend). Fica completa: sem páginas pendentes e sem carregamento progressivo.
   * O 8º conjunto (`adult`) traz todo o conteúdo adulto, marcado com `isAdult`: ele só aparece na tela Adulto.
   */
  hydrate(sourceId: string, sets: Record<'live' | 'vod' | 'series' | 'live_categories' | 'vod_categories' | 'series_categories', Array<Record<string, unknown>>> & { adult?: Array<Record<string, unknown>> }, version: string, adultEnabled = false) {
    const state = this.states.get(sourceId)
    if (!state) return
    const started = performance.now()
    state.items.clear()
    for (const records of [sets.live, sets.vod, sets.series]) {
      for (const record of records) state.items.set(String(record.id), { ...(record as unknown as CatalogItem), sourceId })
    }
    for (const record of sets.adult ?? []) state.items.set(String(record.id), { ...(record as unknown as CatalogItem), sourceId, isAdult: true })
    state.adultEnabled = adultEnabled
    state.categories = [...sets.live_categories, ...sets.vod_categories, ...sets.series_categories].map((c) => ({ id: String(c.id), name: String(c.name), kind: c.kind as ContentKind }))
    state.version = version
    state.pages = CATALOG.maxPages
    state.hasMore = false
    state.error = null
    state.pending.clear()
    this.bump()
    diag('hydrate', `${state.items.size} itens ${Math.round(performance.now() - started)}ms`)
  }

  /**
   * Entrada rápida (cache válido): a fonte abre vazia e completa — sem páginas pendentes — e cada grupo
   * (`channel`, `movie`, `series`, `adult`) chega depois por `fillGroup`. Enquanto isso `isLoading(tipo)` é verdadeiro.
   */
  beginProgressive(sourceId: string, version: string, adultEnabled: boolean) {
    const state = this.states.get(sourceId)
    if (!state) return
    state.items.clear()
    state.categories = []
    state.version = version
    state.adultEnabled = adultEnabled
    state.pages = CATALOG.maxPages
    state.hasMore = false
    state.error = null
    state.pending = new Set<string>(['channel', 'movie', 'series', ...(adultEnabled ? ['adult'] : [])])
    this.bump()
  }

  /** Recebe um grupo (categorias + itens) em fatias, cedendo a thread entre elas. Um `bump` ao final. */
  async fillGroup(sourceId: string, group: 'channel' | 'movie' | 'series' | 'adult', categories: SetRecords, records: SetRecords) {
    const state = this.states.get(sourceId)
    if (!state) return
    const adult = group === 'adult'
    for (let i = 0; i < records.length; i += SLICE) {
      if (this.disposed) return
      for (const record of records.slice(i, i + SLICE)) state.items.set(String(record.id), { ...(record as unknown as CatalogItem), sourceId, ...(adult ? { isAdult: true } : {}) })
      if (i + SLICE < records.length) await pause()
    }
    if (this.disposed) return
    const mapped = categories.map((c) => ({ id: String(c.id), name: String(c.name), kind: c.kind as ContentKind }))
    if (!adult) state.categories = [...state.categories.filter((c) => c.kind !== group), ...mapped]
    state.pending.delete(group)
    const bumped = performance.now()
    this.bump()
    await pause()
    diag('catalog', `${group}: atualização das telas ≈${Math.round(performance.now() - bumped)}ms`)
  }

  /** Encerra o carregamento progressivo de uma fonte sem mais dados (ex.: grupo adulto desligado). */
  finishProgressive(sourceId: string) {
    const state = this.states.get(sourceId)
    if (!state) return
    state.pending.clear()
    this.bump()
  }

  /**
   * Como `hydrate`, mas em fatias e sem apagar o que a tela já mostra: monta a lista nova ao lado e a troca de uma vez.
   * Usado quando o catálogo conferido em segundo plano difere do que foi aberto do cache.
   */
  async hydrateAsync(sourceId: string, sets: Parameters<CatalogStore['hydrate']>[1], version: string, adultEnabled = false) {
    const state = this.states.get(sourceId)
    if (!state) return
    const next = new Map<string, CatalogItem>()
    const tagged: Array<[SetRecords, boolean]> = [[sets.live, false], [sets.vod, false], [sets.series, false], [sets.adult ?? [], true]]
    let n = 0
    for (const [records, adult] of tagged) {
      for (const record of records) {
        next.set(String(record.id), { ...(record as unknown as CatalogItem), sourceId, ...(adult ? { isAdult: true } : {}) })
        n += 1
        if (n % SLICE === 0) {
          await pause()
          if (this.disposed) return
        }
      }
    }
    if (this.disposed) return
    state.items = next
    state.adultEnabled = adultEnabled
    state.categories = [...sets.live_categories, ...sets.vod_categories, ...sets.series_categories].map((c) => ({ id: String(c.id), name: String(c.name), kind: c.kind as ContentKind }))
    state.version = version
    state.pages = CATALOG.maxPages
    state.hasMore = false
    state.error = null
    state.pending.clear()
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
    this.statesFor(kind).forEach((state) => state.items.forEach((item) => item.kind === kind && !item.isAdult && out.push(item)))
    return out
  }

  /** Todo o conteúdo adulto (canais, filmes e séries), só para a tela Adulto. */
  adultItems(): CatalogItem[] {
    const out: CatalogItem[] = []
    this.states.forEach((state) => state.items.forEach((item) => item.isAdult && out.push(item)))
    return out
  }

  /**
   * O Control desligou o conteúdo adulto deste perfil: some na hora (menu e itens), sem esperar o catálogo novo
   * (o download completo leva dezenas de segundos na TV). O catálogo refeito em seguida confirma.
   */
  revokeAdult() {
    this.states.forEach((state) => {
      state.adultEnabled = false
      state.items.forEach((item, id) => item.isAdult && state.items.delete(id))
    })
    this.bump()
  }

  /** O Control ligou (ou mudou) o conteúdo adulto: troca só os itens adultos da fonte, sem refazer o resto do catálogo. */
  applyAdult(sourceId: string, records: Array<Record<string, unknown>>, enabled: boolean) {
    const state = this.states.get(sourceId)
    if (!state) return
    state.items.forEach((item, id) => item.isAdult && state.items.delete(id))
    for (const record of records) state.items.set(String(record.id), { ...(record as unknown as CatalogItem), sourceId, isAdult: true })
    state.adultEnabled = enabled
    this.bump()
  }

  /** O perfil está habilitado ao conteúdo adulto? (manifesto; backend antigo: há itens adultos). */
  adultEnabled(): boolean {
    return Array.from(this.states.values()).some((s) => s.adultEnabled) || this.adultItems().length > 0
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
        if (item.kind !== kind || item.isAdult) return
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
    // Carregamento do cache em andamento: o item pode estar a caminho; espera antes de consultar o backend.
    if (this.hasPending()) {
      await this.whenSettled(20_000)
      const arrived = this.findLoaded(itemId)
      if (arrived) return arrived
    }
    const targets = sourceId ? [this.states.get(sourceId)].filter(Boolean) : Array.from(this.states.values())
    for (const state of targets as SpaceState[]) {
      try {
        const page = await this.backend.readCatalog(this.profileId, { sourceId: state.space.sourceId, search: titleHint.slice(0, 300) })
        const match = page.items.find((item) => item.id === itemId)
        if (match) {
          state.items.set(match.id, isAdultItem(match) ? { ...match, isAdult: true } : match)
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

  private hasPending(): boolean {
    return Array.from(this.states.values()).some((s) => s.pending.size > 0)
  }

  private whenSettled(timeoutMs: number): Promise<void> {
    if (!this.hasPending() || this.disposed) return Promise.resolve()
    return new Promise<void>((resolve) => {
      const finish = () => {
        clearTimeout(timer)
        this.listeners.delete(check)
        resolve()
      }
      const check = () => {
        if (!this.hasPending()) finish()
      }
      const timer = setTimeout(finish, timeoutMs)
      this.listeners.add(check)
    })
  }

  errorFor(kind: ContentKind): AppError | null {
    const states = this.statesFor(kind)
    const failed = states.filter((s) => s.error)
    // Erro só quando nenhuma fonte do tipo respondeu; fontes parciais seguem visíveis.
    return failed.length && failed.length === states.length ? failed[0]!.error : null
  }

  isLoading(kind: ContentKind): boolean {
    return this.statesFor(kind).some((s) => s.loading !== null || s.pending.has(kind))
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
    state.pending.clear()
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
      // Backend paginado (antigo): classifica aqui para o adulto não se misturar às listas comuns.
      page.items.forEach((item) => state.items.set(item.id, isAdultItem(item) ? { ...item, isAdult: true } : item))
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
    const anyLoading = Array.from(this.states.values()).some((s) => s.loading !== null || s.pending.size > 0)
    this.snapshot = { revision: this.snapshot.revision + 1, loading: anyLoading, error: null }
    this.listeners.forEach((listener) => listener())
  }
}
