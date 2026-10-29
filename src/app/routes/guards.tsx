import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { hasPersonalLibrary, isPathAllowed, SECTION_PATHS, startSection } from '../../features/profiles/profileRules'
import { MyIplexSkeleton } from '../../components/feedback/ScreenSkeletons'
import { useReadySession } from '../providers/SessionProvider'

/** Bloqueia rotas não permitidas ao perfil (ex.: visitante em Meu iPlex). */
export function ProfileRoute({ children }: { children: ReactNode }) {
  const { profile } = useReadySession()
  const location = useLocation()
  if (!isPathAllowed(location.pathname, profile)) return <Navigate to={SECTION_PATHS[startSection(profile)]} replace />
  return <>{children}</>
}

export function StartRedirect() {
  const { profile } = useReadySession()
  const start = startSection(profile)
  // Redireciona sem piscar: o esqueleto da tela inicial fica no lugar até a rota certa montar.
  return (
    <>
      <Navigate to={SECTION_PATHS[start]} replace />
      {start === 'my-iplex' && <MyIplexSkeleton personal={hasPersonalLibrary(profile)} />}
    </>
  )
}
