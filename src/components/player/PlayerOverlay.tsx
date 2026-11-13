import { GoBackward10SecIcon, GoForward10SecIcon, PauseIcon, PlayIcon } from '@hugeicons/core-free-icons'
import { useRef, useState } from 'react'
import { SeasonSelector } from '../../features/details/SeasonSelector'
import type { PlaybackTrack } from '../../platform/playback/types'
import type { SeriesSeason } from '../../services/api/types'
import { classNames } from '../../utils/classNames'
import { IplexButton } from '../ui/IplexButton'
import { IplexIcon } from '../ui/IplexIcon'
import { IplexText } from '../ui/IplexText'
import { PlayerEpisodes, type PlayerEpisode } from './PlayerEpisodes'
import { PlayerTimeline, seekHint } from './PlayerTimeline'

export type OverlayMode = 'hidden' | 'info' | 'interactive'

/**
 * Overlay 1 do player.
 *  - info: identificação, linha do tempo e selos técnicos (aparece ao iniciar);
 *  - interactive (OK/Enter): o mesmo painel + três controles centralizados
 *    (‑10 s, reproduzir/pausar, +10 s) e a barra navegável. Filme perto do fim:
 *    "Marcar como finalizado" fica aqui, nunca sobre o vídeo. Em séries,
 *    temporadas e episódios ficam logo abaixo; na TV (collapsible), fora da
 *    tela até o foco descer até eles ("Temporadas e capítulos" avisa abaixo da
 *    barra; Baixo na barra os abre). Aí só o conteúdo do painel sobe: o fundo
 *    (degradê) fica parado.
 * Ao ocultar, o conteúdo anterior continua desenhado durante o fade-out.
 * Ao vivo: sem linha do tempo, saltos ou selos de duração.
 */
export function PlayerOverlay({
  mode,
  title,
  episodeCode,
  episodeTitle,
  live,
  playing,
  positionMs,
  durationMs,
  seekable,
  previewMs,
  pendingMs,
  badges,
  tracks,
  seasons,
  selectedSeason,
  onSelectSeason,
  collapsible,
  episodes,
  currentEpisodeId,
  onPlayEpisode,
  onFocusEpisode,
  onToggle,
  onSkip,
  onOpenTracks,
  onFinish,
  onTimelineBlur,
}: {
  mode: OverlayMode
  title: string
  episodeCode?: string
  episodeTitle?: string
  live: boolean
  playing: boolean
  positionMs: number
  durationMs: number
  seekable: boolean
  previewMs: number | null
  pendingMs: number | null
  badges: string[]
  tracks: PlaybackTrack[]
  seasons: SeriesSeason[]
  selectedSeason: number | null
  onSelectSeason: (season: number) => void
  collapsible: boolean
  episodes: PlayerEpisode[]
  currentEpisodeId: string | null
  onPlayEpisode: (episode: PlayerEpisode['episode']) => void
  onFocusEpisode?: (episode: PlayerEpisode['episode'] | null) => void
  onToggle: () => void
  onSkip: (direction: 1 | -1) => void
  onOpenTracks: (kind: 'audio' | 'text') => void
  onFinish?: () => void
  onTimelineBlur: () => void
}) {
  const [lastShown, setLastShown] = useState<Exclude<OverlayMode, 'hidden'>>('info')
  if (mode !== 'hidden' && mode !== lastShown) setLastShown(mode)
  const shown = mode === 'hidden' ? lastShown : mode
  const interactive = shown === 'interactive'
  const [browsing, setBrowsing] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  /**
   * O foco que desce até a fileira fora da tela não pode rolar o overlay (WebKit/Tizen antigos ignoram
   * preventScroll e rolam o ancestral com overflow): quem se move é só o conteúdo, por transform.
   */
  const pinScroll = () => {
    const reset = () => {
      for (let node: HTMLElement | null = root.current; node; node = node.parentElement) {
        if (node.scrollTop) node.scrollTop = 0
        if (node.classList.contains('iplex-player')) break
      }
      root.current?.querySelectorAll<HTMLElement>('.iplex-player__panel, .iplex-player__content, .iplex-player__browser').forEach((node) => {
        if (node.scrollTop) node.scrollTop = 0
      })
    }
    reset()
    requestAnimationFrame(reset)
  }
  if (browsing && !interactive) setBrowsing(false)
  const hasBrowser = interactive && (episodes.length > 1 || seasons.length > 1)
  const hint = live ? null : seekHint(positionMs, durationMs, previewMs, pendingMs)
  const audio = tracks.filter((t) => t.kind === 'audio')
  const text = tracks.filter((t) => t.kind === 'text')
  const iconButton = (label: string, icon: typeof PlayIcon, onClick: () => void, id: string, primary = false) => (
    <button
      type="button"
      className={classNames('iplex-player__icon-button', 'iplex-focusable', primary && 'iplex-player__icon-button--primary')}
      onClick={onClick}
      aria-label={label}
      data-nav=""
      data-nav-id={id}
      data-nav-group="player-controls"
      {...(primary ? { 'data-nav-autofocus': '' } : {})}
    >
      <IplexIcon icon={icon} />
    </button>
  )
  return (
    <div
      ref={root}
      onScrollCapture={pinScroll}
      className={classNames('iplex-player__overlay', mode !== 'hidden' && 'is-visible', interactive && 'is-interactive', collapsible && browsing && 'is-browsing')}
      aria-hidden={mode === 'hidden'}
      data-overlay-mode={mode}
    >
      {interactive && (
        <div className="iplex-player__transport" role="group" aria-label="Controles de reprodução">
          {!live && seekable && iconButton('Voltar 10 segundos', GoBackward10SecIcon, () => onSkip(-1), 'pc-back')}
          {!live && iconButton(playing ? 'Pausar' : 'Reproduzir', playing ? PauseIcon : PlayIcon, onToggle, 'pc-toggle', true)}
          {!live && seekable && iconButton('Avançar 10 segundos', GoForward10SecIcon, () => onSkip(1), 'pc-forward')}
        </div>
      )}
      <div className="iplex-player__panel">
        <div className="iplex-player__content">
          <div className="iplex-player__heading-row">
            <div className="iplex-player__heading">
              <IplexText variant="section-title" as="p">{title}</IplexText>
              {(episodeCode || episodeTitle) && (
                <IplexText variant="meta" className="iplex-player__episode">
                  {episodeCode && <span className="iplex-player__code">{episodeCode}</span>}
                  {episodeTitle && <span>{episodeTitle}</span>}
                </IplexText>
              )}
              {live && (
                <div className="iplex-player__live-row">
                  <span className="iplex-player__live">Ao vivo</span>
                  {badges.length > 0 && (
                    <ul className="iplex-player__badges iplex-player__badges--live" aria-label="Informações técnicas">
                      {badges.map((b) => (
                        <li key={b} className="iplex-player__badge">{b}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
            {!live && hint && (
              <span className="iplex-player__seek-hint" role="status">
                {hint}
              </span>
            )}
          </div>
          {!live && (
            <PlayerTimeline
              positionMs={positionMs}
              durationMs={durationMs}
              seekable={interactive && seekable}
              previewMs={previewMs}
              pendingMs={pendingMs}
              onBlur={onTimelineBlur}
            />
          )}
          {hasBrowser && collapsible && (
            <IplexText variant="meta" as="p" className="iplex-player__browser-hint">
              Temporadas e capítulos
            </IplexText>
          )}
          {((!live && badges.length > 0) || (interactive && (audio.length > 1 || text.length > 0 || !!onFinish))) && (
            <div className="iplex-player__footer">
              {!live && badges.length > 0 && (
                <ul className="iplex-player__badges" aria-label="Informações técnicas">
                  {badges.map((b) => (
                    <li key={b} className="iplex-player__badge">{b}</li>
                  ))}
                </ul>
              )}
              {interactive && audio.length > 1 && (
                <IplexButton variant="secondary" navId="pc-audio" navGroup="player-tracks" onClick={() => onOpenTracks('audio')}>
                  Áudio
                </IplexButton>
              )}
              {interactive && text.length > 0 && (
                <IplexButton variant="secondary" navId="pc-text" navGroup="player-tracks" onClick={() => onOpenTracks('text')}>
                  Legendas
                </IplexButton>
              )}
              {interactive && onFinish && (
                <IplexButton variant="secondary" navId="pc-finish" navGroup="player-tracks" onClick={onFinish}>
                  Marcar como finalizado
                </IplexButton>
              )}
            </div>
          )}
          {hasBrowser && (
            <div
              className={classNames('iplex-player__browser', collapsible && 'is-collapsible')}
              data-nav-managed-y=""
              onFocus={() => {
                setBrowsing(true)
                pinScroll()
              }}
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) setBrowsing(false)
              }}
            >
              {seasons.length > 1 && selectedSeason !== null && <SeasonSelector seasons={seasons} selected={selectedSeason} onSelect={onSelectSeason} />}
              <PlayerEpisodes key={selectedSeason} episodes={episodes} currentId={currentEpisodeId} onPlay={onPlayEpisode} onFocusEpisode={onFocusEpisode} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
