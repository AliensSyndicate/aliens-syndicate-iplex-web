import type { SeriesSeason } from '../../services/api/types'
import { classNames } from '../../utils/classNames'

export function SeasonSelector({ seasons, selected, onSelect }: { seasons: SeriesSeason[]; selected: number; onSelect: (n: number) => void }) {
  return (
    <div className="iplex-chips" role="tablist" aria-label="Temporadas" data-nav-scroll="x" data-nav-group-root="seasons">
      {seasons.map((s) => (
        <button
          key={s.seasonNumber}
          type="button"
          role="tab"
          aria-selected={s.seasonNumber === selected}
          className={classNames('iplex-chip', 'iplex-focusable', s.seasonNumber === selected && 'is-active')}
          onClick={() => onSelect(s.seasonNumber)}
          data-nav=""
          data-nav-id={`season-${s.seasonNumber}`}
          data-nav-group="seasons"
          {...(s.seasonNumber === selected ? { 'data-nav-preferred': '' } : {})}
        >
          {s.name}
        </button>
      ))}
    </div>
  )
}
