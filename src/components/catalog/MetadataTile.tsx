import { Artwork } from './Artwork'

/**
 * Card 2:3 de metadados (pessoa do elenco, título recomendado/filmografia):
 * imagem do TMDB, nome e uma linha secundária. Navegável somente com `onSelect`.
 */
export function MetadataTile({
  image,
  label,
  sublabel,
  navId,
  navGroup,
  onSelect,
  busy,
  fallback,
}: {
  image: string | null
  label: string
  sublabel?: string
  navId: string
  navGroup: string
  onSelect?: () => void
  busy?: boolean
  /** Texto sem imagem (padrão: o nome). */
  fallback?: string
}) {
  const content = (
    <>
      <span className="iplex-tile__frame">
        <Artwork src={image} alt="" fallback={fallback ?? label} />
      </span>
      <span className="iplex-tile__label">{label}</span>
      {sublabel && <span className="iplex-tile__sublabel">{sublabel}</span>}
    </>
  )
  if (!onSelect) {
    return (
      <div className="iplex-tile iplex-tile--poster" role="listitem" aria-label={sublabel ? `${label}, ${sublabel}` : label}>
        {content}
      </div>
    )
  }
  return (
    <button
      type="button"
      className="iplex-tile iplex-tile--poster iplex-focusable"
      role="listitem"
      onClick={onSelect}
      aria-label={sublabel ? `${label}, ${sublabel}` : label}
      aria-busy={busy || undefined}
      data-nav=""
      data-nav-id={navId}
      data-nav-group={navGroup}
    >
      {content}
    </button>
  )
}
