import { Search01Icon, Settings01Icon } from '@hugeicons/core-free-icons'
import { useLocation, useNavigate } from 'react-router-dom'
import { PATHS } from '../../app/routes/paths'
import { SECTION_PATHS, sectionForPath, visibleSections } from '../../features/profiles/profileRules'
import type { Profile, SectionId } from '../../services/api/types'
import { IplexIcon } from '../ui/IplexIcon'
import { NavigationTab } from './NavigationTab'
import { HeaderInfo } from './HeaderInfo'
import { ProfileAvatar } from './ProfileAvatar'

const LABELS: Record<SectionId, string> = {
  'my-iplex': 'Meu iPlex',
  search: 'Busca',
  live: 'Ao Vivo',
  movies: 'Filmes',
  series: 'Séries',
  adult: 'Adulto',
}

/**
 * Menu principal: horizontal, no topo, à esquerda, com o avatar num halo
 * translúcido e as abas numa cápsula translúcida (o conteúdo passa por trás).
 * Ordem oficial: Avatar, Meu iPlex, Busca (só ícone), Ao Vivo, Filmes, Séries; Configurações à direita da cápsula de abas.
 * Visitante: Avatar, Busca, Ao Vivo, Filmes, Séries; Configurações.
 */
export function IplexHeader({ profile, onAvatar, adultEnabled = false }: { profile: Profile; onAvatar: () => void; adultEnabled?: boolean }) {
  const navigate = useNavigate()
  const location = useLocation()
  const current = sectionForPath(location.pathname)
  const sections = visibleSections(profile, adultEnabled)

  return (
    <header className={`iplex-header${current === 'live' || current === 'movies' || current === 'series' || location.pathname.startsWith('/catalogo') ? ' iplex-header--see-through' : ''}`} data-nav-fixed="">
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
          <ProfileAvatar key={profile.id} profile={profile} />
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
        <div className="iplex-header__capsule iplex-header__capsule--end">
          <NavigationTab id="settings" active={location.pathname === PATHS.settings} onSelect={() => navigate(PATHS.settings)} label="Configurações" iconOnly>
            <IplexIcon icon={Settings01Icon} />
          </NavigationTab>
        </div>
        <HeaderInfo />
      </nav>
    </header>
  )
}
