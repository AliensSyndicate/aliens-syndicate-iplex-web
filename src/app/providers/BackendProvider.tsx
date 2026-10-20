import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { firebaseConfig, USE_MOCKS } from '../../config/env'
import type { Backend } from '../../services/api/backend'
import { AppError } from '../../services/api/errors'
import { createFirebaseBackend } from '../../services/firebase/firebaseBackend'
import { createTmdbClient, type TmdbClient } from '../../services/tmdb/tmdbClient'
import { ErrorState } from '../../components/feedback/ErrorState'
import { SplashScreen } from '../../features/startup/SplashScreen'

interface BackendApi {
  backend: Backend
  tmdb: TmdbClient
}

const Ctx = createContext<BackendApi | null>(null)

async function createBackend(): Promise<Backend> {
  // Dados de demonstração: só em `vite dev` (o ramo some do build de produção).
  if (import.meta.env.DEV && USE_MOCKS) {
    const { createMockBackend } = await import('../../dev/mock/mockBackend')
    return createMockBackend()
  }
  const config = firebaseConfig()
  if (!config) throw new AppError('not-configured', 'firebase-config-missing')
  return createFirebaseBackend(config)
}

export function BackendProvider({ children, backend: injected }: { children: ReactNode; backend?: Backend }) {
  const [api, setApi] = useState<BackendApi | null>(() => (injected ? { backend: injected, tmdb: createTmdbClient(injected) } : null))
  const [error, setError] = useState<AppError | null>(null)

  useEffect(() => {
    if (injected) return
    let alive = true
    createBackend().then(
      (backend) => alive && setApi({ backend, tmdb: createTmdbClient(backend) }),
      (e) => alive && setError(e instanceof AppError ? e : new AppError('not-configured')),
    )
    return () => {
      alive = false
    }
  }, [injected])

  if (error) return <ErrorState error={error} />
  if (!api) return <SplashScreen />
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>
}

export function useBackend(): BackendApi {
  const value = useContext(Ctx)
  if (!value) throw new Error('BackendProvider ausente')
  return value
}
