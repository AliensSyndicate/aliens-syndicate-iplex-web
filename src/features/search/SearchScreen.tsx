/**
 * Busca: lado esquerdo fixo (campo + teclado na TV) e, à direita, os resultados em grids de 5 por
 * linha, na ordem Ao Vivo, Filmes, Séries e Atores, cada um com o total ao lado do título (como o Catálogo).
 * Canais, filmes e séries vêm do catálogo IPTV já carregado no aparelho (conteúdo adulto nunca aparece);
 * atores vêm do TMDB. A busca começa no terceiro caractere. Com o campo vazio, mostra os Recentes: os itens
 * que o perfil abriu (não o texto digitado).
 *
 * Foco e rolagem seguem o Catálogo: um só dono ([data-nav-managed]), navegação ortogonal por índice,
 * primeira linha rola ao topo, mínimo no meio.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { usePlatform } from '../../app/providers/PlatformProvider'
import { useReadySession } from '../../app/providers/SessionProvider'
import { contentPath, PATHS } from '../../app/routes/paths'
import { ChannelCard } from '../../components/catalog/ChannelCard'
import { MetadataTile } from '../../components/catalog/MetadataTile'
import { PosterCard } from '../../components/catalog/PosterCard'
import { EmptyState } from '../../components/feedback/EmptyState'
import { ErrorState } from '../../components/feedback/ErrorState'
import { IplexText } from '../../components/ui/IplexText'
import { TIMING } from '../../config/features'
import { useCatalog } from '../../hooks/useCatalog'
import { useInitialFocus, useKeyHandler } from '../../navigation/FocusProvider'
import { animateScrollTop, revealTop } from '../../navigation/scrollMath'
import { focusElement } from '../../navigation/spatial'
import { isArrow } from '../../platform/keys'
import type { CatalogItem } from '../../services/api/types'
import type { TmdbPersonResult } from '../../services/tmdb/tmdbClient'
import { useBackend } from '../../app/providers/BackendProvider'
import { isKids } from '../profiles/profileRules'
import { isAdultItem } from '../../services/catalog/adult'
import { searchItems } from '../../services/catalog/search'
import { VirtualKeyboard } from './VirtualKeyboard'
import { addRecent, readRecents, recentKey, type RecentEntry } from './recentSearches'

const COLS = 5
/** Itens mostrados por categoria (o total real aparece no título). */
const PER_SECTION = 60
const PAD = 24

type SectionId = 'recents' | 'channels' | 'movies' | 'series' | 'people'
/** Um card do grid: canal (quadrado), pôster de filme/série ou ator. */
type Cell = { key: string; kind: 'channel' | 'poster' | 'person'; item?: CatalogItem; person?: { personId: number; name: string; photo: string | null; knownFor: string; scope: { sourceId: string; itemId: string; title: string } } }
interface Section {
  id: SectionId
  title: string
  cells: Cell[]
  total: number
}

const DEPARTMENT: Record<string, string> = { Acting: 'Atuação', Directing: 'Direção', Writing: 'Roteiro', Production: 'Produção' }
const toCells = (items: CatalogItem[], kind: Cell['kind']): Cell[] => items.map((item) => ({ key: item.id, kind, item }))

export default function SearchScreen() {
  const platform = usePlatform()
  const navigate = useNavigate()
  const location = useLocation()
  const session = useReadySession()
  const { catalog, spaces } = session
  // Assinam o catálogo: garantem que os três tipos estejam carregados e refazem a busca quando chegarem.
  const channelCatalog = useCatalog('channel')
  const movieCatalog = useCatalog('movie')
  const seriesCatalog = useCatalog('series')
  const itemsByKind = useMemo(() => ({ channel: channelCatalog.items, movie: movieCatalog.items, series: seriesCatalog.items }), [channelCatalog.items, movieCatalog.items, seriesCatalog.items])
  const { familyId } = session.identity
  const profileId = session.profile.id
  const [term, setTerm] = useState(() => new URLSearchParams(location.search).get('q') ?? '')
  const [debounced, setDebounced] = useState(term)
  const { tmdb } = useBackend()
  const [recents, setRecents] = useState<RecentEntry[]>(() => readRecents(familyId, profileId))
  const [people, setPeople] = useState<{ query: string; list: TmdbPersonResult[] } | null>(null)
  const kids = isKids(session.profile)
  const inputRef = useRef<HTMLInputElement>(null)
  const sideRef = useRef<HTMLElement>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)

  // Mantém o termo na URL (voltar dos detalhes preserva a busca) e espera a pausa da digitação.
  useEffect(() => {
    const id = setTimeout(() => {
      setDebounced(term)
      navigate({ search: term ? `?q=${encodeURIComponent(term)}` : '' }, { replace: true })
    }, TIMING.searchDebounceMs)
    return () => clearTimeout(id)
  }, [term, navigate])

  const query = debounced.trim()
  const searching = query.length >= TIMING.searchMinLength

  /** Qualquer título autorizado e não adulto: prova o acesso do dispositivo na busca de atores. */
  const scopeItem = useMemo(() => {
    const pick = (kind: 'movie' | 'series') => itemsByKind[kind].find((i) => !isAdultItem(i))
    return pick('movie') ?? pick('series') ?? null
  }, [itemsByKind])

  // Atores (TMDB): nunca para perfil infantil; falha de rede só some com a seção.
  useEffect(() => {
    if (!searching || kids || !scopeItem) return
    let alive = true
    tmdb.searchPeople(query, scopeItem).then(
      (list) => alive && setPeople({ query, list }),
      () => alive && setPeople({ query, list: [] }),
    )
    return () => {
      alive = false
    }
  }, [searching, query, kids, scopeItem, tmdb])
  const peopleReady = !searching || kids || !scopeItem || people?.query === query

  const sections = useMemo<Section[]>(() => {
    if (!searching) {
      // Recentes: o item aberto, como estava no catálogo (itens que saíram da lista somem).
      const cells: Cell[] = []
      for (const entry of recents) {
        if (entry.type === 'item') {
          const item = catalog.findLoaded(entry.itemId)
          if (item && !isAdultItem(item)) cells.push({ key: recentKey(entry), kind: item.kind === 'channel' ? 'channel' : 'poster', item })
        } else cells.push({ key: recentKey(entry), kind: 'person', person: entry })
      }
      return cells.length ? [{ id: 'recents', title: 'Recentes', cells, total: cells.length }] : []
    }
    const build = (id: Section['id'], title: string, kind: CatalogItem['kind'], cell: Cell['kind']): Section => {
      const r = searchItems(itemsByKind[kind as 'channel' | 'movie' | 'series'], query, PER_SECTION)
      return { id, title, cells: toCells(r.items, cell), total: r.total }
    }
    const list: Section[] = [build('channels', 'Ao Vivo', 'channel', 'channel'), build('movies', 'Filmes', 'movie', 'poster'), build('series', 'Séries', 'series', 'poster')]
    // "Atores": só quem o TMDB classifica como ator (produtoras e equipe técnica ficam de fora).
    const actors = people?.query === query ? people.list.filter((p) => p.knownFor === 'Acting') : []
    if (!kids && scopeItem && actors.length > 0) {
      const cells: Cell[] = actors.map((p) => ({ key: `p:${p.tmdbId}`, kind: 'person', person: { personId: p.tmdbId, name: p.name, photo: p.photo, knownFor: p.knownFor, scope: { sourceId: scopeItem.sourceId, itemId: scopeItem.id, title: scopeItem.title } } }))
      list.push({ id: 'people', title: 'Atores', cells, total: cells.length })
    }
    return list.filter((sec) => sec.total > 0)
  }, [searching, query, catalog, itemsByKind, recents, people, kids, scopeItem])

  const openItem = useCallback(
    (item: CatalogItem) => {
      if (!isAdultItem(item)) setRecents(addRecent(familyId, profileId, { type: 'item', kind: item.kind, sourceId: item.sourceId, itemId: item.id }))
      navigate(contentPath(item))
    },
    [navigate, familyId, profileId],
  )
  const openPerson = useCallback(
    (p: NonNullable<Cell['person']>) => {
      setRecents(addRecent(familyId, profileId, { type: 'person', personId: p.personId, name: p.name, photo: p.photo, knownFor: p.knownFor, scope: p.scope }))
      navigate(PATHS.person(p.personId, p.scope, 'search'))
    },
    [navigate, familyId, profileId],
  )

  useInitialFocus(location.pathname, true)

  // ---- foco e rolagem (como o Catálogo) ----------------------------------------------------
  const focusHeader = () => {
    const el = document.querySelector<HTMLElement>('[data-nav-fixed] .iplex-tab.is-active') ?? document.querySelector<HTMLElement>('[data-nav-fixed] [data-nav]')
    if (el) focusElement(el)
  }
  const focusInput = () => {
    if (inputRef.current) focusElement(inputRef.current)
  }
  const cells = (section: string) => Array.from(scrollerRef.current?.querySelectorAll<HTMLElement>(`[data-sr-section="${section}"]`) ?? [])
  const focusCell = (section: string, index: number) => {
    const cell = cells(section)[index]
    const target = cell?.querySelector<HTMLElement>('[data-nav]')
    if (target) focusElement(target)
    return !!target
  }
  const firstResultTarget = () => scrollerRef.current?.querySelector<HTMLElement>('[data-sr-cell] [data-nav]') ?? null

  useKeyHandler((key) => {
    if (!isArrow(key)) return false
    const el = document.activeElement
    if (!(el instanceof HTMLElement)) return false

    // Resultados: ortogonal por índice, contínuo entre categorias, sem serpentina.
    const cell = el.closest<HTMLElement>('[data-sr-cell]')
    if (cell && scrollerRef.current?.contains(cell)) {
      const section = cell.dataset.srSection!
      const i = Number(cell.dataset.srIndex)
      const n = cells(section).length
      const col = i % COLS
      const order = sections.map((s) => s.id)
      const at = order.indexOf(section as Section['id'])
      if (key === 'ArrowLeft') {
        if (col > 0) focusCell(section, i - 1)
        else focusInput()
      } else if (key === 'ArrowRight') {
        if (col < COLS - 1 && i + 1 < n) focusCell(section, i + 1)
      } else if (key === 'ArrowUp') {
        if (i - COLS >= 0) focusCell(section, i - COLS)
        else if (at > 0) {
          const prev = order[at - 1]!
          const m = cells(prev).length
          const lastRowStart = Math.floor((m - 1) / COLS) * COLS
          focusCell(prev, Math.min(m - 1, lastRowStart + col))
        } else focusHeader()
      } else if (i + COLS < n) {
        focusCell(section, Math.min(n - 1, i + COLS))
      } else if (Math.floor(i / COLS) < Math.floor((n - 1) / COLS)) {
        focusCell(section, n - 1)
      } else if (at < order.length - 1) {
        const next = order[at + 1]!
        focusCell(next, Math.min(cells(next).length - 1, col))
      }
      return true
    }
    // Lado esquerdo (campo e teclado): Direita no fim da linha vai aos resultados; Cima no campo vai ao menu.
    if (sideRef.current?.contains(el)) {
      if (el === inputRef.current) {
        if (key === 'ArrowUp') focusHeader()
        else if (key === 'ArrowRight') {
          const target = firstResultTarget()
          if (target) focusElement(target)
          return true
        } else if (key === 'ArrowDown') {
          if (!platform.isTv) return true
          return false
        } else return true
        return true
      }
      if (key === 'ArrowRight' && !el.nextElementSibling) {
        const target = firstResultTarget()
        if (target) focusElement(target)
        return true
      }
      return false
    }
    if (key === 'ArrowDown' && el.closest('[data-nav-fixed]')) {
      focusInput()
      return true
    }
    return false
  })

  /** Rolagem do conteúdo: topo real na primeira linha, mínimo no meio (a primeira linha de cada categoria mostra o título). */
  const onContentFocus = (event: React.FocusEvent<HTMLElement>) => {
    const sc = scrollerRef.current
    const target = event.target as HTMLElement
    if (!sc) return
    const cell = target.closest<HTMLElement>('[data-sr-cell]')
    if (!cell) return
    const max = Math.max(0, sc.scrollHeight - sc.clientHeight)
    const inset = parseFloat(getComputedStyle(sc).paddingTop) || 0
    const scRect = sc.getBoundingClientRect()
    const first = Number(cell.dataset.srIndex) < COLS
    const box = (first ? (cell.closest('[data-sr-block]')?.querySelector('[data-sr-head]') ?? cell) : cell).getBoundingClientRect()
    const bottom = cell.getBoundingClientRect().bottom
    const top = box.top - scRect.top + sc.scrollTop
    const isTop = first && sections[0]?.id === cell.dataset.srSection
    animateScrollTop(sc, isTop ? 0 : revealTop(sc.scrollTop, top, bottom - box.top, sc.clientHeight, PAD, max, inset))
  }

  const noMatches = searching && sections.length === 0 && peopleReady

  return (
    <main className="iplex-page iplex-page--catalog iplex-page--search" aria-label="Busca" data-nav-managed="">
      <aside className="iplex-catalog__side iplex-search__side" ref={sideRef} aria-label="Campo de busca">
        <IplexText variant="page-title" as="h1" className="iplex-search__title">
          Busca
        </IplexText>
        <label className="iplex-visually-hidden" htmlFor="iplex-search-input">
          Buscar por título ou canal
        </label>
        <input
          id="iplex-search-input"
          ref={inputRef}
          type="search"
          className="iplex-search__input iplex-focusable"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Ao Vivo, filmes ou séries"
          autoComplete="off"
          spellCheck={false}
          readOnly={platform.isTv}
          data-nav=""
          data-nav-id="search-input"
          {...(platform.isTv ? {} : { 'data-nav-autofocus': '' })}
        />
        {platform.isTv && (
          <VirtualKeyboard
            onKey={(k) => setTerm((t) => (t + k).slice(0, 100))}
            onSpace={() => setTerm((t) => (t.endsWith(' ') || !t ? t : `${t} `))}
            onDelete={() => setTerm((t) => t.slice(0, -1))}
            onClear={() => setTerm('')}
          />
        )}
      </aside>
      <div className="iplex-catalog__content iplex-search__content" ref={scrollerRef} onFocus={onContentFocus} aria-live="polite">
        {spaces.length === 0 && <ErrorState inline kind="iptv-not-configured" />}
        {spaces.length > 0 && !searching && (
          <>
            {term.trim() !== '' && <IplexText variant="description">Digite ao menos {TIMING.searchMinLength} letras para buscar.</IplexText>}
            {sections.length === 0 && term.trim() === '' && (
              <section data-sr-block="hint">
                <div className="iplex-catalog__head" data-sr-head="">
                  <IplexText variant="page-title" as="h2" className="iplex-catalog__title">
                    Buscar
                  </IplexText>
                </div>
                <IplexText variant="description">Digite ao menos {TIMING.searchMinLength} letras para buscar. O que você abrir fica em Recentes.</IplexText>
              </section>
            )}
          </>
        )}
        {noMatches && <EmptyState title="Nenhum resultado" description={`Nada encontrado para “${query}” nas fontes deste perfil.`} />}
        {sections.map((section) => (
          <section key={section.id} className="iplex-search__section" data-sr-block={section.id} aria-label={section.title}>
            <div className="iplex-catalog__head" data-sr-head="">
              <IplexText variant="page-title" as="h2" className="iplex-catalog__title">
                {section.title}
              </IplexText>
              <IplexText variant="page-title" as="span" className="iplex-catalog__count" aria-label={`${section.total} resultados`}>
                {String(section.total).replace(/\B(?=(\d{3})+(?!\d))/g, '.')}
              </IplexText>
            </div>
            <div role="list" aria-label={section.title}>
              {Array.from({ length: Math.ceil(section.cells.length / COLS) }, (_, r) => (
                <div className="iplex-search__row" key={r}>
                  {section.cells.slice(r * COLS, r * COLS + COLS).map((cell, c) => {
                    const index = r * COLS + c
                    return (
                      <div className="iplex-search__cell" key={cell.key} data-sr-cell="" data-sr-section={section.id} data-sr-index={index}>
                        {cell.kind === 'channel' && cell.item && <ChannelCard item={cell.item} navId={`sr-${section.id}-${cell.key}`} navGroup={`sr-${section.id}`} onSelect={openItem} gridIndex={index} />}
                        {cell.kind === 'poster' && cell.item && <PosterCard item={cell.item} navId={`sr-${section.id}-${cell.key}`} navGroup={`sr-${section.id}`} onSelect={openItem} posterOnly />}
                        {cell.kind === 'person' && cell.person && (
                          <MetadataTile
                            image={cell.person.photo}
                            label={cell.person.name}
                            sublabel={DEPARTMENT[cell.person.knownFor] ?? (cell.person.knownFor || undefined)}
                            fallback={cell.person.name}
                            navId={`sr-${section.id}-${cell.key}`}
                            navGroup={`sr-${section.id}`}
                            onSelect={() => openPerson(cell.person!)}
                          />
                        )}
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </main>
  )
}
