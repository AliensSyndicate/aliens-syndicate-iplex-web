import { IplexText } from '../ui/IplexText'

/** Indicador discreto (sem animação pesada). */
export function Spinner({ label = 'Carregando' }: { label?: string }) {
  return (
    <span className="iplex-spinner" role="status" aria-label={label}>
      <span className="iplex-spinner__dot" />
      <span className="iplex-spinner__dot" />
      <span className="iplex-spinner__dot" />
    </span>
  )
}

export function LoadingState({ label }: { label?: string }) {
  return (
    <div className="iplex-state iplex-state--inline iplex-state--loading">
      <Spinner label={label} />
      {label && <IplexText variant="meta">{label}</IplexText>}
    </div>
  )
}

/** Fileira de placeholders com o mesmo tamanho dos cards (evita saltos de layout). */
export function SkeletonRow({ shape = 'poster', count = 8 }: { shape?: 'poster' | 'landscape' | 'channel'; count?: number }) {
  return (
    <div className="iplex-row iplex-row--skeleton" aria-hidden="true">
      <div className="iplex-row__title iplex-skeleton iplex-skeleton--text" />
      <div className="iplex-row__track">
        {Array.from({ length: count }, (_, i) => (
          <div key={i} className={`iplex-tile iplex-tile--${shape}`}>
            <div className="iplex-tile__frame iplex-skeleton" />
          </div>
        ))}
      </div>
    </div>
  )
}
