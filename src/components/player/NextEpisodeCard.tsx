import { IplexButton } from '../ui/IplexButton'
import { IplexText } from '../ui/IplexText'

/**
 * Canto inferior direito, nos últimos segundos de um episódio com próximo
 * episódio disponível na fonte IPTV. A contagem vem do tempo restante real da
 * mídia (o player recalcula a cada evento de tempo), então pausa junto com o vídeo.
 */
export function NextEpisodeCard({ label, seconds, onPlay }: { label: string; seconds: number; onPlay: () => void }) {
  return (
    <aside className="iplex-player__next" aria-label="Próximo episódio">
      <div className="iplex-player__next-text">
        <IplexText variant="meta" as="p" className="iplex-player__next-label">{label}</IplexText>
        <IplexButton navId="pc-next" navGroup="player-next" onClick={onPlay}>
          Próximo episódio
        </IplexButton>
      </div>
      <span className="iplex-player__countdown" role="timer" aria-label={`Começa em ${seconds} segundos`}>
        {seconds}
      </span>
    </aside>
  )
}
