/**
 * Meu iPlex: área pessoal do perfil regular (o visitante não tem acesso).
 * Seções (propostas funcionais, documentadas em docs/DECISOES.md):
 *  - Continuar assistindo: progresso salvo (filmes e episódios);
 *  - Minha lista: filmes e séries salvos (coleção "favorites" do backend);
 *  - Canais favoritos;
 *  - Assistidos recentemente;
 *  - Recomendações: itens JÁ carregados do catálogo autorizado, das mesmas
 *    categorias dos itens da lista/progresso, ainda não assistidos.
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
import { CATALOG } from '../../config/features'
import { useCatalog } from '../../hooks/useCatalog'
import { useLibrary } from '../../hooks/useLibrary'
import { useInitialFocus } from '../../navigation/FocusProvider'
import type { CatalogItem } from '../../services/api/types'
import type { IndexedItem } from '../../services/library/libraryStore'
import { SECTION_PATHS } from '../profiles/profileRules'

function toItem(meta: IndexedItem): CatalogItem {
  return {
    id: meta.itemId,
    sourceId: meta.sourceId,
    kind: meta.kind,
    title: meta.title,
    category: meta.category ?? '',
    providerRef: '',
    version: '',
    ...(meta.year !== undefined ? { year: meta.year } : {}),
  }
}

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
        .slice(0, CATALOG.rowLimit),
    [library.progress, store],
  )
  const favorites = useMemo(
    () => library.favorites.map((f) => store.indexed(f.contentId)).filter((m): m is IndexedItem => !!m),
    [library.favorites, store],
  )
  const myList = favorites.filter((m) => m.kind !== 'channel')
  const channels = favorites.filter((m) => m.kind === 'channel')
  const watched = useMemo(
    () => library.watched.map((w) => store.indexed(w.contentId)).filter((m): m is IndexedItem => !!m && m.kind !== 'channel').slice(0, CATALOG.rowLimit),
    [library.watched, store],
  )
  const recommendations = useMemo(() => {
    const seeds = new Set([...myList, ...continueRow.map((c) => c.meta)].map((m) => m.category).filter(Boolean) as string[])
    if (!seeds.size) return []
    const exclude = new Set([...library.watched.map((w) => w.contentId), ...library.favorites.map((f) => f.contentId)])
    return [...movies.items, ...series.items].filter((i) => seeds.has(i.category) && !exclude.has(i.id)).slice(0, CATALOG.rowLimit)
  }, [myList, continueRow, library.watched, library.favorites, movies.items, series.items])

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
        <ContentCarousel title="Continuar assistindo" id="my-continue" shape="landscape">
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
      {loaded && (
        myList.length > 0 ? (
          <ContentCarousel title="Minha lista" id="my-list">
            {myList.map((m, i) => (
              <PosterCard key={m.contentId} item={toItem(m)} navId={`my-list-${m.contentId}`} navGroup="my-list" onSelect={() => openMeta(m)} autoFocus={!continueRow.length && i === 0} />
            ))}
          </ContentCarousel>
        ) : (
          !empty && <EmptyState title="Minha lista está vazia" description="Use “Adicionar à lista” nos detalhes de um filme ou série." />
        )
      )}
      {channels.length > 0 && (
        <ContentCarousel title="Canais favoritos" id="my-channels" shape="landscape">
          {channels.map((m) => (
            <LandscapeCard key={m.contentId} title={m.title} kind="channel" image={null} navId={`my-ch-${m.contentId}`} navGroup="my-channels" onSelect={() => openMeta(m)} />
          ))}
        </ContentCarousel>
      )}
      {watched.length > 0 && (
        <ContentCarousel title="Assistidos recentemente" id="my-watched">
          {watched.map((m) => (
            <PosterCard key={m.contentId} item={toItem(m)} navId={`my-watched-${m.contentId}`} navGroup="my-watched" onSelect={() => openMeta(m)} />
          ))}
        </ContentCarousel>
      )}
      {recommendations.length > 0 && (
        <ContentCarousel title="Recomendações" id="my-recs">
          {recommendations.map((item) => (
            <PosterCard key={item.id} item={item} navId={`my-rec-${item.id}`} navGroup="my-recs" onSelect={openItem} />
          ))}
        </ContentCarousel>
      )}
    </main>
  )
}
