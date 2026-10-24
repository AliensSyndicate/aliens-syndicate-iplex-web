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
export function SkeletonRow({ shape = 'poster', count = 15 }: { shape?: 'poster' | 'landscape' | 'channel'; count?: number }) {
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

/** Grade de placeholders (catálogo): `count` cards em linhas de `cols`, mesmas medidas do grid real. */
export function SkeletonGrid({ count = 15, cols = 5, shape = 'poster' }: { count?: number; cols?: number; shape?: 'poster' | 'square' }) {
  const rows = Math.ceil(count / cols)
  return (
    <div className="iplex-catalog__grid iplex-catalog__grid--skeleton" aria-hidden="true">
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="iplex-catalog__row">
          {Array.from({ length: Math.min(cols, count - r * cols) }, (_, c) => (
            <div key={c} className={`iplex-tile iplex-tile--${shape}`}>
              <div className="iplex-tile__frame iplex-skeleton" />
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
