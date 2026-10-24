import { FavouriteIcon } from '@hugeicons/core-free-icons'
import type { CatalogItem } from '../../services/api/types'
import { classNames } from '../../utils/classNames'
import { IplexIcon } from '../ui/IplexIcon'
import { Artwork } from './Artwork'

/** Logo do canal: só https (a CSP também exige). */
const logoUrl = (ref: string | undefined) => (ref && /^https:\/\//i.test(ref) ? ref : null)

/**
 * Canal ao vivo. As fontes não entregam a URL do logotipo ao cliente (o
 * backend guarda só um hash da imagem), então a identidade visual é o nome.
 */
export function ChannelCard({
  item,
  navId,
  navGroup,
  onSelect,
  onFocus,
  favorite,
  selected,
  autoFocus,
  subtitle,
  gridIndex,
}: {
  item: CatalogItem
  navId: string
  navGroup: string
  onSelect: (item: CatalogItem) => void
  onFocus?: (item: CatalogItem) => void
  favorite?: boolean
  selected?: boolean
  autoFocus?: boolean
  subtitle?: string | null
  /** Índice no grid do Catálogo: card quadrado 1:1 só com o nome (sem rótulo abaixo). */
  gridIndex?: number
}) {
  const initials = item.title
    .replace(/[^0-9A-Za-z\u00C0-\u024F ]/g, ' ')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toLocaleUpperCase('pt-BR')
  if (gridIndex !== undefined) {
    return (
      <button
        type="button"
        className={classNames('iplex-tile', 'iplex-tile--square', 'iplex-tile--meta', 'iplex-focusable', selected && 'is-selected')}
        onClick={() => onSelect(item)}
        onFocus={() => onFocus?.(item)}
        aria-label={`${item.title}${favorite ? ', favorito' : ''}`}
        data-nav=""
        data-nav-id={navId}
        data-nav-group={navGroup}
        data-grid-index={String(gridIndex)}
        {...(autoFocus ? { 'data-nav-autofocus': '' } : {})}
      >
        <span className="iplex-tile__frame">
          <Artwork src={logoUrl(item.imageRef)} alt="" fallback={item.title} className="iplex-artwork--logo" />
          {favorite && (
            <span className="iplex-channel__favorite">
              <IplexIcon icon={FavouriteIcon} />
            </span>
          )}
        </span>
      </button>
    )
  }
  return (
    <button
      type="button"
      className={classNames('iplex-tile', 'iplex-tile--channel', 'iplex-tile--meta', 'iplex-focusable', selected && 'is-selected')}
      onClick={() => onSelect(item)}
      onFocus={() => onFocus?.(item)}
      aria-label={`${item.title}${favorite ? ', favorito' : ''}`}
      data-nav=""
      data-nav-id={navId}
      data-nav-group={navGroup}
      {...(autoFocus ? { 'data-nav-autofocus': '' } : {})}
    >
      <span className="iplex-tile__frame iplex-tile__frame--channel">
        <span className="iplex-channel__mark" aria-hidden="true">
          {initials || '·'}
        </span>
        {favorite && (
          <span className="iplex-channel__favorite">
            <IplexIcon icon={FavouriteIcon} />
          </span>
        )}
      </span>
      <span className="iplex-tile__label">{item.title}</span>
      {subtitle && <span className="iplex-tile__sublabel">{subtitle}</span>}
    </button>
  )
}
