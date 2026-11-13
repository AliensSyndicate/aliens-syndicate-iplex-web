import { useEffect } from 'react'
import { LoadingScreen } from '../../components/feedback/LoadingScreen'
import { useOptionalPlatform } from '../../app/providers/PlatformProvider'
import { WEB_VERSION } from '../../config/env'
import { isUnifiedStartup, startupSplashActive } from '../../platform/startup'

const FIRST_STEP = 'Verificando dispositivo...'

/**
 * Tela de carregamento. Dentro do shell novo (inicialização única) o Web não desenha nada: a etapa
 * vai para a tela do shell (app.status). Nos demais casos (navegador, shell antigo, carregamentos
 * depois da entrada) usa a tela única de carregamento (LoadingScreen).
 */
export function SplashScreen({ label }: { label?: string }) {
  const unified = isUnifiedStartup()
  const text = label ?? (unified ? FIRST_STEP : 'Carregando o iPlex...')
  // Mesmo texto do rodapé do shell ("iPlex TV · versão 1.1.0"); no navegador, a versão do Web.
  const info = useOptionalPlatform()?.info
  const version = info ? `iPlex TV · versão ${info.appVersion}` : `iPlex Web · versão ${WEB_VERSION}`
  useEffect(() => {
    if (!unified) return
    return startupSplashActive(text)
  }, [unified, text])
  if (unified) return null
  return <LoadingScreen status={text} version={version} />
}
