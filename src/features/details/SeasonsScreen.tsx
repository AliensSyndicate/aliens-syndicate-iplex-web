/**
 * Temporadas e episódios de uma série (aberta pelo botão Temporadas dos
 * detalhes). Lista e progresso vêm da fonte IPTV; nomes, sinopses e imagens
 * dos episódios vêm do TMDB quando existem.
 */
import { useEffect, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { useBackend } from '../../app/providers/BackendProvider'
import { useReadySession } from '../../app/providers/SessionProvider'
import { PATHS } from '../../app/routes/paths'
import { Dialog } from '../../components/dialogs/Dialog'
import { ErrorState } from '../../components/feedback/ErrorState'
import { EpisodeBlocks, SeasonsSkeleton } from '../../components/feedback/ScreenSkeletons'
import { IplexButton } from '../../components/ui/IplexButton'
import { IplexText } from '../../components/ui/IplexText'
import { useLibrary } from '../../hooks/useLibrary'
import { useMatch } from '../../hooks/useMetadata'
import { useInitialFocus } from '../../navigation/FocusProvider'
import { useRowNavigation } from '../../navigation/rowNavigation'
import { toAppError, type AppError } from '../../services/api/errors'
import type { CatalogItem, SeriesDetails, SeriesEpisode } from '../../services/api/types'
import { isAdultItem } from '../../services/catalog/adult'
import { episodeContentId } from '../../services/catalog/normalize'
import type { TmdbSeason } from '../../services/tmdb/tmdbClient'
import type { PlayerNavState } from '../playback/PlayerScreen'
import { episodeCode } from '../playback/playerRules'
import { hasPersonalLibrary } from '../profiles/profileRules'
import { EpisodeList } from './EpisodeList'
import { SeasonSelector } from './SeasonSelector'

type Load = { status: 'loading' } | { status: 'ready'; item: CatalogItem } | { status: 'error'; error: AppError }

const DONE = 0.95
const TO_PLAYER: PlayerNavState = { from: 'details' }
const ratio = (p: { position: number; duration: number } | null) => (p && p.duration > 0 ? p.position / p.duration : null)

export default function SeasonsScreen() {
  const { sourceId = '', itemId = '' } = useParams()
  const location = useLocation()
  const title = new URLSearchParams(location.search).get('t') ?? ''
  const navigate = useNavigate()
  const { backend, tmdb } = useBackend()
  const session = useReadySession()
  const { store } = useLibrary()
  const personal = hasPersonalLibrary(session.profile)
  const [load, setLoad] = useState<Load>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [series, setSeries] = useState<SeriesDetails | null>(null)
  const [seasonNumber, setSeasonNumber] = useState<number | null>(null)
  const [tmdbSeason, setTmdbSeason] = useState<TmdbSeason | null>(null)
  const [choice, setChoice] = useState<SeriesEpisode | null>(null)

  useEffect(() => {
    let alive = true
    setLoad({ status: 'loading' })
    session.catalog.findItem(sourceId, itemId, title).then(
      (item) => alive && setLoad(item && item.kind === 'series' ? { status: 'ready', item } : { status: 'error', error: toAppError({ code: 'functions/failed-precondition', message: 'not-found' }) }),
      (e) => alive && setLoad({ status: 'error', error: toAppError(e) }),
    )
    return () => {
      alive = false
    }
  }, [session.catalog, sourceId, itemId, title, attempt])

  const item = load.status === 'ready' ? load.item : null
  const adult = !!item && isAdultItem(item)
  const match = useMatch(item, !adult)
  const summary = match.status === 'ready' ? match.summary : null

  useEffect(() => {
    if (!item) return
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
    if (!item || !summary || seasonNumber === null) return
    let alive = true
    setTmdbSeason(null)
    tmdb.season(summary.tmdbId, seasonNumber, item).then(
      (s) => alive && setTmdbSeason(s),
      () => undefined,
    )
    return () => {
      alive = false
    }
  }, [tmdb, summary, seasonNumber, item])

  useRowNavigation()
  useInitialFocus(`${location.pathname}${location.search}`, load.status !== 'loading' && (load.status === 'error' || series !== null))

  if (load.status === 'loading') return <SeasonsSkeleton />
  if (load.status === 'error' || !item) {
    const error = load.status === 'error' ? load.error : null
    return (
      <main className="iplex-page">
        <ErrorState inline error={error} onRetry={error?.retryable ? () => setAttempt((a) => a + 1) : undefined} secondary={{ label: 'Voltar', onClick: () => navigate(-1) }} />
      </main>
    )
  }

  const name = summary?.title || item.title
  const season = series?.seasons.find((s) => s.seasonNumber === seasonNumber) ?? null
  const episodeProgress = (ep: SeriesEpisode) => (personal ? ratio(store.progressFor(episodeContentId(item.id, ep.id))) : null)
  const playEpisode = (ep: SeriesEpisode, resumeFrom: boolean) =>
    navigate(PATHS.watch({ sourceId: item.sourceId, itemId: item.id, kind: 'series', title: item.title, episodeId: ep.id, resume: resumeFrom }), { state: TO_PLAYER })
  const episodeName = (ep: SeriesEpisode) => (seasonNumber === ep.season ? tmdbSeason?.episodes.find((m) => m.episodeNumber === ep.episodeNum)?.name : null) || ep.title

  return (
    <main className="iplex-page iplex-seasons" aria-label={`Temporadas de ${name}`} data-nav-managed-y="">
      <IplexText variant="hero-title">{name}</IplexText>
      <section className="iplex-details__series" aria-label="Temporadas e episódios">
        {series === null && <EpisodeBlocks />}
        {series && series.seasons.length === 0 && <IplexText variant="description">Esta fonte não informou os episódios desta série.</IplexText>}
        {series && series.seasons.length > 0 && seasonNumber !== null && (
          <>
            <SeasonSelector seasons={series.seasons} selected={seasonNumber} onSelect={setSeasonNumber} />
            {season && (
              <EpisodeList
                episodes={season.episodes.map((episode) => ({ episode, progress: episodeProgress(episode) }))}
                tmdbSeason={tmdbSeason}
                onPlay={session.unavailable ? undefined : (ep) => {
                  const p = episodeProgress(ep)
                  // Progresso salvo e não concluído: o usuário escolhe entre continuar e recomeçar.
                  if (p !== null && p < DONE) setChoice(ep)
                  else playEpisode(ep, false)
                }}
              />
            )}
          </>
        )}
      </section>

      {choice && (
        <Dialog title={`${episodeCode(choice)}${episodeName(choice) ? ` · ${episodeName(choice)}` : ''}`} description="Você já começou este episódio." onClose={() => setChoice(null)}>
          <div className="iplex-dialog__actions">
            <IplexButton navId="ep-continue" autoFocus onClick={() => (setChoice(null), playEpisode(choice, true))}>
              Continuar
            </IplexButton>
            <IplexButton variant="secondary" navId="ep-restart" onClick={() => (setChoice(null), playEpisode(choice, false))}>
              Assistir do início
            </IplexButton>
          </div>
        </Dialog>
      )}
    </main>
  )
}
