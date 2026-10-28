import { SkeletonRow } from './LoadingState'

/** Placeholders de tela inteira (mesmo layout das telas reais): nunca um indicador de "carregando". */

const Line = ({ className = '' }: { className?: string }) => <div className={`iplex-skeleton iplex-skeleton--text ${className}`.trim()} />

export function DetailsSkeleton() {
  return (
    <main className="iplex-page iplex-details" aria-busy="true" aria-label="Detalhes">
      <section className="iplex-details__info" aria-hidden="true">
        <Line className="iplex-skeleton--title" />
        <Line />
        <Line className="iplex-skeleton--wide" />
        <Line className="iplex-skeleton--wide" />
        <div className="iplex-details__skeleton-actions">
          <div className="iplex-skeleton iplex-skeleton--button" />
          <div className="iplex-skeleton iplex-skeleton--button" />
        </div>
      </section>
    </main>
  )
}

export function PersonSkeleton() {
  return (
    <main className="iplex-page iplex-person" aria-busy="true" aria-label="Pessoa">
      <section className="iplex-person__header" aria-hidden="true">
        <div className="iplex-person__photo iplex-skeleton" />
        <div className="iplex-person__info">
          <Line className="iplex-skeleton--title" />
          <Line />
          <Line className="iplex-skeleton--wide" />
          <Line className="iplex-skeleton--wide" />
        </div>
      </section>
      <section className="iplex-person__career" aria-hidden="true">
        <Line />
        <EpisodeBlocks />
      </section>
    </main>
  )
}

/** Blocos de lista (episódios, filmografia). */
export function EpisodeBlocks({ count = 4 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="iplex-skeleton iplex-skeleton--credit" />
      ))}
    </>
  )
}

export function SeasonsSkeleton() {
  return (
    <main className="iplex-page iplex-seasons" aria-busy="true" aria-label="Temporadas">
      <section className="iplex-details__series" aria-hidden="true">
        <Line className="iplex-skeleton--title" />
        <div className="iplex-details__skeleton-actions">
          <div className="iplex-skeleton iplex-skeleton--button" />
          <div className="iplex-skeleton iplex-skeleton--button" />
        </div>
        <EpisodeBlocks />
      </section>
    </main>
  )
}

/** Fallback enquanto o código de uma tela carrega: escolhe o placeholder pela rota. */
export function RouteSkeleton({ pathname }: { pathname: string }) {
  if (pathname === '/meu-iplex') return <MyIplexSkeleton />
  if (pathname.startsWith('/pessoa/')) return <PersonSkeleton />
  if (pathname.startsWith('/titulo/') && pathname.endsWith('/temporadas')) return <SeasonsSkeleton />
  if (pathname.startsWith('/titulo/')) return <DetailsSkeleton />
  return (
    <main className="iplex-page" aria-busy="true" aria-hidden="true">
      <SkeletonRow count={8} />
    </main>
  )
}

/** Meu iPlex: destaque (fundo à direita, título, texto e botão) e fileiras com as medidas dos cards reais. */
export function MyIplexSkeleton({ rowCount = 10 }: { rowCount?: number }) {
  return (
    <main className="iplex-page iplex-home" aria-busy="true" aria-label="Meu iPlex">
      <section className="iplex-home__hero" aria-hidden="true">
        <div className="iplex-details__backdrop">
          <div className="iplex-skeleton iplex-details__backdrop-skeleton" />
          <div className="iplex-hero__scrim" />
        </div>
        <div className="iplex-home__hero-info">
          <Line />
          <Line className="iplex-skeleton--title" />
          <Line className="iplex-skeleton--wide" />
          <Line className="iplex-skeleton--wide" />
          <div className="iplex-skeleton iplex-skeleton--button" />
        </div>
      </section>
      <SkeletonRow shape="landscape" count={rowCount} />
      <SkeletonRow shape="poster" count={rowCount} />
    </main>
  )
}
