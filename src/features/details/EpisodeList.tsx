import { Artwork } from '../../components/catalog/Artwork'
import { ProgressBar } from '../../components/catalog/ProgressBar'
import type { SeriesEpisode } from '../../services/api/types'
import type { TmdbSeason } from '../../services/tmdb/tmdbClient'
import { formatRuntime } from '../../utils/time'

export interface EpisodeView {
  episode: SeriesEpisode
  progress: number | null
}

/** Lista de episódios da temporada (sinopse, duração, imagem e progresso quando disponíveis). */
export function EpisodeList({ episodes, tmdbSeason, onPlay }: { episodes: EpisodeView[]; tmdbSeason: TmdbSeason | null; onPlay: (e: SeriesEpisode) => void }) {
  return (
    <ol className="iplex-episodes" aria-label="Episódios" data-nav-group-root="episodes">
      {episodes.map(({ episode, progress }) => {
        const meta = tmdbSeason?.episodes.find((m) => m.episodeNumber === episode.episodeNum) ?? null
        const name = meta?.name || episode.title || `Episódio ${episode.episodeNum ?? ''}`
        const runtime = formatRuntime(meta?.runtimeMinutes) ?? episode.duration ?? null
        const plot = meta?.overview || episode.plot
        return (
          <li key={episode.id}>
            <button
              type="button"
              className="iplex-episode iplex-focusable"
              onClick={() => onPlay(episode)}
              aria-label={`Episódio ${episode.episodeNum ?? ''}: ${name}`}
              data-nav=""
              data-nav-id={`ep-${episode.id}`}
              data-nav-group="episodes"
            >
              <span className="iplex-episode__still">
                <Artwork src={meta?.still} alt="" fallback={episode.episodeNum ? `E${episode.episodeNum}` : ''} />
                {typeof progress === 'number' && <ProgressBar value={progress} />}
              </span>
              <span className="iplex-episode__text">
                <span className="iplex-episode__title">
                  {episode.episodeNum ? `${episode.episodeNum}. ` : ''}
                  {name}
                </span>
                {runtime && <span className="iplex-episode__meta">{runtime}</span>}
                {plot && <span className="iplex-episode__plot">{plot}</span>}
              </span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}
