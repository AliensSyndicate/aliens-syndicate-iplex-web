import type { ReactNode } from 'react'
import { IplexText } from '../ui/IplexText'

/**
 * Fileira horizontal (carrossel). A rolagem acompanha o foco
 * (data-nav-scroll="x"); `onNearEnd` permite carregar mais itens quando o
 * foco chega perto do fim. Layout detalhado: PROPOSTA (seção 33).
 */
export function ContentCarousel({
  title,
  id,
  children,
  onNearEnd,
  count,
  shape = 'poster',
}: {
  title: string
  id: string
  children: ReactNode
  onNearEnd?: () => void
  count?: number
  shape?: 'poster' | 'landscape' | 'channel'
}) {
  const headingId = `row-${id}`
  return (
    <section className={`iplex-row iplex-row--${shape}`} aria-labelledby={headingId} data-nav-group-root={id}>
      <IplexText variant="section-title" id={headingId} className="iplex-row__title">
        {title}
      </IplexText>
      <div
        className="iplex-row__track"
        data-nav-scroll="x"
        role="list"
        aria-label={count !== undefined ? `${title}, ${count} itens` : title}
        onFocus={(event) => {
          if (!onNearEnd) return
          const items = Array.from(event.currentTarget.querySelectorAll('[data-nav]'))
          const index = items.indexOf(event.target as Element)
          if (index >= 0 && index >= items.length - 4) onNearEnd()
        }}
      >
        {children}
      </div>
    </section>
  )
}
