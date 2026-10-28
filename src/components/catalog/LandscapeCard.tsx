import { useRef } from 'react'
import type { ContentKind } from '../../services/api/types'
import { useInView } from '../../hooks/useInView'
import { useMatch } from '../../hooks/useMetadata'
import { Artwork } from './Artwork'
import { ProgressBar } from './ProgressBar'

/** Card 16:9 (Continuar assistindo, episódios). */
export function LandscapeCard({
  title,
  sourceId,
  itemId,
  subtitle,
  kind,
  year,
  image,
  progress,
  navId,
  navGroup,
  onSelect,
  autoFocus,
  imageOnly,
  gridIndex,
}: {
  title: string
  sourceId?: string
  itemId?: string
  subtitle?: string
  kind: ContentKind
  year?: string | number
  image?: string | null
  progress?: number | null
  navId: string
  navGroup: string
  onSelect: () => void
  autoFocus?: boolean
  /** Só a imagem (e a barra de progresso): o nome fica no aria-label. */
  imageOnly?: boolean
  gridIndex?: number
}) {
  const ref = useRef<HTMLButtonElement>(null)
  const visible = useInView(ref)
  const meta = useMatch(image === undefined && sourceId && itemId ? { id: itemId, sourceId, kind, title, year } : null, visible)
  const summary = meta.status === 'ready' ? meta.summary : null
  const src = image ?? summary?.backdrop ?? summary?.poster ?? null
  const label = summary?.title || title
  return (
    <button
      ref={ref}
      type="button"
      className="iplex-tile iplex-tile--landscape iplex-tile--meta iplex-focusable"
      onClick={onSelect}
      aria-label={subtitle ? `${label}, ${subtitle}` : label}
      data-nav=""
      data-nav-id={navId}
      data-nav-group={navGroup}
      {...(gridIndex !== undefined ? { 'data-grid-index': String(gridIndex) } : {})}
      {...(autoFocus ? { 'data-nav-autofocus': '' } : {})}
    >
      <span className="iplex-tile__frame">
        <Artwork src={src} alt="" fallback={!src && (!imageOnly || meta.status !== 'loading') ? label : ''} failedText={label} />
        {typeof progress === 'number' && <ProgressBar value={progress} />}
      </span>
      {!imageOnly && <span className="iplex-tile__label">{label}</span>}
      {!imageOnly && subtitle && <span className="iplex-tile__sublabel">{subtitle}</span>}
    </button>
  )
}
