/**
 * Detalhes de filme/série (componente único para os dois tipos), com o mesmo
 * conteúdo informativo do iPlex Control (TMDB: título original, classificação e
 * motivos, gêneros, avaliação, elenco/equipe com acesso às pessoas, temporadas e
 * episódios, recomendações), adaptado à TV.
 *
 * O item é sempre relido do catálogo autorizado: acesso por URL direta a um
 * conteúdo bloqueado para o perfil resulta em "Conteúdo indisponível".
 * Nenhuma mídia é resolvida ou pré-carregada aqui: só o player faz isso, depois
 * de Assistir, Continuar ou Assistir do início.
 */
import { categoryLabel } from '../../services/catalog/categoryLabels'
import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { useBackend } from '../../app/providers/BackendProvider'
import { useReadySession } from '../../app/providers/SessionProvider'
import { PATHS } from '../../app/routes/paths'
import { Artwork } from '../../components/catalog/Artwork'
import { ContentCarousel } from '../../components/catalog/ContentCarousel'
import { MetadataTile } from '../../components/catalog/MetadataTile'
import { AgeRatingBadge, normalizeAgeRating } from '../../components/catalog/AgeRatingBadge'
import { ErrorState } from '../../components/feedback/ErrorState'
import { LoadingState } from '../../components/feedback/LoadingState'
import { IplexButton } from '../../components/ui/IplexButton'
import { IplexText } from '../../components/ui/IplexText'
import { useDetails, useMatch } from '../../hooks/useMetadata'
import { useLibrary } from '../../hooks/useLibrary'
import { useOpenTmdbTitle } from '../../hooks/useOpenTmdbTitle'
import { useInitialFocus } from '../../navigation/FocusProvider'
import { useRowNavigation } from '../../navigation/rowNavigation'
import { toAppError, type AppError } from '../../services/api/errors'
import type { CatalogItem, SeriesDetails, SeriesEpisode } from '../../services/api/types'
import { episodeContentId, itemYear } from '../../services/catalog/normalize'
import type { TmdbPerson } from '../../services/tmdb/tmdbClient'
import { formatRuntime } from '../../utils/time'
import type { PlayerNavState } from '../playback/PlayerScreen'
import { episodeCode, orderedEpisodes } from '../playback/playerRules'
import { hasPersonalLibrary } from '../profiles/profileRules'
import { formatDate } from './detailsFormat'

type Load = { status: 'loading' } | { status: 'ready'; item: CatalogItem } | { status: 'error'; error: AppError }

const ratio = (p: { position: number; duration: number } | null) => (p && p.duration > 0 ? p.position / p.duration : null)
/** Mesma fronteira do backend (RESUME_DONE_FRACTION): a partir daqui o título está concluído. */
const DONE = 0.95
const TO_PLAYER: PlayerNavState = { from: 'details' }
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('')

export default function DetailsScreen() {
  const { sourceId = '', itemId = '' } = useParams()
  const location = useLocation()
  const title = new URLSearchParams(location.search).get('t') ?? ''
  const navigate = useNavigate()
  const { backend } = useBackend()
  const session = useReadySession()
  const { store, library } = useLibrary()
  const personal = hasPersonalLibrary(session.profile)
  const [load, setLoad] = useState<Load>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [series, setSeries] = useState<SeriesDetails | null>(null)
  const [busy, setBusy] = useState(false)
  const [listError, setListError] = useState<string | null>(null)
  const recommendation = useOpenTmdbTitle()

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
  const { details } = useDetails(kind, summary?.tmdbId ?? null, item)

  useEffect(() => {
    if (!item || item.kind !== 'series') return
    let alive = true
    backend.readSeries(session.profile.id, item.sourceId, item.providerRef).then(
      (value) => {
        if (!alive) return
        setSeries(value)
      },
      () => alive && setSeries({ seriesId: item.providerRef, seasons: [] }),
    )
    return () => {
      alive = false
    }
  }, [backend, item, session.profile.id])

  // Continuação: episódio mais recente com progresso; concluído → próximo elegível (lista da fonte IPTV).
  const resume = useMemo(() => {
    if (!item || item.kind !== 'series' || !series || !personal) return null
    const all = orderedEpisodes(series)
    let latest: { ep: SeriesEpisode; position: number; duration: number; at: number } | null = null
    for (const ep of all) {
      const p = store.progressFor(episodeContentId(item.id, ep.id))
      if (p && (!latest || p.updatedAt > latest.at)) latest = { ep, position: p.position, duration: p.duration, at: p.updatedAt }
    }
    if (!latest) return null
    if (latest.duration > 0 && latest.position / latest.duration >= DONE) {
      const next = all[all.indexOf(latest.ep) + 1]
      return next ? { episode: next, fresh: true } : null
    }
    return { episode: latest.ep, fresh: false }
    // library.revision mantém o cálculo atualizado
  }, [item, series, store, personal, library]) // eslint-disable-line react-hooks/exhaustive-deps

  useRowNavigation()
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
  const movieResumable = !!movieProgress && ratio(movieProgress)! < DONE
  const favorite = store.isFavorite(item.id)
  const name = summary?.title || item.title
  const original = details?.originalTitle || summary?.originalTitle || ''
  const year = summary?.year ?? itemYear(item.year)
  const certification = details?.certification || item.ageRating || null
  const ageSeal = normalizeAgeRating(certification)
  const seasonsLabel = series && series.seasons.length > 0 ? `${series.seasons.length} temporada${series.seasons.length === 1 ? '' : 's'}` : null
  const meta = [
    year,
    item.kind === 'movie' ? formatRuntime(details?.runtimeMinutes) : seasonsLabel,
    certification && !ageSeal ? `Classificação ${certification}` : null,
    summary?.rating ? `TMDB ${summary.rating.toFixed(1)}` : null,
  ].filter(Boolean)
  const genres = summary?.genres.length ? summary.genres : item.category ? [categoryLabel(item.category)] : []
  const overview = summary?.overview || item.plot || ''
  // Pessoas: biografia/filmografia ficam fora do perfil infantil (como a descoberta do Control).
  const canOpenPeople = session.profile.type !== 'kids' && !!summary
  const scope = { sourceId: item.sourceId, itemId: item.id, title: item.title }

  const playMovie = (resumeFrom: boolean) => navigate(PATHS.watch({ sourceId: item.sourceId, itemId: item.id, kind: 'movie', title: item.title, resume: resumeFrom }), { state: TO_PLAYER })
  const playEpisode = (ep: SeriesEpisode, resumeFrom: boolean) =>
    navigate(PATHS.watch({ sourceId: item.sourceId, itemId: item.id, kind: 'series', title: item.title, episodeId: ep.id, resume: resumeFrom }), { state: TO_PLAYER })
  const first = orderedEpisodes(series)[0]

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

  const people = (list: TmdbPerson[], group: string) =>
    list.map((p, i) => (
      <MetadataTile
        key={`${p.id ?? p.name}-${p.role}-${i}`}
        image={p.photo}
        label={p.name}
        sublabel={p.role || undefined}
        fallback={initials(p.name)}
        navId={`${group}-${p.id ?? i}`}
        navGroup={group}
        onSelect={canOpenPeople && p.id ? () => navigate(PATHS.person(p.id!, scope)) : undefined}
      />
    ))

  const info: Array<[string, string]> = [
    ...(original && original.toLowerCase() !== name.toLowerCase() ? [['Título original', original] as [string, string]] : []),
    ...(formatDate(summary?.releaseDate) ? [[item.kind === 'series' ? 'Estreia' : 'Lançamento', formatDate(summary?.releaseDate)!] as [string, string]] : []),
    ...(item.kind === 'movie' && formatRuntime(details?.runtimeMinutes) ? [['Duração', formatRuntime(details?.runtimeMinutes)!] as [string, string]] : []),
    ...(item.kind === 'series' && (details?.seasonCount || details?.episodeCount)
      ? [['Temporadas e episódios', [details?.seasonCount ? `${details.seasonCount} temporada${details.seasonCount === 1 ? '' : 's'}` : null, details?.episodeCount ? `${details.episodeCount} episódios` : null].filter(Boolean).join(' · ')] as [string, string]]
      : []),
    ...(certification ? [['Classificação indicativa', [certification, ...(details?.certificationDescriptors ?? [])].join(' · ')] as [string, string]] : []),
    ...(genres.length ? [['Gêneros', genres.join(', ')] as [string, string]] : []),
    ...(summary?.rating ? [['Avaliação', `${summary.rating.toFixed(1)} / 10 (TMDB)`] as [string, string]] : []),
    ...(summary && summary.title !== item.title ? [['Na fonte IPTV', item.title] as [string, string]] : []),
  ]

  return (
    <main className="iplex-page iplex-details" aria-label={name} data-nav-managed-y="">
      <div className="iplex-details__backdrop" aria-hidden="true">
        <Artwork src={summary?.backdrop} alt="" fallback="" />
        <div className="iplex-hero__scrim" />
      </div>
      <section className="iplex-details__info">
        <IplexText variant="hero-title">{name}</IplexText>
        {original && original.toLowerCase() !== name.toLowerCase() && <IplexText variant="meta" className="iplex-details__original">{original}</IplexText>}
        {(meta.length > 0 || ageSeal) && (
          <div className="iplex-details__meta">
            {ageSeal && <AgeRatingBadge rating={ageSeal} />}
            {meta.length > 0 && <IplexText variant="meta">{meta.join(' · ')}</IplexText>}
          </div>
        )}
        {genres.length > 0 && <IplexText variant="meta">{genres.slice(0, 4).join(' · ')}</IplexText>}
        {overview && <IplexText variant="description" clamp={3} className="iplex-details__overview">{overview}</IplexText>}
        {movieProgress && movieResumable && (
          <div className="iplex-details__progress">
            <span className="iplex-details__progress-bar"><span className="iplex-progress"><span className="iplex-progress__fill" style={{ width: `${ratio(movieProgress)! * 100}%` }} /></span></span>
          </div>
        )}
        <div className="iplex-details__actions" data-nav-group-root="details-actions" data-nav-row="x">
          {item.kind === 'movie' &&
            (movieResumable ? (
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
              <>
                <IplexButton navId="d-continue" navGroup="details-actions" autoFocus onClick={() => playEpisode(resume.episode, !resume.fresh)}>
                  {resume.fresh ? `Assistir ${episodeCode(resume.episode)}` : `Continuar ${episodeCode(resume.episode)}`}
                </IplexButton>
                {!resume.fresh && (
                  <IplexButton variant="secondary" navId="d-restart" navGroup="details-actions" onClick={() => playEpisode(resume.episode, false)}>
                    Assistir do início
                  </IplexButton>
                )}
              </>
            ) : first ? (
              <IplexButton navId="d-play" navGroup="details-actions" autoFocus onClick={() => playEpisode(first, false)}>
                Assistir agora
              </IplexButton>
            ) : null)}
          {item.kind === 'series' && (
            <IplexButton variant="secondary" navId="d-seasons" navGroup="details-actions" onClick={() => navigate(PATHS.seasons(item.sourceId, item.id, item.title))}>
              Temporadas
            </IplexButton>
          )}
          {personal && (
            <IplexButton variant="secondary" navId="d-list" navGroup="details-actions" disabled={busy} onClick={() => void toggleList()} autoFocus={item.kind === 'series' && !resume && !first}>
              {favorite ? 'Desfavoritar' : 'Favoritar'}
            </IplexButton>
          )}
        </div>
        {listError && <IplexText variant="meta" className="iplex-details__error">{listError}</IplexText>}
      </section>

      {details && details.cast.length > 0 && (
        <ContentCarousel title="Elenco" id="cast">
          {people(details.cast, 'cast')}
        </ContentCarousel>
      )}
      {details && details.crew.length > 0 && (
        <ContentCarousel title="Equipe técnica" id="crew">
          {people(details.crew, 'crew')}
        </ContentCarousel>
      )}

      {info.length > 0 && (
        <section className="iplex-details__facts" aria-label="Informações" data-nav-row="list">
          <IplexText variant="section-title">Informações</IplexText>
          <div className="iplex-facts-focus iplex-focusable" tabIndex={0} data-nav="" data-nav-id="facts" data-nav-group="facts">
            <dl className="iplex-facts">
            {info.map(([label, value]) => (
              <div key={label} className="iplex-facts__row">
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          </div>
        </section>
      )}

      {details && details.recommendations.length > 0 && (
        <ContentCarousel title="Você também pode gostar" id="recommendations">
          {details.recommendations.map((r) => (
            <MetadataTile
              key={`${r.kind}-${r.tmdbId}`}
              image={r.poster}
              label={r.title}
              sublabel={r.year ? String(r.year) : undefined}
              navId={`rec-${r.kind}-${r.tmdbId}`}
              navGroup="recommendations"
              busy={recommendation.busy === r.tmdbId}
              onSelect={() => void recommendation.open({ tmdbId: r.tmdbId, kind: r.kind, title: r.title })}
            />
          ))}
        </ContentCarousel>
      )}
      {recommendation.notice && <IplexText variant="meta" className="iplex-details__notice" as="p">{recommendation.notice}</IplexText>}
      {summary && <IplexText variant="caption" className="iplex-details__attribution">Metadados: TMDB. Este produto usa a API do TMDB, mas não é endossado ou certificado pelo TMDB.</IplexText>}

    </main>
  )
}
