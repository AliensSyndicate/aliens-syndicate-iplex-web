import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useReadySession } from '../../app/providers/SessionProvider'
import { contentPath, PATHS } from '../../app/routes/paths'
import { Artwork } from '../../components/catalog/Artwork'
import { ChannelCard } from '../../components/catalog/ChannelCard'
import { ContentCarousel } from '../../components/catalog/ContentCarousel'
import { LandscapeCard } from '../../components/catalog/LandscapeCard'
import { PosterCard } from '../../components/catalog/PosterCard'
import { EmptyState } from '../../components/feedback/EmptyState'
import { SkeletonRow } from '../../components/feedback/LoadingState'
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

const ROW = 10
const LAUNCHES_PER_KIND = 5

const providerImage = (item: CatalogItem) => (item.imageRef && /^https:\/\//i.test(item.imageRef) ? item.imageRef : null)

/**
 * Destaque: parte de um lançamento sorteado e, se ele não tiver imagem nenhuma (sem correspondência no TMDB
 * e sem capa da fonte), passa ao próximo, até achar um com imagem. Se nenhum tiver, mostra o primeiro com
 * fundo neutro (nunca fica preso em carregamento). Os já descartados são lembrados por id, então a lista
 * crescer ou mudar de ordem (páginas do catálogo chegando) não reinicia a busca nem troca o título à toa.
 */
function Hero({ candidates, start, greeting, onOpen }: { candidates: CatalogItem[]; start: number; greeting: string; onOpen: (item: CatalogItem) => void }) {
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

  const continueRow = useMemo(() => continuing(library.progress, (id) => store.indexed(id)).slice(0, ROW), [library.progress, store, movies.items, series.items])
  const favorites = useMemo(() => libraryTitles(library.favorites, (id) => store.indexed(id)).slice(0, ROW), [library.favorites, store, movies.items, series.items])
  const wishlist = useMemo(() => libraryTitles(library.wishlist ?? [], (id) => store.indexed(id)).slice(0, ROW), [library.wishlist, store, movies.items, series.items])
  const watched = useMemo(() => libraryTitles(library.watched, (id) => store.indexed(id)).slice(0, ROW), [library.watched, store, movies.items, series.items])
  const launches = useMemo(() => [...latestReleases(movies.items, LAUNCHES_PER_KIND), ...latestReleases(series.items, LAUNCHES_PER_KIND)]
    .sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0)), [movies.items, series.items])

  // Destaque: um dos lançamentos, sorteado uma vez por visita à tela.
  const [pick] = useState(() => Math.random())
  const featured = launches.length > 0

  const ready = loaded && (!!featured || !(movies.loading || series.loading))
  useInitialFocus(`${location.pathname}${location.search}`, ready)
  useRowNavigation()

  const openItem = (i: CatalogItem) => navigate(contentPath(i))
  const greeting = `Olá, ${session.profile.name}`
  const loading = !loaded || movies.loading || series.loading
  const empty = !loading && !launches.length && !continueRow.length && !favorites.length && !wishlist.length && !watched.length

  return (
    <main className="iplex-page iplex-home" aria-label="Meu iPlex" data-nav-managed-y="">
      {featured ? (
        <Hero candidates={launches} start={Math.floor(pick * launches.length)} greeting={greeting} onOpen={openItem} />
      ) : (
        <div style={{ paddingTop: 'var(--iplex-content-top)' }}>
          <IplexText variant="page-title" className="iplex-page__title">
            {greeting}
          </IplexText>
        </div>
      )}
      {!loaded && <SkeletonRow shape="landscape" count={ROW} />}
      {empty && (
        <EmptyState
          title="Nada por aqui ainda"
          description="Assim que houver lançamentos ou itens na sua lista, eles aparecem aqui."
          action={{ label: 'Explorar filmes', onClick: () => navigate(SECTION_PATHS.movies) }}
        />
      )}
      {personal && continueRow.length > 0 && (
        <ContentCarousel title="Continuar assistindo" id="my-continue" shape="landscape" onSeeAll={() => navigate(PATHS.catalog('continue', ['movie', 'series', 'channel']))}>
          {continueRow.map(({ entry, meta }) => {
            // Fonte IPTV fora do ar: o card abre os detalhes (sem reprodução direta).
            const select = () => navigate(session.unavailable ? contentPath(itemFromIndexed(meta)) : PATHS.watch({ sourceId: meta.sourceId, itemId: meta.itemId, kind: meta.kind, title: meta.title, episodeId: meta.episodeId, resume: true }))
            if (meta.kind === 'channel') {
              return <ChannelCard key={entry.contentId} item={itemFromIndexed(meta)} square progress={entry.duration > 0 ? entry.position / entry.duration : null} navId={`my-continue-${entry.contentId}`} navGroup="my-continue" onSelect={select} />
            }
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
      {([
        { id: 'favorites', title: 'Favoritos', items: favorites },
        { id: 'wishlist', title: 'Lista de desejo', items: wishlist },
        { id: 'releases', title: 'Lançamentos', items: launches },
        { id: 'watched', title: 'Assistidos', items: watched },
      ] as const).map(({ id, title, items }) => items.length > 0 && (id === 'releases' || personal) && (
        <ContentCarousel key={id} title={title} id={`my-${id}`} onSeeAll={() => navigate(PATHS.catalog(id))}>
          {items.map((item) => (
            <PosterCard key={item.id} item={item} posterOnly navId={`my-${id}-${item.id}`} navGroup={`my-${id}`} onSelect={openItem} />
          ))}
        </ContentCarousel>
      ))}
    </main>
  )
}
