/**
 * Meu iPlex: rolagem vertical com seções horizontais de até 10 itens, todas
 * com "Ver tudo" (tela Catálogo ou a própria seção).
 * Seções, com dados reais do perfil e do catálogo:
 *  - Recentes: progresso salvo (o que o perfil começou há pouco);
 *  - Favoritos; Recentemente assistidos; Filmes; Séries; Canais favoritos.
 * Sem "Lista de desejos": o backend ainda não tem essa coleção (docs/DECISOES.md).
 * Sem histórico: mensagens curtas e atalhos — nunca cards fictícios.
 */
import { useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useReadySession } from '../../app/providers/SessionProvider'
import { PATHS } from '../../app/routes/paths'
import { ContentCarousel } from '../../components/catalog/ContentCarousel'
import { LandscapeCard } from '../../components/catalog/LandscapeCard'
import { PosterCard } from '../../components/catalog/PosterCard'
import { EmptyState } from '../../components/feedback/EmptyState'
import { LoadingState } from '../../components/feedback/LoadingState'
import { IplexText } from '../../components/ui/IplexText'
import { useCatalog } from '../../hooks/useCatalog'
import { useLibrary } from '../../hooks/useLibrary'
import { useInitialFocus } from '../../navigation/FocusProvider'
import type { CatalogItem } from '../../services/api/types'
import type { IndexedItem } from '../../services/library/libraryStore'
import { itemFromIndexed } from '../catalog/collections'
import { SECTION_PATHS } from '../profiles/profileRules'

const ROW = 10

export default function MyIplexScreen() {
  const navigate = useNavigate()
  const location = useLocation()
  const session = useReadySession()
  const { library, loaded, store } = useLibrary()
  const movies = useCatalog('movie')
  const series = useCatalog('series')

  const continueRow = useMemo(
    () =>
      library.progress
        .filter((p) => p.duration > 0 && p.position / p.duration < 0.95)
        .map((p) => ({ entry: p, meta: store.indexed(p.contentId) }))
        .filter((x): x is { entry: typeof x.entry; meta: IndexedItem } => !!x.meta)
        .slice(0, ROW),
    [library.progress, store],
  )
  const favorites = useMemo(
    () => library.favorites.map((f) => store.indexed(f.contentId)).filter((m): m is IndexedItem => !!m),
    [library.favorites, store],
  )
  const myList = useMemo(() => favorites.filter((m) => m.kind !== 'channel').slice(0, ROW), [favorites])
  const channels = useMemo(() => favorites.filter((m) => m.kind === 'channel').slice(0, ROW), [favorites])
  const watched = useMemo(
    () => library.watched.map((w) => store.indexed(w.contentId)).filter((m): m is IndexedItem => !!m && m.kind !== 'channel').slice(0, ROW),
    [library.watched, store],
  )
  const movieRow = useMemo(() => movies.items.slice(0, ROW), [movies.items])
  const seriesRow = useMemo(() => series.items.slice(0, ROW), [series.items])

  useInitialFocus(`${location.pathname}${location.search}`, loaded)
  const openMeta = (m: IndexedItem) =>
    m.kind === 'channel' ? navigate(PATHS.watch({ sourceId: m.sourceId, itemId: m.itemId, kind: 'channel', title: m.title })) : navigate(PATHS.details(m.sourceId, m.itemId, m.title))
  const openItem = (i: CatalogItem) => navigate(PATHS.details(i.sourceId, i.id, i.title))
  const empty = loaded && !continueRow.length && !myList.length && !channels.length && !watched.length

  return (
    <main className="iplex-page" aria-label="Meu iPlex">
      <IplexText variant="page-title" className="iplex-page__title">
        Olá, {session.profile.name}
      </IplexText>
      {!loaded && <LoadingState label="Carregando sua biblioteca" />}
      {empty && (
        <EmptyState
          title="Sua área pessoal está vazia"
          description="Comece a assistir ou adicione filmes e séries à sua lista para encontrá-los aqui."
          action={{ label: 'Explorar filmes', onClick: () => navigate(SECTION_PATHS.movies) }}
        />
      )}
      {continueRow.length > 0 && (
        <ContentCarousel title="Recentes" id="my-continue" shape="landscape" onSeeAll={() => navigate(PATHS.catalog('continue'))}>
          {continueRow.map(({ entry, meta }, i) => (
            <LandscapeCard
              key={entry.contentId}
              title={meta.title}
              sourceId={meta.sourceId}
              itemId={meta.itemId}
              subtitle={meta.episodeLabel}
              kind={meta.kind}
              year={meta.year}
              progress={entry.position / entry.duration}
              navId={`my-continue-${entry.contentId}`}
              navGroup="my-continue"
              autoFocus={i === 0}
              onSelect={() => navigate(PATHS.watch({ sourceId: meta.sourceId, itemId: meta.itemId, kind: meta.kind, title: meta.title, episodeId: meta.episodeId, resume: true }))}
            />
          ))}
        </ContentCarousel>
      )}
      {myList.length > 0 && (
        <ContentCarousel title="Favoritos" id="my-list" onSeeAll={() => navigate(PATHS.catalog('favorites'))}>
          {myList.map((m, i) => (
            <PosterCard key={m.contentId} item={itemFromIndexed(m)} navId={`my-list-${m.contentId}`} navGroup="my-list" onSelect={() => openMeta(m)} autoFocus={!continueRow.length && i === 0} />
          ))}
        </ContentCarousel>
      )}
      {watched.length > 0 && (
        <ContentCarousel title="Recentemente assistidos" id="my-watched" onSeeAll={() => navigate(PATHS.catalog('watched'))}>
          {watched.map((m) => (
            <PosterCard key={m.contentId} item={itemFromIndexed(m)} navId={`my-watched-${m.contentId}`} navGroup="my-watched" onSelect={() => openMeta(m)} />
          ))}
        </ContentCarousel>
      )}
      {movieRow.length > 0 && (
        <ContentCarousel title="Filmes" id="my-movies" onSeeAll={() => navigate(SECTION_PATHS.movies)}>
          {movieRow.map((item) => (
            <PosterCard key={item.id} item={item} navId={`my-movie-${item.id}`} navGroup="my-movies" onSelect={openItem} />
          ))}
        </ContentCarousel>
      )}
      {seriesRow.length > 0 && (
        <ContentCarousel title="Séries" id="my-series" onSeeAll={() => navigate(SECTION_PATHS.series)}>
          {seriesRow.map((item) => (
            <PosterCard key={item.id} item={item} navId={`my-series-${item.id}`} navGroup="my-series" onSelect={openItem} />
          ))}
        </ContentCarousel>
      )}
      {channels.length > 0 && (
        <ContentCarousel title="Canais" id="my-channels" shape="landscape" onSeeAll={() => navigate(SECTION_PATHS.live)}>
          {channels.map((m) => (
            <LandscapeCard key={m.contentId} title={m.title} kind="channel" image={null} navId={`my-ch-${m.contentId}`} navGroup="my-channels" onSelect={() => openMeta(m)} />
          ))}
        </ContentCarousel>
      )}
    </main>
  )
}
