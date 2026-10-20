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
      className="iplex-tile iplex-tile--landscape iplex-focusable"
      onClick={onSelect}
      aria-label={subtitle ? `${label}, ${subtitle}` : label}
      data-nav=""
      data-nav-id={navId}
      data-nav-group={navGroup}
      {...(autoFocus ? { 'data-nav-autofocus': '' } : {})}
    >
      <span className="iplex-tile__frame">
        <Artwork src={src} alt="" fallback={title} />
        {typeof progress === 'number' && <ProgressBar value={progress} />}
      </span>
      <span className="iplex-tile__label">{label}</span>
      {subtitle && <span className="iplex-tile__sublabel">{subtitle}</span>}
    </button>
  )
}
