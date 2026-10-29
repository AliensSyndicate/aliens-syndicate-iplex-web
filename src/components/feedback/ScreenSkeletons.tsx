import { SkeletonRow } from './LoadingState'

/** Placeholders de tela inteira (mesmo layout das telas reais): nunca um indicador de "carregando". */

const Line = ({ className = '' }: { className?: string }) => <div className={`iplex-skeleton iplex-skeleton--text ${className}`.trim()} />
/**
 * Linha de texto com a mesma fonte e altura de linha da variante real: a caixa tem um espaço como conteúdo, então o
 * navegador arredonda a altura igual ao texto de verdade. A barra visível é o miolo da linha.
 */
const TextLine = ({ variant, width }: { variant: 'meta' | 'hero' | 'description'; width: string }) => (
  <div className={`iplex-skeleton-text iplex-skeleton-text--${variant}`} style={{ width }}>
    <span className="iplex-skeleton" />
    {'\u00a0'}
  </div>
)

export function DetailsSkeleton() {
  return (
    <main className="iplex-page iplex-details" aria-busy="true" aria-label="Detalhes">
      <section className="iplex-details__info" aria-hidden="true">
        <Line className="iplex-skeleton--title" />
        <Line />
        <Line className="iplex-skeleton--wide" />
        <Line className="iplex-skeleton--wide" />
        <div className="iplex-details__skeleton-actions">
          <div className="iplex-skeleton iplex-skeleton--button">{'\u00a0'}</div>
          <div className="iplex-skeleton iplex-skeleton--button">{'\u00a0'}</div>
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
          <div className="iplex-skeleton iplex-skeleton--button">{'\u00a0'}</div>
          <div className="iplex-skeleton iplex-skeleton--button">{'\u00a0'}</div>
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

/**
 * Meu iPlex: mesma estrutura da tela real. Destaque com saudação, "Lançamento em destaque", título, sinopse de
 * 3 linhas e botão; fileiras como as do perfil (Continuar e Favoritos em 16:9, depois pôsteres). Visitante: só
 * Lançamentos (pôster).
 */
export function MyIplexSkeleton({ rowCount = 10, personal = true }: { rowCount?: number; personal?: boolean }) {
  return (
    <main className="iplex-page iplex-home" aria-busy="true" aria-label="Meu iPlex">
      <section className="iplex-home__hero" aria-hidden="true">
        <div className="iplex-details__backdrop">
          <div className="iplex-skeleton iplex-details__backdrop-skeleton" />
          <div className="iplex-hero__scrim" />
        </div>
        <div className="iplex-home__hero-info">
          <TextLine variant="meta" width="16rem" />
          <TextLine variant="meta" width="19rem" />
          <TextLine variant="hero" width="60%" />
          <div>
            <TextLine variant="description" width="100%" />
            <TextLine variant="description" width="100%" />
            <TextLine variant="description" width="70%" />
          </div>
          <div>
            <div className="iplex-skeleton iplex-skeleton--button iplex-skeleton--hero-button">{'\u00a0'}</div>
          </div>
        </div>
      </section>
      {personal && <SkeletonRow shape="landscape" count={rowCount} />}
      {personal && <SkeletonRow shape="landscape" count={rowCount} />}
      <SkeletonRow shape="poster" count={rowCount} />
      {personal && <SkeletonRow shape="poster" count={rowCount} />}
    </main>
  )
}
