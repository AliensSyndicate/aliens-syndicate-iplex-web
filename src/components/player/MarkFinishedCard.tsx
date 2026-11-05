import { IplexButton } from '../ui/IplexButton'

/**
 * Mesmo lugar e estilo do "Próximo episódio". Fica na tela nos últimos 20% do
 * filme, então não nasce focado: um OK para pausar não pode encerrar o filme.
 */
export function MarkFinishedCard({ onFinish }: { onFinish: () => void }) {
  return (
    <aside className="iplex-player__next" aria-label="Filme quase no fim">
      <IplexButton variant="secondary" className="iplex-player__next-button" navId="pc-finish" navGroup="player-next" onClick={onFinish}>
        Marcar como finalizado
      </IplexButton>
    </aside>
  )
}
