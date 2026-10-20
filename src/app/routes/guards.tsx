import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { isPathAllowed, SECTION_PATHS, startSection } from '../../features/profiles/profileRules'
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
  return <Navigate to={SECTION_PATHS[startSection(profile)]} replace />
}
