import { useEffect } from 'react'
import { Spinner } from '../../components/feedback/LoadingState'
import { IplexLogo } from '../../components/ui/IplexLogo'
import { IplexText } from '../../components/ui/IplexText'
import { isUnifiedStartup, startupSplashActive } from '../../platform/startup'

const FIRST_STEP = 'Verificando dispositivo...'

/**
 * Tela de carregamento. Dentro do shell novo (inicialização única) o Web não desenha nada: a etapa
 * vai para a tela do shell (app.status). Nos demais casos (navegador, shell antigo, carregamentos
 * depois da entrada) usa fundo sólido #0F0F0F, logo branco e o texto da etapa.
 */
export function SplashScreen({ label }: { label?: string }) {
  const unified = isUnifiedStartup()
  const text = label ?? (unified ? FIRST_STEP : 'Carregando o iPlex')
  useEffect(() => {
    if (!unified) return
    return startupSplashActive(text)
  }, [unified, text])
  if (unified) return null
  return (
    <div className="iplex-splash" aria-busy="true">
      <IplexLogo size="screen" />
      <div className="iplex-splash__status">
        <Spinner label={text} />
        <IplexText variant="meta" secondary className="iplex-splash__message">
          {text}
        </IplexText>
      </div>
    </div>
  )
}
