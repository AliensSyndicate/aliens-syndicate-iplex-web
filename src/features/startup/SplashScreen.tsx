import { Spinner } from '../../components/feedback/LoadingState'
import { IplexLogo } from '../../components/ui/IplexLogo'

/** Splash: fundo sólido #0F0F0F, logo branco centralizado em tamanho moderado. */
export function SplashScreen({ label }: { label?: string }) {
  return (
    <div className="iplex-splash" aria-busy="true">
      <IplexLogo size="splash" />
      <div className="iplex-splash__status">
        <Spinner label={label ?? 'Carregando o iPlex'} />
      </div>
    </div>
  )
}
