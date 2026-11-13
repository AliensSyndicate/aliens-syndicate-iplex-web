import { IplexLogo } from '../ui/IplexLogo'
import { IplexText } from '../ui/IplexText'

/** Texto fixo de toda tela cheia de carregamento. */
export const LOADING_TITLE = 'Só um instante.'

/**
 * Tela cheia de carregamento ÚNICA do iPlex (inicialização, troca de perfil e qualquer operação futura que precise
 * de carregamento em tela cheia): logo, texto fixo em cima, status dinâmico embaixo e spinner circular. A versão fica
 * sempre no rodapé, no mesmo lugar da tela de carregamento do shell (as duas etapas parecem uma tela só).
 */
export function LoadingScreen({ status, version }: { status: string; version?: string }) {
  return (
    <div className="iplex-splash" aria-busy="true">
      <IplexLogo size="screen" className="iplex-splash__logo" />
      <IplexText variant="page-title" as="p" className="iplex-splash__title">
        {LOADING_TITLE}
      </IplexText>
      <IplexText variant="meta" secondary as="p" className="iplex-splash__status">
        {status}
      </IplexText>
      <div className="iplex-splash__spinner" role="status" aria-label={status} />
      {version && (
        <IplexText variant="caption" as="p" className="iplex-splash__version">
          {version}
        </IplexText>
      )}
    </div>
  )
}
