import { Search01Icon } from '@hugeicons/core-free-icons'
import { useLocation, useNavigate } from 'react-router-dom'
import { SECTION_PATHS, sectionForPath, visibleSections } from '../../features/profiles/profileRules'
import type { Profile, SectionId } from '../../services/api/types'
import { IplexIcon } from '../ui/IplexIcon'
import { NavigationTab } from './NavigationTab'
import { ProfileAvatar } from './ProfileAvatar'

const LABELS: Record<SectionId, string> = {
  'my-iplex': 'Meu iPlex',
  search: 'Busca',
  live: 'Ao Vivo',
  movies: 'Filmes',
  series: 'Séries',
}

/**
 * Menu principal: horizontal, no topo, à esquerda, com o avatar num halo
 * translúcido e as abas numa cápsula translúcida (o conteúdo passa por trás).
 * Ordem oficial: Avatar, Meu iPlex, Busca (só ícone), Ao Vivo, Filmes, Séries.
 * Visitante: Avatar, Busca, Ao Vivo, Filmes, Séries.
 */
export function IplexHeader({ profile, onAvatar }: { profile: Profile; onAvatar: () => void }) {
  const navigate = useNavigate()
  const location = useLocation()
  const current = sectionForPath(location.pathname)
  const sections = visibleSections(profile)

  return (
    <header className={`iplex-header${current === 'movies' || current === 'series' || location.pathname.startsWith('/catalogo') ? ' iplex-header--see-through' : ''}`} data-nav-fixed="">
      <nav className="iplex-header__bar" aria-label="Menu principal">
        <button
          type="button"
          className="iplex-header__avatar iplex-focusable"
          onClick={onAvatar}
          aria-label={`Perfil: ${profile.name}. Trocar perfil`}
          aria-haspopup="dialog"
          data-nav=""
          data-nav-id="tab-avatar"
          data-nav-group="header"
        >
          <ProfileAvatar profile={profile} />
        </button>
        <div className="iplex-header__capsule">
          {sections.map((section) =>
            section === 'search' ? (
              <NavigationTab key={section} id={section} active={current === section} onSelect={() => navigate(SECTION_PATHS[section])} label="Buscar" iconOnly>
                <IplexIcon icon={Search01Icon} />
              </NavigationTab>
            ) : (
              <NavigationTab key={section} id={section} active={current === section} onSelect={() => navigate(SECTION_PATHS[section])}>
                {LABELS[section]}
              </NavigationTab>
            ),
          )}
        </div>
      </nav>
    </header>
  )
}
