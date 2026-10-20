/**
 * Detalhes de filme/série (componente único para os dois tipos).
 * O item é sempre relido do catálogo autorizado: acesso por URL direta a um
 * conteúdo bloqueado para o perfil resulta em "Conteúdo indisponível".
 */
import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { useBackend } from '../../app/providers/BackendProvider'
import { useReadySession } from '../../app/providers/SessionProvider'
import { PATHS } from '../../app/routes/paths'
import { Artwork } from '../../components/catalog/Artwork'
import { ErrorState } from '../../components/feedback/ErrorState'
import { LoadingState } from '../../components/feedback/LoadingState'
import { IplexButton } from '../../components/ui/IplexButton'
import { IplexText } from '../../components/ui/IplexText'
import { useDetails, useMatch } from '../../hooks/useMetadata'
import { useLibrary } from '../../hooks/useLibrary'
import { useInitialFocus } from '../../navigation/FocusProvider'
import { toAppError, type AppError } from '../../services/api/errors'
import type { CatalogItem, SeriesDetails, SeriesEpisode } from '../../services/api/types'
import { episodeContentId, itemYear } from '../../services/catalog/normalize'
import type { TmdbSeason } from '../../services/tmdb/tmdbClient'
import { formatRuntime } from '../../utils/time'
import { hasPersonalLibrary } from '../profiles/profileRules'
import { EpisodeList } from './EpisodeList'
import { SeasonSelector } from './SeasonSelector'

type Load = { status: 'loading' } | { status: 'ready'; item: CatalogItem } | { status: 'error'; error: AppError }

const ratio = (p: { position: number; duration: number } | null) => (p && p.duration > 0 ? p.position / p.duration : null)

export default function DetailsScreen() {
  const { sourceId = '', itemId = '' } = useParams()
  const location = useLocation()
  const title = new URLSearchParams(location.search).get('t') ?? ''
  const navigate = useNavigate()
  const { backend, tmdb } = useBackend()
  const session = useReadySession()
  const { store, library } = useLibrary()
  const personal = hasPersonalLibrary(session.profile)
  const [load, setLoad] = useState<Load>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [series, setSeries] = useState<SeriesDetails | null>(null)
  const [seasonNumber, setSeasonNumber] = useState<number | null>(null)
  const [tmdbSeason, setTmdbSeason] = useState<TmdbSeason | null>(null)
  const [busy, setBusy] = useState(false)
  const [listError, setListError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setLoad({ status: 'loading' })
    session.catalog.findItem(sourceId, itemId, title).then(
      (item) => alive && setLoad(item && item.kind !== 'channel' ? { status: 'ready', item } : { status: 'error', error: toAppError({ code: 'functions/failed-precondition', message: 'not-found' }) }),
      (e) => alive && setLoad({ status: 'error', error: toAppError(e) }),
    )
    return () => {
      alive = false
    }
  }, [session.catalog, sourceId, itemId, title, attempt])

  const item = load.status === 'ready' ? load.item : null
  const kind = item?.kind === 'series' ? 'series' : item?.kind === 'movie' ? 'movie' : null
  const match = useMatch(item)
  const summary = match.status === 'ready' ? match.summary : null
  const { details } = useDetails(kind, summary?.tmdbId ?? null)

  useEffect(() => {
    if (!item || item.kind !== 'series') return
    let alive = true
    backend.readSeries(session.profile.id, item.sourceId, item.providerRef).then(
      (value) => {
        if (!alive) return
        setSeries(value)
        setSeasonNumber((n) => n ?? value?.seasons[0]?.seasonNumber ?? null)
      },
      () => alive && setSeries({ seriesId: item.providerRef, seasons: [] }),
    )
    return () => {
      alive = false
    }
  }, [backend, item, session.profile.id])

  useEffect(() => {
    if (!summary || kind !== 'series' || seasonNumber === null) return
    let alive = true
    setTmdbSeason(null)
    tmdb.season(summary.tmdbId, seasonNumber).then(
      (s) => alive && setTmdbSeason(s),
      () => undefined,
    )
    return () => {
      alive = false
    }
  }, [tmdb, summary, kind, seasonNumber])

  // Continuação: episódio mais recente com progresso; concluído → próximo elegível.
  const resume = useMemo(() => {
    if (!item || item.kind !== 'series' || !series || !personal) return null
    const all = series.seasons.flatMap((s) => s.episodes)
    let latest: { ep: SeriesEpisode; position: number; duration: number; at: number } | null = null
    for (const ep of all) {
      const p = store.progressFor(episodeContentId(item.id, ep.id))
      if (p && (!latest || p.updatedAt > latest.at)) latest = { ep, position: p.position, duration: p.duration, at: p.updatedAt }
    }
    if (!latest) return null
    if (latest.duration > 0 && latest.position / latest.duration >= 0.95) {
      const next = all[all.indexOf(latest.ep) + 1]
      return next ? { episode: next, fresh: true } : null
    }
    return { episode: latest.ep, fresh: false }
    // library.revision mantém o cálculo atualizado
  }, [item, series, store, personal, library]) // eslint-disable-line react-hooks/exhaustive-deps

  useInitialFocus(`${location.pathname}${location.search}`, load.status !== 'loading' && (item?.kind !== 'series' || series !== null))

  if (load.status === 'loading') return <main className="iplex-page"><LoadingState label="Carregando detalhes" /></main>
  if (load.status === 'error' || !item) {
    const error = load.status === 'error' ? load.error : null
    return (
      <main className="iplex-page">
        <ErrorState inline error={error} onRetry={error?.retryable ? () => setAttempt((a) => a + 1) : undefined} secondary={{ label: 'Voltar', onClick: () => navigate(-1) }} />
      </main>
    )
  }

  const movieProgress = item.kind === 'movie' && personal ? store.progressFor(item.id) : null
  const favorite = store.isFavorite(item.id)
  const name = summary?.title || item.title
  const year = summary?.year ?? itemYear(item.year)
  const meta = [
    year,
    details?.certification ? `Classificação ${details.certification}` : item.ageRating ? `Classificação ${item.ageRating}` : null,
    item.kind === 'movie' ? formatRuntime(details?.runtimeMinutes) : series ? `${series.seasons.length} temporada${series.seasons.length === 1 ? '' : 's'}` : null,
    summary?.rating ? `TMDB ${summary.rating.toFixed(1)}` : null,
  ].filter(Boolean)
  const genres = summary?.genres.length ? summary.genres : item.category ? [item.category] : []
  const overview = summary?.overview || item.plot || ''
  const season = series?.seasons.find((s) => s.seasonNumber === seasonNumber) ?? null

  const playMovie = (resumeFrom: boolean) => navigate(PATHS.watch({ sourceId: item.sourceId, itemId: item.id, kind: 'movie', title: item.title, resume: resumeFrom }))
  const playEpisode = (ep: SeriesEpisode, resumeFrom: boolean) =>
    navigate(PATHS.watch({ sourceId: item.sourceId, itemId: item.id, kind: 'series', title: item.title, episodeId: ep.id, resume: resumeFrom }))
  const first = series?.seasons[0]?.episodes[0]

  const toggleList = async () => {
    setBusy(true)
    setListError(null)
    try {
      await store.setFavorite(item, !favorite)
    } catch {
      setListError('Não foi possível atualizar sua lista. Tente novamente.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="iplex-page iplex-details" aria-label={name}>
      <div className="iplex-details__backdrop" aria-hidden="true">
        <Artwork src={summary?.backdrop} alt="" fallback="" />
        <div className="iplex-hero__scrim" />
      </div>
      <section className="iplex-details__info">
        <IplexText variant="hero-title">{name}</IplexText>
        {summary && summary.title !== item.title && <IplexText variant="caption">Na fonte: {item.title}</IplexText>}
        {meta.length > 0 && <IplexText variant="meta">{meta.join(' · ')}</IplexText>}
        {genres.length > 0 && <IplexText variant="meta">{genres.slice(0, 4).join(' · ')}</IplexText>}
        {overview && <IplexText variant="description" clamp={3} className="iplex-details__overview">{overview}</IplexText>}
        {movieProgress && ratio(movieProgress)! < 0.95 && (
          <div className="iplex-details__progress">
            <span className="iplex-details__progress-bar"><span className="iplex-progress"><span className="iplex-progress__fill" style={{ width: `${ratio(movieProgress)! * 100}%` }} /></span></span>
          </div>
        )}
        <div className="iplex-details__actions" data-nav-group-root="details-actions">
          {item.kind === 'movie' &&
            (movieProgress && ratio(movieProgress)! < 0.95 ? (
              <>
                <IplexButton navId="d-continue" navGroup="details-actions" autoFocus onClick={() => playMovie(true)}>
                  Continuar
                </IplexButton>
                <IplexButton variant="secondary" navId="d-play" navGroup="details-actions" onClick={() => playMovie(false)}>
                  Assistir do início
                </IplexButton>
              </>
            ) : (
              <IplexButton navId="d-play" navGroup="details-actions" autoFocus onClick={() => playMovie(false)}>
                Assistir agora
              </IplexButton>
            ))}
          {item.kind === 'series' &&
            (resume ? (
              <IplexButton navId="d-continue" navGroup="details-actions" autoFocus onClick={() => playEpisode(resume.episode, !resume.fresh)}>
                {resume.fresh ? 'Próximo episódio' : 'Continuar'}
              </IplexButton>
            ) : first ? (
              <IplexButton navId="d-play" navGroup="details-actions" autoFocus onClick={() => playEpisode(first, false)}>
                Assistir agora
              </IplexButton>
            ) : null)}
          {personal && (
            <IplexButton variant="secondary" navId="d-list" navGroup="details-actions" disabled={busy} onClick={() => void toggleList()} autoFocus={item.kind === 'series' && !resume && !first}>
              {favorite ? 'Remover da lista' : 'Adicionar à lista'}
            </IplexButton>
          )}
        </div>
        {listError && <IplexText variant="meta" className="iplex-details__error">{listError}</IplexText>}
      </section>

      {item.kind === 'series' && (
        <section className="iplex-details__series" aria-label="Temporadas e episódios">
          {series === null && <LoadingState label="Carregando episódios" />}
          {series && series.seasons.length === 0 && <IplexText variant="description">Esta fonte não informou os episódios desta série.</IplexText>}
          {series && series.seasons.length > 0 && seasonNumber !== null && (
            <>
              <SeasonSelector seasons={series.seasons} selected={seasonNumber} onSelect={setSeasonNumber} />
              {season && (
                <EpisodeList
                  episodes={season.episodes.map((episode) => ({ episode, progress: personal ? ratio(store.progressFor(episodeContentId(item.id, episode.id))) : null }))}
                  tmdbSeason={tmdbSeason}
                  onPlay={(ep) => {
                    const p = personal ? ratio(store.progressFor(episodeContentId(item.id, ep.id))) : null
                    playEpisode(ep, p !== null && p < 0.95)
                  }}
                />
              )}
            </>
          )}
        </section>
      )}

      {details && details.cast.length > 0 && (
        <section className="iplex-details__cast" aria-label="Elenco">
          <IplexText variant="section-title">Elenco</IplexText>
          <ul className="iplex-cast">
            {details.cast.slice(0, 10).map((p) => (
              <li key={`${p.name}-${p.role}`} className="iplex-cast__person">
                <span className="iplex-cast__name">{p.name}</span>
                {p.role && <span className="iplex-cast__role">{p.role}</span>}
              </li>
            ))}
          </ul>
          {details.crew.length > 0 && (
            <IplexText variant="meta">
              {details.crew[0]!.role}: {details.crew.map((c) => c.name).join(', ')}
            </IplexText>
          )}
        </section>
      )}
      {summary && <IplexText variant="caption" className="iplex-details__attribution">Metadados: TMDB. Este produto usa a API do TMDB, mas não é endossado ou certificado pelo TMDB.</IplexText>}
    </main>
  )
}
