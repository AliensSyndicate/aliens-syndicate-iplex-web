import { Navigate } from 'react-router-dom'
import { useReadySession } from '../../app/providers/SessionProvider'
import { CatalogScreen } from '../catalog/CatalogScreen'
import { isKids, SECTION_PATHS, startSection } from '../profiles/profileRules'

/**
 * Adulto: mesmo layout de Filmes/Séries (menu lateral com Ao Vivo, Filmes e Séries; grid de 5), sem detalhes.
 * Selecionar leva ao player, que pede o PIN antes de mostrar qualquer vídeo. Só existe para perfil habilitado
 * no iPlex Control; fora disso, volta à tela inicial.
 */
export default function AdultScreen() {
  const session = useReadySession()
  if (!session.catalog.adultEnabled() || isKids(session.profile)) return <Navigate to={SECTION_PATHS[startSection(session.profile)]} replace />
  return <CatalogScreen kinds={['channel', 'movie', 'series']} title="Adulto" initial="all" adult />
}
