import { GoBackward10SecIcon, GoForward10SecIcon, PauseIcon, PlayIcon } from '@hugeicons/core-free-icons'
import { useState } from 'react'
import type { PlaybackTrack } from '../../platform/playback/types'
import { classNames } from '../../utils/classNames'
import { IplexButton } from '../ui/IplexButton'
import { IplexIcon } from '../ui/IplexIcon'
import { IplexText } from '../ui/IplexText'
import { PlayerTimeline } from './PlayerTimeline'

export type OverlayMode = 'hidden' | 'info' | 'interactive'

/**
 * Overlay 1 do player.
 *  - info: identificação, linha do tempo e selos técnicos (aparece ao iniciar);
 *  - interactive (OK/Enter): o mesmo painel + três controles centralizados
 *    (‑10 s, reproduzir/pausar, +10 s) e a barra navegável.
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
  reserveNext,
  onToggle,
  onSkip,
  onOpenTracks,
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
  /** O cartão "Próximo episódio" ocupa o canto inferior direito: o painel reserva o espaço. */
  reserveNext: boolean
  onToggle: () => void
  onSkip: (direction: 1 | -1) => void
  onOpenTracks: (kind: 'audio' | 'text') => void
  onTimelineBlur: () => void
}) {
  const [lastShown, setLastShown] = useState<Exclude<OverlayMode, 'hidden'>>('info')
  if (mode !== 'hidden' && mode !== lastShown) setLastShown(mode)
  const shown = mode === 'hidden' ? lastShown : mode
  const interactive = shown === 'interactive'
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
      className={classNames('iplex-player__overlay', mode !== 'hidden' && 'is-visible', interactive && 'is-interactive', reserveNext && 'has-next')}
      aria-hidden={mode === 'hidden'}
      data-overlay-mode={mode}
    >
      {interactive && (
        <div className="iplex-player__transport" role="group" aria-label="Controles de reprodução">
          {!live && seekable && iconButton('Voltar 10 segundos', GoBackward10SecIcon, () => onSkip(-1), 'pc-back')}
          {iconButton(playing ? 'Pausar' : 'Reproduzir', playing ? PauseIcon : PlayIcon, onToggle, 'pc-toggle', true)}
          {!live && seekable && iconButton('Avançar 10 segundos', GoForward10SecIcon, () => onSkip(1), 'pc-forward')}
        </div>
      )}
      <div className="iplex-player__panel">
        <div className="iplex-player__heading">
          <IplexText variant="section-title" as="p">{title}</IplexText>
          {(episodeCode || episodeTitle) && (
            <IplexText variant="meta" className="iplex-player__episode">
              {episodeCode && <span className="iplex-player__code">{episodeCode}</span>}
              {episodeTitle && <span>{episodeTitle}</span>}
            </IplexText>
          )}
          {live && <span className="iplex-player__live">Ao vivo</span>}
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
        {(badges.length > 0 || (interactive && (audio.length > 1 || text.length > 0))) && (
          <div className="iplex-player__footer">
            {badges.length > 0 && (
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
          </div>
        )}
      </div>
    </div>
  )
}
