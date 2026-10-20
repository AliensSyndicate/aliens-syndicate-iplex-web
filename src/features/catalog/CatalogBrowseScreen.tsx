/**
 * Tela de navegação compartilhada por Filmes e Séries (sem lógica duplicada).
 *
 * Organização (PROPOSTA, seção 33):
 *  - Destaque: primeiro item do catálogo (ordem da fonte) cuja correspondência
 *    TMDB foi confirmada e tem imagem de fundo. Critério objetivo, sem
 *    "popularidade" inventada.
 *  - Continuar assistindo: progresso do perfil para este tipo.
 *  - Uma fileira por categoria da fonte (gêneros/coleções do provedor).
 * Não há "Em alta" nem "Adicionados recentemente": o backend não fornece
 * dados de audiência nem data de inclusão.
 */
import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useBackend } from '../../app/providers/BackendProvider'
import { useReadySession } from '../../app/providers/SessionProvider'
import { PATHS } from '../../app/routes/paths'
import { ContentCarousel } from '../../components/catalog/ContentCarousel'
import { HeroBanner } from '../../components/catalog/HeroBanner'
import { LandscapeCard } from '../../components/catalog/LandscapeCard'
import { PosterCard } from '../../components/catalog/PosterCard'
import { EmptyState } from '../../components/feedback/EmptyState'
import { SkeletonRow } from '../../components/feedback/LoadingState'
import { SourceStates } from '../../components/feedback/SourceStates'
import { IplexButton } from '../../components/ui/IplexButton'
import { CATALOG } from '../../config/features'
import { useCatalog } from '../../hooks/useCatalog'
import { useLibrary } from '../../hooks/useLibrary'
import { useInitialFocus } from '../../navigation/FocusProvider'
import type { CatalogItem } from '../../services/api/types'
import { itemYear, parseEpisodeContentId } from '../../services/catalog/normalize'
import type { TmdbSummary } from '../../services/tmdb/tmdbClient'
import { hasPersonalLibrary } from '../profiles/profileRules'

type Kind = 'movie' | 'series'

function useHero(items: CatalogItem[], kind: Kind) {
  const { tmdb } = useBackend()
  const [hero, setHero] = useState<{ item: CatalogItem; summary: TmdbSummary } | null>(null)
  const [done, setDone] = useState(false)
  const candidates = useMemo(() => items.slice(0, CATALOG.heroCandidates), [items])
  const key = candidates.map((c) => c.id).join(',')
  useEffect(() => {
    if (!candidates.length) return
    let alive = true
    setDone(false)
    ;(async () => {
      for (const item of candidates) {
        try {
          const result = await tmdb.match(kind, item.title, itemYear(item.year))
          if (!alive) return
          if (result.status === 'matched' && result.summary?.backdrop) {
            setHero({ item, summary: result.summary })
            setDone(true)
            return
          }
        } catch {
          // metadados indisponíveis: tenta o próximo
        }
      }
      if (alive) setDone(true)
    })()
    return () => {
      alive = false
    }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  return { hero, done }
}

export function CatalogBrowseScreen({ kind, title }: { kind: Kind; title: string }) {
  const navigate = useNavigate()
  const location = useLocation()
  const session = useReadySession()
  const { items, categories, loading, error, spacesError, noSources, noKind, loadMore, reload, hasMore } = useCatalog(kind)
  const { library, store } = useLibrary()
  const { hero, done: heroDone } = useHero(items, kind)
  const personal = hasPersonalLibrary(session.profile)
  const kindLabel = kind === 'movie' ? 'filmes' : 'séries'

  const continueRow = useMemo(() => {
    if (!personal) return []
    return library.progress
      .map((entry) => {
        const ep = kind === 'series' ? parseEpisodeContentId(entry.contentId) : null
        const meta = store.indexed(entry.contentId)
        if (!meta || meta.kind !== kind) return null
        if (kind === 'series' && !ep) return null
        if (entry.duration > 0 && entry.position / entry.duration >= 0.95) return null
        return { entry, meta }
      })
      .filter(Boolean)
      .slice(0, CATALOG.rowLimit) as Array<{ entry: (typeof library.progress)[number]; meta: NonNullable<ReturnType<typeof store.indexed>> }>
  }, [library.progress, store, kind, personal])

  const ready = items.length > 0 || !!error || !!spacesError || noSources || noKind || (!loading && !hasMore)
  useInitialFocus(`${location.pathname}${location.search}`, ready && (heroDone || items.length === 0))

  const open = (item: CatalogItem) => navigate(PATHS.details(item.sourceId, item.id, item.title))
  const states = <SourceStates spacesError={spacesError} noSources={noSources} noKind={noKind} error={error} kindLabel={kindLabel} onRetry={reload} />

  return (
    <main className="iplex-page iplex-page--browse" aria-label={title}>
      <h1 className="iplex-visually-hidden">{title}</h1>
      {hero ? (
        <HeroBanner
          title={hero.summary.title || hero.item.title}
          backdrop={hero.summary.backdrop}
          meta={[hero.summary.year, hero.summary.genres.slice(0, 3).join(' · ')].filter(Boolean).join(' · ')}
          overview={hero.summary.overview || hero.item.plot}
          actions={
            <>
              {kind === 'movie' ? (
                <IplexButton navId={`hero-play-${kind}`} navGroup="hero" autoFocus onClick={() => navigate(PATHS.watch({ sourceId: hero.item.sourceId, itemId: hero.item.id, kind, title: hero.item.title }))}>
                  Assistir agora
                </IplexButton>
              ) : null}
              <IplexButton variant={kind === 'movie' ? 'secondary' : 'primary'} navId={`hero-info-${kind}`} navGroup="hero" autoFocus={kind === 'series'} onClick={() => open(hero.item)}>
                Mais informações
              </IplexButton>
            </>
          }
        />
      ) : (
        <div className="iplex-page__spacer" />
      )}
      {states}
      {continueRow.length > 0 && (
        <ContentCarousel title="Continuar assistindo" id={`continue-${kind}`} shape="landscape">
          {continueRow.map(({ entry, meta }) => (
            <LandscapeCard
              key={entry.contentId}
              title={meta.title}
              subtitle={meta.episodeLabel}
              kind={meta.kind}
              year={meta.year}
              progress={entry.duration ? entry.position / entry.duration : null}
              navId={`continue-${entry.contentId}`}
              navGroup={`continue-${kind}`}
              onSelect={() => navigate(PATHS.watch({ sourceId: meta.sourceId, itemId: meta.itemId, kind: meta.kind, title: meta.title, episodeId: meta.episodeId, resume: true }))}
            />
          ))}
        </ContentCarousel>
      )}
      {categories.map((group, index) => (
        <ContentCarousel
          key={group.key}
          id={group.key}
          title={group.name}
          count={group.items.length}
          onNearEnd={index >= categories.length - 2 ? loadMore : undefined}
        >
          {group.items.slice(0, CATALOG.rowLimit).map((item, i) => (
            <PosterCard
              key={item.id}
              item={item}
              navId={`card-${item.id}`}
              navGroup={group.key}
              onSelect={open}
              onFocus={i === 0 && index >= categories.length - 2 ? loadMore : undefined}
              progress={personal ? progressOf(store.progressFor(item.id)) : null}
              autoFocus={!hero && index === 0 && i === 0}
            />
          ))}
        </ContentCarousel>
      ))}
      {loading && <SkeletonRow />}
      {!loading && !error && !spacesError && !noSources && !noKind && items.length === 0 && (
        <EmptyState title={`Nenhum ${kind === 'movie' ? 'filme' : 'série'} encontrado`} description="As fontes deste perfil ainda não têm itens deste tipo." />
      )}
      {!loading && hasMore && items.length > 0 && (
        <div className="iplex-page__more">
          <IplexButton variant="secondary" navId={`more-${kind}`} onClick={loadMore}>
            Carregar mais
          </IplexButton>
        </div>
      )}
    </main>
  )
}

function progressOf(entry: { position: number; duration: number } | null): number | null {
  return entry && entry.duration > 0 ? entry.position / entry.duration : null
}
