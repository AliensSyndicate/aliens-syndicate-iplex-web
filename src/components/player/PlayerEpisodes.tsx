import { useEffect, useRef } from 'react'
import type { SeriesEpisode } from '../../services/api/types'
import { classNames } from '../../utils/classNames'
import { Artwork } from '../catalog/Artwork'
import { ProgressBar } from '../catalog/ProgressBar'

export interface PlayerEpisode {
  episode: SeriesEpisode
  name: string
  still: string | null
  progress: number | null
}

/** Fileira dos controles abertos: episódios da temporada, já rolada até o que está tocando. */
export function PlayerEpisodes({ episodes, currentId, onPlay }: { episodes: PlayerEpisode[]; currentId: string | null; onPlay: (episode: SeriesEpisode) => void }) {
  const track = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const row = track.current
    const current = row?.querySelector<HTMLElement>('.is-current')
    if (row && current) row.scrollLeft = current.offsetLeft - row.offsetLeft - parseFloat(getComputedStyle(row).paddingLeft)
  }, [currentId])
  return (
    <div ref={track} className="iplex-player__episodes" role="group" aria-label="Episódios da temporada" data-nav-scroll="x">
      {episodes.map(({ episode, name, still, progress }) => {
        const current = episode.id === currentId
        return (
          <button
            key={episode.id}
            type="button"
            className={classNames('iplex-player__episode-card', 'iplex-focusable', current && 'is-current')}
            onClick={() => onPlay(episode)}
            aria-label={`Episódio ${episode.episodeNum ?? ''}: ${name}`}
            aria-current={current ? 'true' : undefined}
            data-nav=""
            data-nav-id={`pe-${episode.id}`}
            data-nav-group="player-episodes"
            {...(current ? { 'data-nav-preferred': '' } : {})}
          >
            <span className="iplex-player__episode-still">
              <Artwork src={still} alt="" fallback={episode.episodeNum ? `E${episode.episodeNum}` : ''} />
              {typeof progress === 'number' && <ProgressBar value={progress} />}
            </span>
            <span className="iplex-player__episode-name">
              {episode.episodeNum ? `${episode.episodeNum}. ` : ''}
              {name}
            </span>
          </button>
        )
      })}
    </div>
  )
}
