import type { ReactNode } from 'react'
import { Artwork } from './Artwork'
import { IplexText } from '../ui/IplexText'

/**
 * Destaque cinematográfico. A imagem ocupa a própria área, com tratamento de
 * legibilidade localizado (só sobre a imagem). Dimensões: PROPOSTA (seção 33).
 */
export function HeroBanner({
  title,
  meta,
  overview,
  backdrop,
  actions,
  eyebrow,
}: {
  title: string
  meta?: string
  overview?: string
  backdrop?: string | null
  actions: ReactNode
  eyebrow?: string
}) {
  return (
    <section className="iplex-hero" aria-label={`Destaque: ${title}`}>
      <div className="iplex-hero__media">
        <Artwork src={backdrop} alt="" fallback="" className="iplex-hero__image" />
        <div className="iplex-hero__scrim" aria-hidden="true" />
      </div>
      <div className="iplex-hero__content">
        {eyebrow && <IplexText variant="meta" className="iplex-hero__eyebrow">{eyebrow}</IplexText>}
        <IplexText variant="hero-title" className="iplex-hero__title">
          {title}
        </IplexText>
        {meta && <IplexText variant="meta" className="iplex-hero__meta">{meta}</IplexText>}
        {overview && (
          <IplexText variant="description" clamp={3} className="iplex-hero__overview">
            {overview}
          </IplexText>
        )}
        <div className="iplex-hero__actions" data-nav-group-root="hero">
          {actions}
        </div>
      </div>
    </section>
  )
}
