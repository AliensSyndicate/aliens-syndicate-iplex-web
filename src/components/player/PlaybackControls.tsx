import { Backward01Icon, Forward01Icon, PauseIcon, PlayIcon } from '@hugeicons/core-free-icons'
import type { PlaybackTrack } from '../../platform/playback/types'
import { formatDuration } from '../../utils/time'
import { IplexButton } from '../ui/IplexButton'
import { IplexIcon } from '../ui/IplexIcon'
import { IplexText } from '../ui/IplexText'

/**
 * Controles do player. Botões de ícone (play/pausa/avanço) têm nome
 * acessível; botões textuais (Áudio, Legendas) não têm ícone. Ao vivo: sem
 * linha do tempo, avanço, retrocesso ou timeshift.
 */
export function PlaybackControls({
  title,
  subtitle,
  live,
  playing,
  positionMs,
  durationMs,
  canSeek,
  tracks,
  onToggle,
  onSeekBy,
  onOpenTracks,
}: {
  title: string
  subtitle?: string
  live: boolean
  playing: boolean
  positionMs: number
  durationMs: number
  canSeek: boolean
  tracks: PlaybackTrack[]
  onToggle: () => void
  onSeekBy: (deltaMs: number) => void
  onOpenTracks: (kind: 'audio' | 'text') => void
}) {
  const vod = !live && durationMs > 0
  const pct = vod ? Math.min(100, (positionMs / durationMs) * 100) : 0
  const audio = tracks.filter((t) => t.kind === 'audio')
  const text = tracks.filter((t) => t.kind === 'text')
  const iconButton = (label: string, icon: typeof PlayIcon, onClick: () => void, id: string, autoFocus = false) => (
    <button type="button" className="iplex-player__icon-button iplex-focusable" onClick={onClick} aria-label={label} data-nav="" data-nav-id={id} data-nav-group="player-controls" {...(autoFocus ? { 'data-nav-autofocus': '' } : {})}>
      <IplexIcon icon={icon} />
    </button>
  )
  return (
    <div className="iplex-player__controls" role="group" aria-label="Controles de reprodução">
      <div className="iplex-player__heading">
        <IplexText variant="section-title" as="p">{title}</IplexText>
        {subtitle && <IplexText variant="meta">{subtitle}</IplexText>}
        {live && <span className="iplex-player__live">Ao vivo</span>}
      </div>
      {vod && (
        <div className="iplex-player__timeline">
          <span className="iplex-player__time">{formatDuration(positionMs)}</span>
          <span className="iplex-progress iplex-player__bar" role="progressbar" aria-label="Posição" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
            <span className="iplex-progress__fill" style={{ width: `${pct}%` }} />
          </span>
          <span className="iplex-player__time">{formatDuration(durationMs)}</span>
        </div>
      )}
      <div className="iplex-player__buttons">
        {vod && canSeek && iconButton('Voltar 10 segundos', Backward01Icon, () => onSeekBy(-10_000), 'pc-back')}
        {iconButton(playing ? 'Pausar' : 'Reproduzir', playing ? PauseIcon : PlayIcon, onToggle, 'pc-toggle', true)}
        {vod && canSeek && iconButton('Avançar 10 segundos', Forward01Icon, () => onSeekBy(10_000), 'pc-forward')}
        {audio.length > 1 && (
          <IplexButton variant="secondary" navId="pc-audio" navGroup="player-controls" onClick={() => onOpenTracks('audio')}>
            Áudio
          </IplexButton>
        )}
        {text.length > 0 && (
          <IplexButton variant="secondary" navId="pc-text" navGroup="player-controls" onClick={() => onOpenTracks('text')}>
            Legendas
          </IplexButton>
        )}
      </div>
    </div>
  )
}
