/**
 * Pessoa do elenco/equipe (biografia, dados e linha do tempo da carreira),
 * equivalente à tela de pessoa do iPlex Control, adaptada à TV.
 *
 * Sempre no escopo de um título autorizado (?s=&i=): o backend só devolve a
 * pessoa se ela estiver creditada nele. Títulos da filmografia abrem somente
 * quando existem no catálogo IPTV do perfil (useOpenTmdbTitle).
 */
import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { useBackend } from '../../app/providers/BackendProvider'
import { Artwork } from '../../components/catalog/Artwork'
import { ErrorState } from '../../components/feedback/ErrorState'
import { PersonSkeleton } from '../../components/feedback/ScreenSkeletons'
import { IplexButton } from '../../components/ui/IplexButton'
import { IplexText } from '../../components/ui/IplexText'
import { useOpenTmdbTitle } from '../../hooks/useOpenTmdbTitle'
import { useInitialFocus } from '../../navigation/FocusProvider'
import { useRowNavigation } from '../../navigation/rowNavigation'
import { AppError } from '../../services/api/errors'
import type { TmdbCredit, TmdbPersonDetails } from '../../services/tmdb/tmdbClient'
import { formatDate } from './detailsFormat'

/** Funções mais comuns da equipe (o TMDB as devolve em inglês). */
const JOBS: Record<string, string> = { Acting: 'Atuação', Directing: 'Direção', Writing: 'Roteiro', Production: 'Produção', Director: 'Direção', Writer: 'Roteiro', Screenplay: 'Roteiro', Producer: 'Produção', 'Executive Producer': 'Produção executiva', 'Original Music Composer': 'Trilha sonora', 'Director of Photography': 'Direção de fotografia', Editor: 'Montagem', Creator: 'Criação', Novel: 'Obra original' }
const job = (value: string) => JOBS[value] ?? value

type Load = { status: 'loading' } | { status: 'ready'; person: TmdbPersonDetails } | { status: 'error' }

/** Linha do tempo: anos em ordem decrescente; sem data por último (ordem do backend). */
export function careerTimeline(credits: TmdbCredit[]): Array<{ year: number | null; credits: TmdbCredit[] }> {
  const groups: Array<{ year: number | null; credits: TmdbCredit[] }> = []
  for (const credit of credits) {
    const last = groups[groups.length - 1]
    if (last && last.year === credit.year) last.credits.push(credit)
    else groups.push({ year: credit.year, credits: [credit] })
  }
  return groups
}

export default function PersonScreen() {
  const { personId = '' } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const q = new URLSearchParams(location.search)
  const scope = useMemo(() => ({ sourceId: q.get('s') ?? '', id: q.get('i') ?? '' }), [location.search]) // eslint-disable-line react-hooks/exhaustive-deps
  const { tmdb } = useBackend()
  const [load, setLoad] = useState<Load>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [fullBio, setFullBio] = useState(false)
  const { open, busy, notice } = useOpenTmdbTitle()

  useEffect(() => {
    const id = Number(personId)
    if (!Number.isInteger(id) || id <= 0 || !scope.sourceId || !scope.id) return
    let alive = true
    tmdb.person(id, scope).then(
      (person) => alive && setLoad({ status: 'ready', person }),
      () => alive && setLoad({ status: 'error' }),
    )
    return () => {
      alive = false
    }
  }, [tmdb, personId, scope, attempt])

  const invalid = !Number.isInteger(Number(personId)) || !scope.sourceId || !scope.id
  useRowNavigation()
  useInitialFocus(`${location.pathname}${location.search}`, load.status !== 'loading' || invalid)

  if (invalid || load.status === 'error') {
    return (
      <main className="iplex-page">
        <ErrorState
          inline
          error={new AppError(invalid ? 'content-unavailable' : 'server-unavailable')}
          onRetry={invalid ? undefined : () => (setLoad({ status: 'loading' }), setAttempt((a) => a + 1))}
          secondary={{ label: 'Voltar', onClick: () => navigate(-1) }}
        />
      </main>
    )
  }
  if (load.status === 'loading') return <PersonSkeleton />

  const { person } = load
  const born = [formatDate(person.birthday), person.placeOfBirth].filter(Boolean).join(' · ')
  const timeline = careerTimeline(person.credits)
  return (
    <main className="iplex-page iplex-person" aria-label={person.name} data-nav-managed-y="">
      <section className="iplex-person__header">
        <div className="iplex-person__photo">
          <Artwork src={person.photo} alt="" fallback={person.name} />
        </div>
        <div className="iplex-person__info">
          <IplexText variant="hero-title">{person.name}</IplexText>
          {person.knownFor && <IplexText variant="meta">{job(person.knownFor)}</IplexText>}
          {born && <IplexText variant="meta">Nascimento: {born}</IplexText>}
          {person.deathday && <IplexText variant="meta">Falecimento: {formatDate(person.deathday)}</IplexText>}
          {person.biography ? (
            <>
              <IplexText variant="description" clamp={fullBio ? undefined : 3} className="iplex-person__bio">{person.biography}</IplexText>
              {person.biography.length > 320 && (
                <div className="iplex-details__actions" data-nav-row="x">
                  <IplexButton variant="secondary" navId="person-bio" navGroup="person-actions" autoFocus onClick={() => setFullBio((v) => !v)}>
                    {fullBio ? 'Mostrar menos' : 'Biografia completa'}
                  </IplexButton>
                </div>
              )}
            </>
          ) : (
            <IplexText variant="description" secondary>Biografia não disponível.</IplexText>
          )}
        </div>
      </section>

      {notice && <IplexText variant="meta" className="iplex-details__notice" as="p">{notice}</IplexText>}

      <section className="iplex-person__career" aria-label="Filmografia">
        <IplexText variant="section-title">Filmografia</IplexText>
        {timeline.length === 0 && <IplexText variant="description" secondary>Sem filmografia informada.</IplexText>}
        <ol className="iplex-timeline" data-nav-row="list" data-nav-top="">
          {timeline.map((group, gi) => (
            <li key={`${group.year ?? 'sem-data'}-${gi}`} className="iplex-timeline__year">
              <span className="iplex-timeline__label">{group.year ?? 'Sem data'}</span>
              <ul className="iplex-timeline__credits">
                {group.credits.map((c) => (
                  <li key={`${c.kind}-${c.tmdbId}`}>
                    <button
                      type="button"
                      className="iplex-credit iplex-focusable"
                      onClick={() => void open({ tmdbId: c.tmdbId, kind: c.kind, title: c.title, originalTitle: c.originalTitle })}
                      aria-busy={busy === c.tmdbId || undefined}
                      data-nav=""
                      data-nav-id={`credit-${c.kind}-${c.tmdbId}`}
                      data-nav-group="person-credits"
                    >
                      <span className="iplex-credit__poster">
                        <Artwork src={c.poster} alt="" fallback="" />
                      </span>
                      <span className="iplex-credit__text">
                        <span className="iplex-credit__title">{c.title}</span>
                        <span className="iplex-credit__meta">
                          {[c.kind === 'series' ? 'Série' : 'Filme', c.character ? `como ${c.character}` : c.job ? job(c.job) : null, c.episodeCount ? `${c.episodeCount} episódio${c.episodeCount === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ')}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      </section>
      <IplexText variant="caption" className="iplex-details__attribution">Metadados: TMDB. Este produto usa a API do TMDB, mas não é endossado ou certificado pelo TMDB.</IplexText>
    </main>
  )
}
