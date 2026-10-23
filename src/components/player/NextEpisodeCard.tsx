import { IplexButton } from '../ui/IplexButton'

/**
 * Canto inferior direito, nos últimos segundos de um episódio com próximo
 * episódio disponível na fonte IPTV. Só um botão, sem fundo, com a contagem no
 * próprio texto. A contagem vem do tempo restante real da mídia (o player
 * recalcula a cada evento de tempo), então pausa junto com o vídeo.
 */
export function NextEpisodeCard({ seconds, onPlay }: { seconds: number; onPlay: () => void }) {
  return (
    <aside className="iplex-player__next" aria-label="Próximo episódio">
      <IplexButton variant="secondary" className="iplex-player__next-button" navId="pc-next" navGroup="player-next" onClick={onPlay}>
        {`Próximo episódio em ${seconds}s`}
      </IplexButton>
    </aside>
  )
}
