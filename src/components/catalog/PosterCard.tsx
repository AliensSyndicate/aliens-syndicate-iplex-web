import { useRef } from 'react'
import type { CatalogItem } from '../../services/api/types'
import { useInView } from '../../hooks/useInView'
import { useMatch } from '../../hooks/useMetadata'
import { classNames } from '../../utils/classNames'
import { Artwork } from './Artwork'
import { ProgressBar } from './ProgressBar'

export interface PosterCardProps {
  item: CatalogItem
  navId: string
  navGroup: string
  onSelect: (item: CatalogItem) => void
  progress?: number | null
  autoFocus?: boolean
  onFocus?: () => void
  /** Somente a capa (sem rótulo de texto); o nome fica no aria-label. */
  posterOnly?: boolean
  /** Índice no grid do Catálogo (navegação ortogonal). */
  gridIndex?: number
}

/** Pôster 2:3 de filme/série: prioriza a imagem do conteúdo (TMDB) e respeita a proporção. */
export function PosterCard({ item, navId, navGroup, onSelect, progress, autoFocus, onFocus, posterOnly, gridIndex }: PosterCardProps) {
  const ref = useRef<HTMLButtonElement>(null)
  const visible = useInView(ref)
  const meta = useMatch(item, visible)
  const summary = meta.status === 'ready' ? meta.summary : null
  const title = summary?.title || item.title
  return (
    <button
      ref={ref}
      type="button"
      className={classNames('iplex-tile', 'iplex-tile--poster', 'iplex-tile--meta', 'iplex-focusable')}
      onClick={() => onSelect(item)}
      onFocus={onFocus}
      aria-label={title}
      data-nav=""
      data-nav-id={navId}
      data-nav-group={navGroup}
      {...(autoFocus ? { 'data-nav-autofocus': '' } : {})}
      {...(gridIndex !== undefined ? { 'data-grid-index': String(gridIndex) } : {})}
    >
      <span className="iplex-tile__frame">
        <Artwork src={summary?.poster} alt="" fallback={meta.status === 'idle' || meta.status === 'loading' ? '' : item.title} />
        {typeof progress === 'number' && <ProgressBar value={progress} />}
      </span>
      {!posterOnly && <span className="iplex-tile__label">{title}</span>}
    </button>
  )
}

