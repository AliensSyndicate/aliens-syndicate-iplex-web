import { useMemo, useState } from 'react'
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
import { SECTION_PATHS } from '../profiles/profileRules'

const ROW = 10
const LAUNCHES_PER_KIND = 5

function Hero({ item, greeting, onOpen }: { item: CatalogItem; greeting: string; onOpen: (item: CatalogItem) => void }) {
  const meta = useMatch(item)
  const summary = meta.status === 'ready' ? meta.summary : null
  const title = summary?.title || item.title
  return (
    <section className="iplex-home__hero" aria-label="Lançamento em destaque">
      <div className="iplex-details__backdrop" aria-hidden="true">
        <Artwork src={summary?.backdrop ?? summary?.poster ?? (item.imageRef && /^https:\/\//i.test(item.imageRef) ? item.imageRef : null)} alt="" fallback="" />
        <div className="iplex-hero__scrim" />
      </div>
      <div className="iplex-home__hero-info">
        <IplexText variant="meta">{greeting} · Lançamento em destaque</IplexText>
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
  const featured = launches.length ? launches[Math.floor(pick * launches.length)]! : null

  const ready = loaded && (!!featured || !(movies.loading || series.loading))
  useInitialFocus(`${location.pathname}${location.search}`, ready)
  useRowNavigation()

  const openItem = (i: CatalogItem) => navigate(contentPath(i))
  const greeting = `Olá, ${session.profile.name}`
  const empty = loaded &&!continueRow.length && !favorites.length && !wishlist.length && !watched.length && !launches.length

  return (
    <main className="iplex-page iplex-home" aria-label="Meu iPlex" data-nav-managed-y="">
      {featured ? (
        <Hero item={featured} greeting={greeting} onOpen={openItem} />
      ) : (
        <div style={{ paddingTop: 'var(--iplex-content-top)' }}>
          <IplexText variant="page-title" className="iplex-page__title">
            {greeting}
          </IplexText>
        </div>
      )}
      {!loaded && <SkeletonRow shape="landscape" count={15} />}
      {empty && (
        <EmptyState
          title="Sua área pessoal está vazia"
          description="Comece a assistir ou adicione filmes e séries à sua lista para encontrá-los aqui."
          action={{ label: 'Explorar filmes', onClick: () => navigate(SECTION_PATHS.movies) }}
        />
      )}
      {continueRow.length > 0 && (
        <ContentCarousel title="Continuar assistindo" id="my-continue" shape="landscape" onSeeAll={() => navigate(PATHS.catalog('continue', ['movie', 'series', 'channel']))}>
          {continueRow.map(({ entry, meta }) => {
            const select = () => navigate(PATHS.watch({ sourceId: meta.sourceId, itemId: meta.itemId, kind: meta.kind, title: meta.title, episodeId: meta.episodeId, resume: true }))
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
        { id: 'wishlist', title: 'Lista de desejos', items: wishlist },
        { id: 'releases', title: 'Lançamentos', items: launches },
        { id: 'watched', title: 'Assistidos', items: watched },
      ] as const).map(({ id, title, items }) => items.length > 0 && (
        <ContentCarousel key={id} title={title} id={`my-${id}`} onSeeAll={() => navigate(PATHS.catalog(id))}>
          {items.map((item) => (
            <PosterCard key={item.id} item={item} posterOnly navId={`my-${id}-${item.id}`} navGroup={`my-${id}`} onSelect={openItem} />
          ))}
        </ContentCarousel>
      ))}
    </main>
  )
}
