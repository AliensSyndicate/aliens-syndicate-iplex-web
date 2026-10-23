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
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useReadySession } from '../../app/providers/SessionProvider'
import { PATHS } from '../../app/routes/paths'
import { PosterCard } from '../../components/catalog/PosterCard'
import { EmptyState } from '../../components/feedback/EmptyState'
import { SkeletonGrid } from '../../components/feedback/LoadingState'
import { SourceStates } from '../../components/feedback/SourceStates'
import { IplexText } from '../../components/ui/IplexText'
import { useCatalog } from '../../hooks/useCatalog'
import { useLibrary } from '../../hooks/useLibrary'
import { useInitialFocus, useKeyHandler } from '../../navigation/FocusProvider'
import { animateScrollTop, cancelScroll, centeredTop, revealTop } from '../../navigation/scrollMath'
import { focusElement } from '../../navigation/spatial'
import { isArrow } from '../../platform/keys'
import type { CatalogItem, ContentKind } from '../../services/api/types'
import type { IndexedItem } from '../../services/library/libraryStore'
import { parseEpisodeContentId } from '../../services/catalog/normalize'
import { hasPersonalLibrary, isAdult } from '../profiles/profileRules'
import { COLLECTION_TITLES, buildSidebar, isAdultCategory, itemFromIndexed, sortItems, sortOptionsFor, type CollectionId, type SortId } from './collections'

const COLS = 5
const SKELETONS = 15
const OVERSCAN = 3
const DEFAULT_ROW_HEIGHT = 340
const MIN_FILL = 24
const REVEAL_PAD = 24

/** Estado de navegação por rota: ao voltar dos detalhes a tela reaparece como estava. */
const viewMemory = new Map<string, { selected: CollectionId; sort: SortId; scrollTop: number }>()

const GridCard = memo(function GridCard({ item, index, onOpen }: { item: CatalogItem; index: number; onOpen: (item: CatalogItem) => void }) {
  return <PosterCard item={item} navId={`card-${item.id}`} navGroup="catalog-grid" onSelect={onOpen} posterOnly gridIndex={index} />
})

/** Linha do grid: memoizada para que só as linhas que entram/saem da janela sejam montadas. */
const GridRow = memo(function GridRow({ items, rowIndex, onOpen }: { items: CatalogItem[]; rowIndex: number; onOpen: (item: CatalogItem) => void }) {
  return (
    <div className="iplex-catalog__row">
      {items.map((item, c) => (
        <GridCard key={item.id} item={item} index={rowIndex * COLS + c} onOpen={onOpen} />
      ))}
    </div>
  )
})

export function CatalogScreen({ kinds, title, initial }: { kinds: ContentKind[]; title: string; initial: CollectionId }) {
  const navigate = useNavigate()
  const location = useLocation()
  const session = useReadySession()
  const routeKey = `${location.pathname}${location.search}`
  const wantMovies = kinds.includes('movie')
  const wantSeries = kinds.includes('series')
  const movies = useCatalog('movie', wantMovies)
  const series = useCatalog('series', wantSeries)
  const { library, store, loaded: libraryLoaded } = useLibrary()
  const personal = hasPersonalLibrary(session.profile)
  const allowAdult = isAdult(session.profile)
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

  const active = useMemo(() => [wantMovies ? movies : null, wantSeries ? series : null].filter((c): c is NonNullable<typeof c> => !!c), [wantMovies, wantSeries, movies, series])
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
  const allItems = useMemo(() => (warm ? active.flatMap((c) => c.items) : []), [active, warm])


  const progressMeta = useMemo(() => {
    const byItem = new Map<string, IndexedItem>()
    if (!personal) return byItem
    for (const entry of library.progress) {
      const meta = store.indexed(entry.contentId)
      if (!meta || !kinds.includes(meta.kind)) continue
      if (meta.kind === 'series' && !parseEpisodeContentId(entry.contentId)) continue
      if (entry.duration > 0 && entry.position / entry.duration >= 0.95) continue
      if (!byItem.has(meta.itemId)) byItem.set(meta.itemId, meta)
    }
    return byItem
  }, [library.progress, store, kinds, personal])

  const libraryLists = useMemo(() => {
    const fromLibrary = (ids: Array<{ contentId: string }>) =>
      personal ? ids.map((e) => store.indexed(e.contentId)).filter((m): m is IndexedItem => !!m && kinds.includes(m.kind)).map(itemFromIndexed) : []
    return { favorites: fromLibrary(library.favorites), watched: fromLibrary(library.watched) }
  }, [library.favorites, library.watched, store, kinds, personal])

  const sidebar = useMemo(
    () =>
      buildSidebar({
        personal,
        allowAdult,
        categories: Array.from(groups.values()).filter((g) => g.items.length > 0).map((g) => ({ key: g.key, name: g.name })),
        has: { continue: progressMeta.size > 0, favorites: libraryLists.favorites.length > 0, all: allItems.length > 0 },
      }),
    [personal, allowAdult, groups, progressMeta, libraryLists.favorites, allItems.length],
  )

  // Primeira coleção do menu com conteúdo real (nunca prende o foco em categoria vazia).
  const firstWithContent = useMemo<CollectionId>(() => {
    for (const entry of sidebar) {
      if (entry.id === 'continue' && progressMeta.size > 0) return entry.id
      if (entry.id === 'favorites' && libraryLists.favorites.length > 0) return entry.id
      if (entry.id === 'all' && allItems.length > 0) return entry.id
      if (entry.id.startsWith('cat:') && (groups.get(entry.id.slice(4))?.items.length ?? 0) > 0) return entry.id
    }
    return sidebar.some((s) => s.id === 'all') ? 'all' : (sidebar[0]?.id ?? initial)
  }, [sidebar, progressMeta, libraryLists.favorites, allItems.length, groups, initial])

  const ready = (!personal || libraryLoaded) && (!loading || allItems.length > 0 || !!(spacesError || noSources || noKind || error))
  useEffect(() => {
    if (chosen === null && ready) setChosen(firstWithContent)
  }, [chosen, ready, firstWithContent])

  // Sempre há uma coleção selecionada: a confirmada (se ainda existir no menu) ou a primeira com conteúdo.
  const selected: CollectionId = chosen && sidebar.some((s) => s.id === chosen) ? chosen : firstWithContent

  const base = useMemo<CatalogItem[]>(() => {
    if (selected === 'continue') return Array.from(progressMeta.values()).map(itemFromIndexed)
    if (selected === 'favorites') return libraryLists.favorites
    if (selected === 'watched') return libraryLists.watched
    if (selected === 'all') return allItems
    const group = groups.get(selected.slice(4))
    if (!group || (isAdultCategory(group.name) && !allowAdult)) return []
    return group.items
  }, [selected, progressMeta, libraryLists, allItems, groups, allowAdult])

  const sortOptions = useMemo(() => sortOptionsFor(base), [base])
  const effectiveSort: SortId = sortOptions.some((o) => o.id === sort) ? sort : 'az'
  const items = useMemo(() => sortItems(base, effectiveSort), [base, effectiveSort])

  const open = useCallback(
    (item: CatalogItem) => {
      const meta = selected === 'continue' ? progressMeta.get(item.id) : undefined
      if (meta) navigate(PATHS.watch({ sourceId: meta.sourceId, itemId: meta.itemId, kind: meta.kind, title: meta.title, episodeId: meta.episodeId, resume: true }))
      else navigate(PATHS.details(item.sourceId, item.id, item.title))
    },
    [navigate, selected, progressMeta],
  )

  // ---- janelamento do grid ------------------------------------------------
  const sideRef = useRef<HTMLElement>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const [rowHeight, setRowHeight] = useState(DEFAULT_ROW_HEIGHT)
  const [range, setRange] = useState<[number, number]>([0, 6])
  const totalRows = Math.ceil(items.length / COLS)
  const geometry = useRef({ rowHeight: DEFAULT_ROW_HEIGHT, rowGap: 0, totalRows, hasMore })
  const itemsLen = useRef(items.length)
  useEffect(() => {
    geometry.current.totalRows = totalRows
    geometry.current.hasMore = hasMore
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
    const first = Math.max(0, Math.floor(rel / rh) - OVERSCAN)
    const last = Math.max(first, Math.min(rows - 1, Math.ceil((rel + viewH) / rh) + OVERSCAN))
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
  const fromCatalog = selected === 'all' || selected.startsWith('cat:')
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
      row === 0 ? 0 : row >= rows - 1 && !more ? max : revealTop(sc.scrollTop, grid.offsetTop + row * rh, rh - rowGap, sc.clientHeight, REVEAL_PAD, max, inset)
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
      const top = grid.offsetTop + Math.floor(index / COLS) * rh
      sc.scrollTop = centeredTop(top, rh - rowGap, sc.clientHeight, sc.scrollHeight - sc.clientHeight, parseFloat(getComputedStyle(sc).paddingTop) || 0)
      recompute()
      return true
    },
    [recompute],
  )

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

  const focusHeader = useCallback(() => {
    const el = document.querySelector<HTMLElement>('[data-nav-fixed] .iplex-tab.is-active') ?? document.querySelector<HTMLElement>('[data-nav-fixed] [data-nav]')
    if (el) focusElement(el)
  }, [])

  useKeyHandler((key) => {
    if (!isArrow(key)) return false
    const el = document.activeElement
    if (!(el instanceof HTMLElement)) return false
    // Grid: ortogonal por índice; nos limites direito/inferior não faz nada (sem serpentina).
    const idx = el.getAttribute('data-grid-index')
    if (idx !== null && gridRef.current?.contains(el)) {
      const i = Number(idx)
      const n = itemsLen.current
      const col = i % COLS
      if (key === 'ArrowLeft') {
        if (col > 0) focusCard(i - 1)
        else focusSelectedSide()
      } else if (key === 'ArrowRight') {
        if (col < COLS - 1 && i + 1 < n) focusCard(i + 1)
      } else if (key === 'ArrowUp') {
        if (i - COLS >= 0) focusCard(i - COLS)
        else focusSort()
      } else if (i + COLS < n) {
        focusCard(i + COLS)
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
      revealRow(Math.floor(Number(idx) / COLS))
    } else if (target.hasAttribute('data-sort-index')) {
      zone.current = 'sort'
      if (scrollerRef.current) animateScrollTop(scrollerRef.current, 0)
    }
  }

  const label = selected.startsWith('cat:') ? (sidebar.find((s) => s.id === selected)?.label ?? groups.get(selected.slice(4))?.name ?? title) : COLLECTION_TITLES[selected as keyof typeof COLLECTION_TITLES]
  const heading = label
  const kindLabel = kinds.length === 1 ? (kinds[0] === 'movie' ? 'filmes' : 'séries') : 'filmes e séries'
  const sourceStates = <SourceStates spacesError={spacesError} noSources={noSources} noKind={noKind} error={error} kindLabel={kindLabel} onRetry={reload} />
  const blocked = !!(spacesError || noSources || noKind || error)
  // Sem itens ainda, mas a fonte pode entregar (primeira renderização, página em andamento, mais páginas)
  // ou a biblioteca pessoal ainda não carregou: 15 skeletons em vez de "vazio". Sem resposta pendente → estado vazio.
  const awaiting = fromCatalog ? loading || hasMore : personal && !libraryLoaded
  const showSkeleton = !blocked && items.length === 0 && awaiting

  const rowSlices = useMemo(() => Array.from({ length: Math.ceil(items.length / COLS) }, (_, r) => items.slice(r * COLS, r * COLS + COLS)), [items])
  const rows: Array<{ index: number; items: CatalogItem[] }> = []
  if (!blocked) {
    for (let r = range[0]; r <= Math.min(range[1], totalRows - 1); r += 1) {
      rows.push({ index: r, items: rowSlices[r]! })
    }
  }
  const selectedSideId = sidebar.some((s) => s.id === selected) ? selected : null

  return (
    <main className="iplex-page iplex-page--catalog" aria-label={title} data-nav-managed="">
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
        {showSkeleton && <SkeletonGrid count={SKELETONS} cols={COLS} />}
        {!blocked && !showSkeleton && items.length === 0 && <EmptyState title="Nada por aqui ainda" description={emptyText(selected, kindLabel)} />}
        {!blocked && items.length > 0 && (
          <div className="iplex-catalog__grid" ref={gridRef} role="list" aria-label={heading}>
            <div style={{ height: range[0] * rowHeight }} aria-hidden="true" />
            {rows.map((row) => (
              <GridRow key={row.index} rowIndex={row.index} items={row.items} onOpen={open} />
            ))}
            <div style={{ height: Math.max(0, totalRows - 1 - range[1]) * rowHeight }} aria-hidden="true" />
          </div>
        )}
      </div>
    </main>
  )
}

/** 15103 → "15.103" (sem depender de Intl na TV). */
const formatCount = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.')

function emptyText(selected: CollectionId, kindLabel: string): string {
  if (selected === 'continue') return 'O que você começar a assistir aparece aqui.'
  if (selected === 'favorites') return 'Use “Adicionar à lista” nos detalhes para guardar títulos aqui.'
  if (selected === 'watched') return 'Os títulos que você terminar aparecem aqui.'
  return `Não há ${kindLabel} nesta categoria para este perfil.`
}
