import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useReadySession } from '../../app/providers/SessionProvider'
import { contentPath, PATHS } from '../../app/routes/paths'
import { Artwork } from '../../components/catalog/Artwork'
import { ChannelCard } from '../../components/catalog/ChannelCard'
import { ContentCarousel } from '../../components/catalog/ContentCarousel'
import { LandscapeCard } from '../../components/catalog/LandscapeCard'
import { PosterCard } from '../../components/catalog/PosterCard'
import { EmptyState } from '../../components/feedback/EmptyState'
import { MyIplexSkeleton } from '../../components/feedback/ScreenSkeletons'
import { IplexButton } from '../../components/ui/IplexButton'
import { IplexText } from '../../components/ui/IplexText'
import { useCatalog } from '../../hooks/useCatalog'
import { useLibrary } from '../../hooks/useLibrary'
import { useMatch } from '../../hooks/useMetadata'
import { useInitialFocus } from '../../navigation/FocusProvider'
import { useRowNavigation } from '../../navigation/rowNavigation'
import type { CatalogItem } from '../../services/api/types'
import { continuing, latestReleases, libraryTitles, itemFromIndexed } from '../catalog/collections'
import { hasPersonalLibrary, SECTION_PATHS } from '../profiles/profileRules'
import { readDailyPick, writeDailyPick } from './dailyPick'

const ROW = 10
const LAUNCHES_PER_KIND = 5

const providerImage = (item: CatalogItem) => (item.imageRef && /^https:\/\//i.test(item.imageRef) ? item.imageRef : null)

/**
 * Destaque: parte de um lançamento sorteado e, se ele não tiver imagem nenhuma (sem correspondência no TMDB
 * e sem capa da fonte), passa ao próximo, até achar um com imagem. Se nenhum tiver, mostra o primeiro com
 * fundo neutro (nunca fica preso em carregamento). Os já descartados são lembrados por id, então a lista
 * crescer ou mudar de ordem (páginas do catálogo chegando) não reinicia a busca nem troca o título à toa.
 */
function Hero({ candidates, start, greeting, onOpen, onShown }: { candidates: CatalogItem[]; start: number; greeting: string; onOpen: (item: CatalogItem) => void; onShown: (id: string) => void }) {
  const [failedIds, setFailedIds] = useState<string[]>([])
  const first = candidates[start % candidates.length]!
  const rotated = [...candidates.slice(start % candidates.length), ...candidates.slice(0, start % candidates.length)]
  const next = rotated.find((c) => !failedIds.includes(c.id))
  const exhausted = !next
  const item = next ?? first
  const meta = useMatch(item)
  const summary = meta.status === 'ready' ? meta.summary : null
  const image = summary?.backdrop ?? summary?.poster ?? providerImage(item)
  const failed = !image && (meta.status === 'missing' || meta.status === 'error' || (meta.status === 'ready' && !exhausted))
  useEffect(() => {
    if (failed && !exhausted) setFailedIds((ids) => (ids.includes(item.id) ? ids : [...ids, item.id]))
  }, [failed, exhausted, item.id])
  const title = summary?.title || item.title
  // O destaque que de fato apareceu (com imagem) vira o do dia.
  useEffect(() => {
    if (image) onShown(item.id)
  }, [image, item.id, onShown])
  return (
    <section className="iplex-home__hero" aria-label="Lançamento em destaque">
      <div className="iplex-details__backdrop" aria-hidden="true">
        {image ? <Artwork key={item.id} src={image} alt="" fallback="" /> : exhausted || failed ? null : <div className="iplex-skeleton iplex-details__backdrop-skeleton" />}
        <div className="iplex-hero__scrim" />
      </div>
      <div className="iplex-home__hero-info">
        <IplexText variant="meta">{greeting}</IplexText>
        <IplexText variant="meta">Lançamento em destaque</IplexText>
        <IplexText variant="hero-title">{title}</IplexText>
        {summary?.overview && (
          <IplexText variant="description" clamp={3} className="iplex-details__overview">
            {summary.overview}
          </IplexText>
        )}
        <div data-nav-row="x" data-nav-group-root="home-hero">
          <IplexButton navId="home-hero-open" navGroup="home-hero" autoFocus onClick={() => onOpen(item)}>
            Ver detalhes
          </IplexButton>
        </div>
      </div>
    </section>
  )
}

export default function MyIplexScreen() {
  const navigate = useNavigate()
  const location = useLocation()
  const session = useReadySession()
  const { library, loaded, store } = useLibrary()
  // Visitante: só Destaques e Lançamentos (sem biblioteca pessoal). Nenhuma seção vazia aparece, para ninguém.
  const personal = hasPersonalLibrary(session.profile)
  const movies = useCatalog('movie')
  const series = useCatalog('series')

  const indexed = (id: string) => store.indexed(id)
  // Continuar assistindo: só filmes e séries.
  const continueRow = useMemo(() => continuing(library.progress, indexed).filter(({ meta }) => meta.kind !== 'channel').slice(0, ROW), [library.progress, store, movies.items, series.items]) // eslint-disable-line react-hooks/exhaustive-deps
  const favoriteTitles = useMemo(() => libraryTitles(library.favorites, indexed, true), [library.favorites, store, movies.items, series.items]) // eslint-disable-line react-hooks/exhaustive-deps
  const wishlist = useMemo(() => libraryTitles(library.wishlist ?? [], indexed).slice(0, ROW), [library.wishlist, store, movies.items, series.items]) // eslint-disable-line react-hooks/exhaustive-deps
  const watched = useMemo(() => libraryTitles(library.watched, indexed).slice(0, ROW), [library.watched, store, movies.items, series.items]) // eslint-disable-line react-hooks/exhaustive-deps
  const launches = useMemo(() => [...latestReleases(movies.items, LAUNCHES_PER_KIND), ...latestReleases(series.items, LAUNCHES_PER_KIND)]
    .sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0)), [movies.items, series.items])

  // Destaque do dia: um só por dia e por perfil, guardado no aparelho (não é sorteado de novo a cada abertura).
  const pickKey = `iplex.hero.v1.${session.identity.familyId}.${session.profile.id}`
  const [daily] = useState(() => readDailyPick(pickKey))
  const [pick] = useState(() => Math.random())
  const heroCandidates = useMemo(() => {
    const known = daily ? launches.find((l) => l.id === daily) ?? session.catalog.findLoaded(daily) : null
    if (!known || known.kind === 'channel' || known.isAdult) return launches
    return [known, ...launches.filter((l) => l.id !== known.id)]
  }, [daily, launches, session.catalog])
  const heroStart = daily && heroCandidates[0]?.id === daily ? 0 : Math.floor(pick * heroCandidates.length)
  const onHeroShown = useCallback((id: string) => writeDailyPick(pickKey, id), [pickKey])
  const featured = heroCandidates.length > 0

  // O esqueleto só sai com o conteúdo completo (biblioteca e os dois catálogos), sem trocar de tela no meio.
  const ready = loaded && !(movies.loading || series.loading)
  useInitialFocus(`${location.pathname}${location.search}`, ready)
  useRowNavigation()

  const openItem = (i: CatalogItem) => navigate(contentPath(i))
  const greeting = `Olá, ${session.profile.name}`
  const loading = !loaded || movies.loading || series.loading
  // Seções pessoais (visitante só tem Lançamentos). Nenhuma seção vazia entra.
  const sections = [
    { id: 'favorites', title: 'Favoritos', items: favoriteTitles.slice(0, ROW), scope: 'favorites' },
    { id: 'wishlist', title: 'Lista de desejo', items: wishlist, scope: 'wishlist' },
    { id: 'releases', title: 'Lançamentos', items: launches, scope: 'releases' },
    { id: 'watched', title: 'Assistidos', items: watched, scope: 'watched' },
  ] as const
  const visible = sections.filter((section) => section.items.length > 0 && (section.id === 'releases' || personal))
  const empty = !loading && !(personal && continueRow.length > 0) && visible.length === 0

  if (!ready) return <MyIplexSkeleton rowCount={ROW} />

  return (
    <main className="iplex-page iplex-home" aria-label="Meu iPlex" data-nav-managed-y="">
      {featured ? (
        <Hero candidates={heroCandidates} start={heroStart} greeting={greeting} onOpen={openItem} onShown={onHeroShown} />
      ) : (
        <div style={{ paddingTop: 'var(--iplex-content-top)' }}>
          <IplexText variant="page-title" className="iplex-page__title">
            {greeting}
          </IplexText>
        </div>
      )}
      {empty && (
        <EmptyState
          title="Nada por aqui ainda"
          description="Assim que houver lançamentos ou itens na sua lista, eles aparecem aqui."
          action={{ label: 'Explorar filmes', onClick: () => navigate(SECTION_PATHS.movies) }}
        />
      )}
      {personal && continueRow.length > 0 && (
        <ContentCarousel title="Continuar assistindo" id="my-continue" shape="landscape" onSeeAll={() => navigate(PATHS.catalog('continue', ['movie', 'series']))}>
          {continueRow.map(({ entry, meta }) => {
            // Fonte IPTV fora do ar: o card abre os detalhes (sem reprodução direta).
            const select = () => navigate(session.unavailable ? contentPath(itemFromIndexed(meta)) : PATHS.watch({ sourceId: meta.sourceId, itemId: meta.itemId, kind: meta.kind, title: meta.title, episodeId: meta.episodeId, resume: true }))
            return (
              <LandscapeCard
                key={entry.contentId}
                title={meta.title}
                sourceId={meta.sourceId}
                itemId={meta.itemId}
                subtitle={meta.episodeLabel}
                kind={meta.kind}
                year={meta.year}
                progress={entry.duration > 0 ? entry.position / entry.duration : null}
                navId={`my-continue-${entry.contentId}`}
                navGroup="my-continue"
                imageOnly
                onSelect={select}
              />
            )
          })}
        </ContentCarousel>
      )}
      {visible.map((section) => (
        <ContentCarousel key={section.id} title={section.title} id={`my-${section.id}`} shape={section.id === 'favorites' ? 'landscape' : undefined} onSeeAll={() => navigate(PATHS.catalog(section.scope))}>
          {section.items.map((item) => {
            const navId = `my-${section.id}-${item.id}`
            const navGroup = `my-${section.id}`
            if (item.kind === 'channel') return <ChannelCard key={item.id} item={item} square navId={navId} navGroup={navGroup} onSelect={openItem} />
            // Favoritos (filmes e séries) usam a capa 16:9; as demais seções, o pôster.
            if (section.id === 'favorites') return <LandscapeCard key={item.id} title={item.title} sourceId={item.sourceId} itemId={item.id} kind={item.kind} year={item.year} imageOnly navId={navId} navGroup={navGroup} onSelect={() => openItem(item)} />
            return <PosterCard key={item.id} item={item} posterOnly navId={navId} navGroup={navGroup} onSelect={openItem} />
          })}
        </ContentCarousel>
      ))}
    </main>
  )
}
