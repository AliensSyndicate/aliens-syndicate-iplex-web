/**
 * Tela Catálogo reutilizável (Filmes, Séries, Favoritos, Continuar assistindo…).
 *
 * Foco e rolagem têm UM dono (esta tela; o main leva [data-nav-managed] e a
 * navegação espacial genérica não rola nada aqui):
 * - Menu lateral: lista própria; o item focado é centralizado na área visível,
 *   limitado à rolagem real (sem preenchimento artificial). Foco ≠ seleção: só
 *   OK/Enter troca a coleção; a primeira coleção com conteúdo já nasce selecionada.
 * - Catálogo: título + ordenação + grid de pôsteres (5 por linha) numa única
 *   área rolável. Navegação ortogonal por índice, sem serpentina. Primeira linha
 *   rola até o topo real (título), última até o fim real; no meio, rolagem mínima.
 * - Janelamento por linhas: só as linhas próximas da área visível existem no DOM.
 */
import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useReadySession } from '../../app/providers/SessionProvider'
import { contentPath, PATHS } from '../../app/routes/paths'
import { ChannelCard } from '../../components/catalog/ChannelCard'
import { PosterCard } from '../../components/catalog/PosterCard'
import { EmptyState } from '../../components/feedback/EmptyState'
import { SkeletonGrid } from '../../components/feedback/LoadingState'
import { SourceStates } from '../../components/feedback/SourceStates'
import { IplexText } from '../../components/ui/IplexText'
import { diag } from '../../platform/diagnostics'
import { useAdultCatalog } from '../../hooks/useAdultCatalog'
import { useCatalog } from '../../hooks/useCatalog'
import { useLibrary } from '../../hooks/useLibrary'
import { useInitialFocus, useKeyHandler } from '../../navigation/FocusProvider'
import { animateScrollTop, cancelScroll, centeredTop, revealTop } from '../../navigation/scrollMath'
import { focusElement } from '../../navigation/spatial'
import { isArrow } from '../../platform/keys'
import type { CatalogItem, ContentKind } from '../../services/api/types'
import type { IndexedItem } from '../../services/library/libraryStore'
import { isAdultItem } from '../../services/catalog/adult'
import { viewMemory } from './viewMemory'
import { LiveChannelPanel } from '../live-tv/LiveChannelPanel'
import { useLiveState } from '../live-tv/useLiveState'
import { hasPersonalLibrary, isKids } from '../profiles/profileRules'
import { COLLECTION_TITLES, buildSidebar, isAdultCategory, itemFromIndexed, sortItems, sortOptionsFor, continuing, latestReleases, type CollectionId, type PersonalCollection, type SideEntry, type SortId } from './collections'

const GRID_COLS = 5
const LIVE_COLS = 6
/** Primeiro lote e lotes seguintes do grid (também a quantidade de skeletons). */
const BATCH = 30
const SKELETONS = BATCH
const SKELETONS_LIVE = BATCH
const OVERSCAN = 3
const DEFAULT_ROW_HEIGHT = 340
const MIN_FILL = 24
const REVEAL_PAD = 24
/** Ordem das categorias no "Ver tudo" (mesmas do Meu iPlex). */
const SCOPE_ORDER: PersonalCollection[] = ['continue', 'favorites', 'wishlist', 'releases', 'watched']


const GridCard = memo(function GridCard({ item, index, onOpen, selected }: { item: CatalogItem; index: number; onOpen: (item: CatalogItem) => void; selected: boolean }) {
  if (item.kind === 'channel') return <ChannelCard item={item} navId={`card-${item.id}`} navGroup="catalog-grid" onSelect={onOpen} gridIndex={index} selected={selected} />
  return <PosterCard item={item} navId={`card-${item.id}`} navGroup="catalog-grid" onSelect={onOpen} posterOnly gridIndex={index} />
})

/** Linha do grid: memoizada para que só as linhas que entram/saem da janela sejam montadas. */
const GridRow = memo(function GridRow({ items, rowIndex, cols, selectedId, onOpen }: { items: CatalogItem[]; rowIndex: number; cols: number; selectedId: string | null; onOpen: (item: CatalogItem) => void }) {
  return (
    <div className="iplex-catalog__row">
      {items.map((item, c) => (
        <GridCard key={item.id} item={item} index={rowIndex * cols + c} onOpen={onOpen} selected={item.id === selectedId} />
      ))}
    </div>
  )
})

export function CatalogScreen({ kinds, title, initial, live = false, adult = false, scope }: { kinds: ContentKind[]; title: string; initial: CollectionId; live?: boolean; adult?: boolean; scope?: PersonalCollection }) {
  const cols = live ? LIVE_COLS : GRID_COLS
  const navigate = useNavigate()
  const location = useLocation()
  const session = useReadySession()
  const routeKey = `${location.pathname}${location.search}`
  const wantMovies = kinds.includes('movie')
  const wantSeries = kinds.includes('series')
  const wantChannels = kinds.includes('channel')
  const movies = useCatalog('movie', wantMovies && !adult)
  const series = useCatalog('series', wantSeries && !adult)
  const channels = useCatalog('channel', wantChannels && !adult)
  const adultCatalog = useAdultCatalog(adult)
  const { library, store, loaded: libraryLoaded } = useLibrary()
  // Adulto: nada é guardado (sem Continuar, Favoritos nem lista); nas outras telas o adulto nunca aparece neles.
  const personal = !adult && hasPersonalLibrary(session.profile)
  const inScope = (meta: { isAdult?: boolean; title?: string; category?: string }) => !isAdultItem(meta)
  // A habilitação real vem do backend (perfil no Control): sem ela, nenhum item/categoria adulta chega aqui.
  const allowAdult = !isKids(session.profile)
  const remembered = viewMemory.get(routeKey)

  // Coleção confirmada (OK/Enter) ou lembrada; enquanto nula vale a primeira com conteúdo.
  const [chosen, setChosen] = useState<CollectionId | null>(remembered?.selected ?? (initial === 'all' ? null : initial))
  const [sort, setSort] = useState<SortId>(remembered?.sort ?? 'az')

  // Primeira renderização: pinta o skeleton antes do trabalho pesado (categorias e ordenação de dezenas de
  // milhares de itens travam a TV). Ao voltar dos detalhes (view lembrada) já nasce pronta, para restaurar a rolagem.
  const [warm, setWarm] = useState(!!remembered)
  useEffect(() => {
    if (warm) return
    const id = setTimeout(() => setWarm(true), 60)
    return () => clearTimeout(id)
  }, [warm])

  const active = useMemo(
    () => (adult ? [adultCatalog] : [wantMovies ? movies : null, wantSeries ? series : null, wantChannels ? channels : null].filter((c): c is NonNullable<typeof c> => !!c)),
    [adult, adultCatalog, wantMovies, wantSeries, wantChannels, movies, series, channels],
  )
  const spacesError = active.find((c) => c.spacesError)?.spacesError ?? null
  const noSources = active.some((c) => c.noSources)
  const noKind = active.length > 0 && active.every((c) => c.noKind)
  const error = active.length > 0 && active.every((c) => c.error) ? active[0]!.error : null
  const loading = !warm || active.some((c) => c.loading)
  const hasMore = active.some((c) => c.hasMore)
  const loadMoreAll = active.map((c) => c.loadMore)
  const reload = useCallback(() => active.forEach((c) => c.reload()), [active])
  const loadMore = useCallback(() => loadMoreAll.forEach((fn) => fn()), []) // eslint-disable-line react-hooks/exhaustive-deps
  const loadMoreRef = useRef(loadMore)
  useEffect(() => {
    loadMoreRef.current = loadMore
  })

  // Categorias do fornecedor (por nome, juntando fontes e tipos), só com itens carregados.
  const groups = useMemo(() => {
    if (!warm) return new Map<string, { key: string; name: string; items: CatalogItem[] }>()
    const byKey = new Map<string, { key: string; name: string; items: CatalogItem[] }>()
    for (const c of active) {
      for (const g of c.categories) {
        const cur = byKey.get(g.key)
        if (cur) cur.items = cur.items.concat(g.items)
        else byKey.set(g.key, { key: g.key, name: g.name, items: g.items.slice() })
      }
    }
    return byKey
  }, [active, warm])
  // "Todos" nunca inclui conteúdo adulto: ele só existe dentro da categoria "Adulto".
  const allItems = useMemo(() => (warm ? active.flatMap((c) => c.items).filter((i) => adult || !isAdultItem(i)) : []), [active, warm, adult])


  const progressMeta = useMemo(() => {
    const byItem = new Map<string, IndexedItem>()
    if (!personal) return byItem
    for (const { meta } of continuing(library.progress, (id) => store.indexed(id))) {
      if (kinds.includes(meta.kind) && inScope(meta)) byItem.set(meta.itemId, meta)
    }
    return byItem
  }, [library.progress, store, kinds, personal])

  const libraryLists = useMemo(() => {
    const fromLibrary = (ids: Array<{ contentId: string }>) =>
      personal ? ids.map((e) => store.indexed(e.contentId)).filter((m): m is IndexedItem => !!m && kinds.includes(m.kind) && inScope(m)).map(itemFromIndexed) : []
    return {
      favorites: fromLibrary(library.favorites),
      wishlist: fromLibrary(library.wishlist ?? []),
      watched: fromLibrary(library.watched),
    }
  }, [library.favorites, library.wishlist, library.watched, store, kinds, personal])

  // "Ver tudo" (como no Control): uma tela só; o menu lateral troca entre as categorias do Meu iPlex que têm
  // conteúdo (abre na tocada) e cada uma mostra TODOS os seus itens.
  const scopeLists = useMemo<Record<PersonalCollection, CatalogItem[]>>(() => {
    if (!scope) return { continue: [], favorites: [], wishlist: [], releases: [], watched: [] }
    return {
      continue: Array.from(progressMeta.values()).map(itemFromIndexed),
      favorites: libraryLists.favorites,
      wishlist: libraryLists.wishlist,
      releases: latestReleases(allItems, 500),
      watched: libraryLists.watched,
    }
  }, [scope, progressMeta, allItems, libraryLists])

  const sidebar = useMemo(
    () =>
      scope
        ? SCOPE_ORDER.filter((id) => id === scope || scopeLists[id].length > 0).map((id) => ({ id: id as CollectionId, label: COLLECTION_TITLES[id] }) as SideEntry)
        : buildSidebar({
        personal,
        allowAdult,
        showAll: !adult,
        categories: Array.from(groups.values()).filter((g) => g.items.length > 0).map((g) => ({ key: g.key, name: g.name })),
        has: {
          continue: progressMeta.size > 0 || initial === 'continue',
          favorites: libraryLists.favorites.length > 0 || initial === 'favorites',
          wishlist: libraryLists.wishlist.length > 0 || initial === 'wishlist',
          watched: libraryLists.watched.length > 0 || initial === 'watched',
          all: allItems.length > 0,
        },
      }),
    [personal, allowAdult, adult, groups, progressMeta, libraryLists.favorites, libraryLists.wishlist, libraryLists.watched, allItems.length, initial, scope, scopeLists],
  )

  // Primeira coleção do menu com conteúdo real (nunca prende o foco em categoria vazia).
  const firstWithContent = useMemo<CollectionId>(() => {
    if (scope) return scope
    if (initial && sidebar.some((s) => s.id === initial)) return initial
    for (const entry of sidebar) {
      if (entry.id === 'continue' && progressMeta.size > 0) return entry.id
      if (entry.id === 'favorites' && libraryLists.favorites.length > 0) return entry.id
      if (entry.id === 'wishlist' && libraryLists.wishlist.length > 0) return entry.id
      if (entry.id === 'watched' && libraryLists.watched.length > 0) return entry.id
      if (entry.id === 'all' && allItems.length > 0) return entry.id
      if (entry.id.startsWith('cat:') && (groups.get(entry.id.slice(4))?.items.length ?? 0) > 0) return entry.id
    }
    return sidebar.some((s) => s.id === 'all') ? 'all' : (sidebar[0]?.id ?? initial)
  }, [sidebar, progressMeta, libraryLists.favorites, libraryLists.wishlist, libraryLists.watched, allItems.length, groups, initial, scope])

  const ready = (!personal || libraryLoaded) && (!loading || allItems.length > 0 || !!(spacesError || noSources || noKind || error))
  useEffect(() => {
    if (chosen === null && ready) setChosen(firstWithContent)
  }, [chosen, ready, firstWithContent])

  // Sempre há uma coleção selecionada: a confirmada (se ainda existir no menu) ou a primeira com conteúdo.
  const selected: CollectionId = chosen && sidebar.some((s) => s.id === chosen) ? chosen : firstWithContent

  // ---- Ao Vivo: player de fundo mudo, painel do canal e saída da interface ----
  const favoriteIds = useMemo(() => new Set(library.favorites.map((f) => f.contentId)), [library.favorites])
  const liveState = useLiveState({ enabled: live, catalog: session.catalog, store, favoriteIds, personal, canPlay: !session.unavailable })

  const base = useMemo<CatalogItem[]>(() => {
    if (scope) return scopeLists[selected as PersonalCollection] ?? []
    if (selected === 'continue') return Array.from(progressMeta.values()).map(itemFromIndexed)
    if (selected === 'favorites') return libraryLists.favorites
    if (selected === 'wishlist') return libraryLists.wishlist
    if (selected === 'watched') return libraryLists.watched
    if (selected === 'all') return allItems
    const group = groups.get(selected.slice(4))
    if (!group || (isAdultCategory(group.name) && !allowAdult)) return []
    return group.items
  }, [selected, progressMeta, libraryLists, allItems, groups, allowAdult, scope, scopeLists])

  const sortOptions = useMemo(() => sortOptionsFor(base), [base])
  const effectiveSort: SortId = sortOptions.some((o) => o.id === sort) ? sort : 'az'
  const items = useMemo(() => sortItems(base, effectiveSort), [base, effectiveSort])
  // Painel do canal (Ao Vivo): abre na linha imediatamente acima do canal selecionado.
  const armedIndex = live && liveState.shownId ? items.findIndex((i) => i.id === liveState.shownId) : -1
  const panelRow = armedIndex >= 0 ? Math.floor(armedIndex / cols) : -1
  const panelOpen = liveState.open && panelRow >= 0
  const panelMounted = panelRow >= 0
  const [panelH, setPanelH] = useState(0)

  const liveActivate = liveState.activate
  const open = useCallback(
    (item: CatalogItem) => {
      const meta = selected === 'continue' ? progressMeta.get(item.id) : undefined
      if (meta && !session.unavailable) navigate(PATHS.watch({ sourceId: meta.sourceId, itemId: meta.itemId, kind: meta.kind, title: meta.title, episodeId: meta.episodeId, resume: true }))
      else if (live && item.kind === 'channel') liveActivate(item)
      else navigate(contentPath(item))
    },
    [navigate, selected, progressMeta, live, liveActivate, session.unavailable],
  )

  // ---- janelamento do grid ------------------------------------------------
  const sideRef = useRef<HTMLElement>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const [rowHeight, setRowHeight] = useState(DEFAULT_ROW_HEIGHT)
  const [range, setRange] = useState<[number, number]>([0, 6])
  const totalRows = Math.ceil(items.length / cols)
  const geometry = useRef({ rowHeight: DEFAULT_ROW_HEIGHT, rowGap: 0, totalRows, hasMore, panelRow: -1, panelH: 0 })
  const panelRef = useRef<HTMLElement>(null)
  const panelRowRef = useRef(-1)
  const armedIndexRef = useRef(-1)
  const itemsLen = useRef(items.length)
  // Layout effect: a janela do grid (recompute, nos layout effects abaixo) precisa do total de linhas já atualizado,
  // senão a primeira conta usa 0 linhas e só a primeira linha monta até alguém rolar.
  useLayoutEffect(() => {
    geometry.current.totalRows = totalRows
    geometry.current.hasMore = hasMore
    geometry.current.panelRow = panelOpen ? panelRow : -1
    panelRowRef.current = panelOpen ? panelRow : -1
    armedIndexRef.current = armedIndex
    geometry.current.panelH = panelOpen ? panelH : 0
    itemsLen.current = items.length
  })

  const routeKeyRef = useRef(routeKey)
  useEffect(() => {
    routeKeyRef.current = routeKey
  })

  const recompute = useCallback(() => {
    const sc = scrollerRef.current
    const grid = gridRef.current
    if (!sc || !grid) return
    const { rowHeight: rh, totalRows: rows, hasMore: more } = geometry.current
    const viewH = sc.clientHeight || window.innerHeight || 1080
    const rel = sc.scrollTop - grid.offsetTop
    // O painel do canal ocupa `panelH` antes da linha `panelRow`: converte o deslocamento em linha.
    const { panelRow: pr, panelH: ph } = geometry.current
    const toRow = (offset: number) => (pr < 0 || ph <= 0 || offset <= pr * rh ? offset / rh : offset < pr * rh + ph ? pr : (offset - ph) / rh)
    const first = Math.max(0, Math.floor(toRow(rel)) - OVERSCAN)
    const last = Math.max(first, Math.min(rows - 1, Math.ceil(toRow(rel + viewH)) + OVERSCAN))
    setRange((cur) => (cur[0] === first && cur[1] === last ? cur : [first, last]))
    const mem = viewMemory.get(routeKeyRef.current)
    if (mem) mem.scrollTop = sc.scrollTop
    if (more && last >= rows - 4) loadMoreRef.current()
  }, [])

  useLayoutEffect(() => {
    const mem = viewMemory.get(routeKey)
    viewMemory.set(routeKey, { selected, sort, scrollTop: mem ? mem.scrollTop : 0 })
  }, [routeKey, selected, sort])

  // Mede a altura real da linha (inclui espaçamento) e reconsidera a janela.
  const measure = useCallback(() => {
    const row = gridRef.current?.querySelector<HTMLElement>('.iplex-catalog__row')
    if (row) {
      const gap = parseFloat(getComputedStyle(row).marginBottom) || 0
      const h = row.offsetHeight + gap
      if (h > 0) {
        geometry.current.rowHeight = h
        geometry.current.rowGap = gap
        setRowHeight((cur) => (Math.abs(cur - h) < 0.5 ? cur : h))
      }
    }
    recompute()
  }, [recompute])

  useLayoutEffect(() => {
    if (remembered && scrollerRef.current) scrollerRef.current.scrollTop = remembered.scrollTop
    measure()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useLayoutEffect(measure, [items.length, rowHeight, measure])
  useEffect(() => {
    let raf = 0
    const onResize = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(measure)
    }
    window.addEventListener('resize', onResize)
    window.scrollTo(0, 0)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize)
      if (scrollerRef.current) cancelScroll(scrollerRef.current)
      if (sideRef.current) cancelScroll(sideRef.current)
    }
  }, [measure])

  const scrollRaf = useRef(0)
  const onScroll = useCallback(() => {
    if (scrollRaf.current) return
    scrollRaf.current = requestAnimationFrame(() => {
      scrollRaf.current = 0
      recompute()
    })
  }, [recompute])

  // Último card focado no grid (para voltar a ele vindo do menu lateral).
  const lastGridIndex = useRef<number | null>(null)
  const pendingFocus = useRef<number | null>(null)
  const zone = useRef<'side' | 'sort' | 'grid' | null>(null)

  // Nova coleção/ordenação: volta ao início do catálogo, sem animação.
  const first = useRef(true)
  useLayoutEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    lastGridIndex.current = null
    pendingFocus.current = null
    if (scrollerRef.current) {
      cancelScroll(scrollerRef.current)
      scrollerRef.current.scrollTop = 0
    }
    const mem = viewMemory.get(routeKey)
    if (mem) mem.scrollTop = 0
    recompute()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, effectiveSort])

  // Coleções vindas do catálogo paginado: busca mais páginas até preencher a tela.
  const fromCatalog = !scope && (selected === 'all' || selected.startsWith('cat:'))
  useEffect(() => {
    if (fromCatalog && hasMore && !loading && items.length < MIN_FILL) loadMore()
  }, [fromCatalog, hasMore, loading, items.length, loadMore])

  // ---- foco -----------------------------------------------------------------
  useInitialFocus(routeKey, ready)

  /** Rolagem do catálogo para o card: topo real na 1ª linha, fim real na última, mínimo no meio. */
  const revealRow = useCallback((row: number) => {
    const sc = scrollerRef.current
    const grid = gridRef.current
    if (!sc || !grid) return
    const { rowHeight: rh, rowGap, totalRows: rows, hasMore: more } = geometry.current
    const max = Math.max(0, sc.scrollHeight - sc.clientHeight)
    const inset = parseFloat(getComputedStyle(sc).paddingTop) || 0
    const target =
      row === 0 ? 0 : row >= rows - 1 && !more ? max : revealTop(sc.scrollTop, grid.offsetTop + row * rh + (geometry.current.panelRow >= 0 && row >= geometry.current.panelRow ? geometry.current.panelH : 0), rh - rowGap, sc.clientHeight, REVEAL_PAD, max, inset)
    animateScrollTop(sc, target)
  }, [])

  const focusCard = useCallback(
    (index: number) => {
      const sc = scrollerRef.current
      const grid = gridRef.current
      if (!sc || !grid || index < 0 || index >= itemsLen.current) return false
      const el = grid.querySelector<HTMLElement>(`[data-grid-index="${index}"]`)
      if (el) {
        focusElement(el)
        return true
      }
      // Fora da janela (retorno/salto): posiciona a linha; o foco é aplicado quando o card montar.
      pendingFocus.current = index
      cancelScroll(sc)
      const { rowHeight: rh, rowGap } = geometry.current
      const rowIdx = Math.floor(index / cols)
      const top = grid.offsetTop + rowIdx * rh + (geometry.current.panelRow >= 0 && rowIdx >= geometry.current.panelRow ? geometry.current.panelH : 0)
      sc.scrollTop = centeredTop(top, rh - rowGap, sc.clientHeight, sc.scrollHeight - sc.clientHeight, parseFloat(getComputedStyle(sc).paddingTop) || 0)
      recompute()
      return true
    },
    [recompute],
  )

  /** Altura real do painel (conteúdo inteiro, mesmo no meio da animação) e janela do grid. */
  const measurePanel = useCallback(() => {
    const el = panelRef.current
    const h = el && el.classList.contains('is-open') ? el.scrollHeight : 0
    setPanelH((cur) => (Math.abs(cur - h) < 1 ? cur : h))
    geometry.current.panelH = h
    recompute()
  }, [recompute])
  /** Painel à vista: rola o mínimo para mostrar o painel e a linha do canal. */
  const revealPanel = useCallback(() => {
    const sc = scrollerRef.current
    const el = panelRef.current
    if (!sc || !el) return
    const top = el.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop
    const max = Math.max(0, sc.scrollHeight - sc.clientHeight)
    const inset = parseFloat(getComputedStyle(sc).paddingTop) || 0
    animateScrollTop(sc, revealTop(sc.scrollTop, top, el.scrollHeight + geometry.current.rowHeight, sc.clientHeight, REVEAL_PAD, max, inset))
  }, [])
  useLayoutEffect(() => {
    measurePanel()
    if (panelOpen) revealPanel()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelOpen, panelRow, liveState.armedId])

  useLayoutEffect(() => {
    const index = pendingFocus.current
    if (index === null) return
    const el = gridRef.current?.querySelector<HTMLElement>(`[data-grid-index="${index}"]`)
    if (el) {
      pendingFocus.current = null
      focusElement(el)
    }
  }, [range, items.length])

  // Reordenação/paginação pode desmontar o card focado: devolve o foco ao mesmo índice.
  useLayoutEffect(() => {
    const active = document.activeElement
    if (zone.current === 'grid' && (!active || active === document.body || !active.isConnected) && items.length > 0) {
      focusCard(Math.min(lastGridIndex.current ?? 0, items.length - 1))
    }
  }, [items, focusCard])

  const focusSelectedSide = useCallback(() => {
    const el = sideRef.current?.querySelector<HTMLElement>('[data-side-selected="true"]') ?? sideRef.current?.querySelector<HTMLElement>('[data-side-item]')
    if (el) focusElement(el)
  }, [])
  const sortChips = useCallback(() => Array.from(scrollerRef.current?.querySelectorAll<HTMLElement>('[data-sort-index]') ?? []), [])
  const focusSort = useCallback(() => {
    const chips = sortChips()
    const el = chips.find((c) => c.getAttribute('data-sort-selected') === 'true') ?? chips[0]
    if (el) focusElement(el)
  }, [sortChips])
  const enterGrid = useCallback(() => {
    const n = itemsLen.current
    if (n === 0) return
    focusCard(Math.min(lastGridIndex.current ?? 0, n - 1))
  }, [focusCard])

  const panelButtons = useCallback(() => Array.from(scrollerRef.current?.querySelectorAll<HTMLElement>('.iplex-live-panel.is-open [data-nav]') ?? []), [])
  /** Foca o primeiro botão do painel do canal (só quando aberto). */
  const focusPanel = useCallback(() => {
    const first = panelButtons()[0]
    if (!first) return false
    focusElement(first)
    return true
  }, [panelButtons])

  const focusHeader = useCallback(() => {
    const el = document.querySelector<HTMLElement>('[data-nav-fixed] .iplex-tab.is-active') ?? document.querySelector<HTMLElement>('[data-nav-fixed] [data-nav]')
    if (el) focusElement(el)
  }, [])

  useKeyHandler((key) => {
    if (!isArrow(key)) return false
    const el = document.activeElement
    if (!(el instanceof HTMLElement)) return false
    // Painel do canal (Ao Vivo): Assistir / Favoritar na horizontal; cima = ordenação; baixo = grid.
    if (el.closest('.iplex-live-panel')) {
      const buttons = panelButtons()
      const i = buttons.indexOf(el)
      if (key === 'ArrowLeft') {
        if (i > 0) focusElement(buttons[i - 1]!)
      } else if (key === 'ArrowRight') {
        if (i < buttons.length - 1) focusElement(buttons[i + 1]!)
      } else if (key === 'ArrowUp') {
        if (panelRowRef.current > 0) focusCard((panelRowRef.current - 1) * cols + (armedIndexRef.current % cols))
        else focusSort()
      }
      else if (key === 'ArrowDown') focusCard(armedIndexRef.current)
      else if (panelRowRef.current > 0) focusCard((panelRowRef.current - 1) * cols + (armedIndexRef.current % cols))
      else focusSort()
      return true
    }
    // Grid: ortogonal por índice; nos limites direito/inferior não faz nada (sem serpentina).
    const idx = el.getAttribute('data-grid-index')
    if (idx !== null && gridRef.current?.contains(el)) {
      const i = Number(idx)
      const n = itemsLen.current
      const col = i % cols
      if (key === 'ArrowLeft') {
        if (col > 0) focusCard(i - 1)
        else focusSelectedSide()
      } else if (key === 'ArrowRight') {
        if (col < cols - 1 && i + 1 < n) focusCard(i + 1)
      } else if (key === 'ArrowUp') {
        if (Math.floor(i / cols) === panelRowRef.current && focusPanel()) return true
        if (i - cols >= 0) focusCard(i - cols)
        else focusSort()
      } else if (i + cols < n) {
        if (Math.floor(i / cols) + 1 === panelRowRef.current && focusPanel()) return true
        focusCard(i + cols)
      }
      return true
    }
    // Menu lateral: lista linear; o primeiro item sobe ao menu principal.
    if (el.hasAttribute('data-side-item') && sideRef.current?.contains(el)) {
      const list = Array.from(sideRef.current.querySelectorAll<HTMLElement>('[data-side-item]'))
      const i = list.indexOf(el)
      if (key === 'ArrowUp') {
        if (i > 0) focusElement(list[i - 1]!)
        else focusHeader()
      } else if (key === 'ArrowDown') {
        if (i < list.length - 1) focusElement(list[i + 1]!)
      } else if (key === 'ArrowRight') {
        enterGrid()
      }
      return true
    }
    // Ordenação: linear; esquerda do primeiro volta ao menu lateral.
    if (el.hasAttribute('data-sort-index') && scrollerRef.current?.contains(el)) {
      const chips = sortChips()
      const i = chips.indexOf(el)
      if (key === 'ArrowLeft') {
        if (i > 0) focusElement(chips[i - 1]!)
        else focusSelectedSide()
      } else if (key === 'ArrowRight') {
        if (i < chips.length - 1) focusElement(chips[i + 1]!)
      } else if (key === 'ArrowDown') {
        if (panelRowRef.current === 0 && focusPanel()) return true
        if (itemsLen.current > 0) focusCard(0)
      } else {
        focusHeader()
      }
      return true
    }
    if (key === 'ArrowDown' && el.closest('[data-nav-fixed]')) {
      focusSelectedSide()
      return true
    }
    return false
  })

  // Menu lateral: o item focado fica centralizado, dentro dos limites reais da rolagem.
  const sideSettled = useRef(false)
  const onSideFocus = (event: React.FocusEvent<HTMLElement>) => {
    zone.current = 'side'
    const side = sideRef.current
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-side-item]')
    if (!side || !target) return
    const inset = parseFloat(getComputedStyle(side).paddingTop) || 0
    animateScrollTop(side, centeredTop(target.offsetTop, target.offsetHeight, side.clientHeight, side.scrollHeight - side.clientHeight, inset), !sideSettled.current)
    sideSettled.current = true
  }

  const onContentFocus = (event: React.FocusEvent<HTMLElement>) => {
    const target = event.target as HTMLElement
    const idx = target.getAttribute('data-grid-index')
    if (idx !== null) {
      zone.current = 'grid'
      lastGridIndex.current = Number(idx)
      revealRow(Math.floor(Number(idx) / cols))
    } else if (target.closest('.iplex-live-panel')) {
      zone.current = 'grid'
      revealPanel()
    } else if (target.hasAttribute('data-sort-index')) {
      zone.current = 'sort'
      if (scrollerRef.current) animateScrollTop(scrollerRef.current, 0)
    }
  }

  // Diagnóstico (só com ?diag=1 na TV): o que a tela Adulto recebeu do catálogo.
  useEffect(() => {
    if (!adult) return
    diag('adult:screen', `sidebar=${sidebar.map((s) => s.label).join('|')} itens=${allItems.length} grupos=${groups.size} selecionado=${selected} warm=${warm} personal=${personal} habilitado=${session.catalog.adultEnabled()} adultItems=${session.catalog.adultItems().length}`)
  }, [adult, sidebar, allItems.length, groups.size, selected, warm, personal, session.catalog])

  const label = scope ? COLLECTION_TITLES[selected as PersonalCollection] : selected.startsWith('cat:') ? (sidebar.find((s) => s.id === selected)?.label ?? groups.get(selected.slice(4))?.name ?? title) : COLLECTION_TITLES[selected as keyof typeof COLLECTION_TITLES]
  const heading = label
  const kindLabel = scope ? 'itens' : adult ? 'conteúdo adulto' : kinds.length === 1 ? (kinds[0] === 'movie' ? 'filmes' : kinds[0] === 'channel' ? 'canais' : 'séries') : 'filmes e séries'
  const sourceStates = <SourceStates spacesError={spacesError} noSources={noSources} noKind={noKind} error={error} kindLabel={kindLabel} onRetry={reload} />
  const blocked = !!(spacesError || noSources || noKind || error)
  // Sem itens ainda, mas a fonte pode entregar (primeira renderização, página em andamento, mais páginas)
  // ou a biblioteca pessoal ainda não carregou: 15 skeletons em vez de "vazio". Sem resposta pendente → estado vazio.
  const awaiting = fromCatalog ? loading || hasMore : personal && !libraryLoaded
  const showSkeleton = !blocked && items.length === 0 && awaiting

  const rowSlices = useMemo(() => Array.from({ length: Math.ceil(items.length / cols) }, (_, r) => items.slice(r * cols, r * cols + cols)), [items, cols])
  const rows: Array<{ index: number; items: CatalogItem[] }> = []
  if (!blocked) {
    for (let r = range[0]; r <= Math.min(range[1], totalRows - 1); r += 1) {
      rows.push({ index: r, items: rowSlices[r]! })
    }
  }
  const selectedSideId = sidebar.some((s) => s.id === selected) ? selected : null

  const mainClass = 'iplex-page iplex-page--catalog'
  return (
    <>
    <main className={mainClass} aria-label={title} data-nav-managed="" style={live ? ({ '--iplex-cols': cols } as React.CSSProperties) : undefined}>
      <nav className="iplex-catalog__side" ref={sideRef} aria-label={`Categorias de ${kindLabel}`} onFocus={onSideFocus}>
        {sidebar.map((entry, i) => {
          const isSelected = entry.id === selectedSideId
          return (
            <button
              key={entry.id}
              type="button"
              className={`iplex-tab iplex-focusable iplex-side__item${isSelected ? ' is-active' : ''}`}
              aria-current={isSelected ? 'true' : undefined}
              data-nav=""
              data-nav-id={`side-${entry.id}`}
              data-nav-group="catalog-side"
              data-side-item=""
              data-side-selected={isSelected ? 'true' : 'false'}
              {...(isSelected || (!selectedSideId && i === 0) ? { 'data-nav-autofocus': '' } : {})}
              onClick={() => setChosen(entry.id)}
            >
              {entry.label}
            </button>
          )
        })}
      </nav>
      <div className="iplex-catalog__content" ref={scrollerRef} onScroll={onScroll} onFocus={onContentFocus}>
        <div className="iplex-catalog__head">
          <IplexText variant="page-title" as="h1" className="iplex-catalog__title">
            {heading}
          </IplexText>
          {!blocked && items.length > 0 && (
            <IplexText variant="page-title" as="span" className="iplex-catalog__count" aria-label={`${items.length} itens`}>
              {formatCount(items.length)}
            </IplexText>
          )}
        </div>
        <div className="iplex-catalog__sort" role="group" aria-label="Ordenar">
          {sortOptions.map((option, i) => {
            const isSelected = option.id === effectiveSort
            return (
              <button
                key={option.id}
                type="button"
                className={`iplex-chip iplex-focusable${isSelected ? ' is-active' : ''}`}
                aria-pressed={isSelected}
                data-nav=""
                data-nav-id={`sort-${option.id}`}
                data-nav-group="catalog-sort"
                data-sort-index={i}
                data-sort-selected={isSelected ? 'true' : 'false'}
                onClick={() => setSort(option.id)}
              >
                {option.label}
              </button>
            )
          })}
        </div>
        {sourceStates}
        {showSkeleton && <SkeletonGrid count={live ? SKELETONS_LIVE : SKELETONS} cols={cols} shape={live ? 'square' : 'poster'} />}
        {!blocked && !showSkeleton && items.length === 0 && <EmptyState title="Nada por aqui ainda" description={emptyText(selected, kindLabel)} />}
        {!blocked && items.length > 0 && (
          <div className="iplex-catalog__grid" ref={gridRef} role="list" aria-label={heading}>
            <div style={{ height: range[0] * rowHeight + (panelOpen && panelRow < range[0] ? panelH : 0) }} aria-hidden="true" />
            {rows.map((row) => (
              <Fragment key={row.index}>
                {live && panelMounted && row.index === panelRow && (
                  <LiveChannelPanel
                    panelRef={panelRef}
                    channel={liveState.armed}
                    open={panelOpen}
                    favorite={liveState.favorite}
                    canFavorite={liveState.canFavorite}
                    canWatch={liveState.canPlay}
                    busy={liveState.busy}
                    onWatch={liveState.watch}
                    onToggleFavorite={() => void liveState.toggleFavorite()}
                    onLayout={measurePanel}
                  />
                )}
                <GridRow rowIndex={row.index} items={row.items} cols={cols} selectedId={live ? liveState.armedId : null} onOpen={open} />
              </Fragment>
            ))}
            <div style={{ height: Math.max(0, totalRows - 1 - range[1]) * rowHeight + (panelOpen && panelRow > range[1] ? panelH : 0) }} aria-hidden="true" />
          </div>
        )}
      </div>
    </main>
    </>
  )
}

/** 15103 → "15.103" (sem depender de Intl na TV). */
const formatCount = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.')

function emptyText(selected: CollectionId, kindLabel: string): string {
  if (selected === 'continue') return 'O que você começar a assistir aparece aqui.'
  if (selected === 'favorites') return 'Use “Favoritar” nos detalhes para guardar títulos aqui.'
  if (selected === 'wishlist') return 'Use “Adicionar à lista de desejo” nos detalhes para guardar títulos aqui.'
  if (selected === 'releases') return 'Os lançamentos do catálogo aparecem aqui.'
  if (selected === 'watched') return 'Os títulos que você terminar aparecem aqui.'
  return `Não há ${kindLabel} nesta categoria para este perfil.`
}
