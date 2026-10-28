import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { firebaseConfig, USE_MOCKS } from '../../config/env'
import type { Backend } from '../../services/api/backend'
import { AppError } from '../../services/api/errors'
import { sharedFirebaseBackend } from '../../services/firebase/firebaseBackend'
import { createTmdbClient, type TmdbClient } from '../../services/tmdb/tmdbClient'
import { ErrorState } from '../../components/feedback/ErrorState'
import { SplashScreen } from '../../features/startup/SplashScreen'
import { diag, diagnosticsEnabled } from '../../platform/diagnostics'

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
  return sharedFirebaseBackend(config)
}

export function BackendProvider({ children, backend: injected }: { children: ReactNode; backend?: Backend }) {
  const [api, setApi] = useState<BackendApi | null>(() => (injected ? { backend: injected, tmdb: createTmdbClient(injected) } : null))
  const [error, setError] = useState<AppError | null>(null)

  useEffect(() => {
    if (injected) return
    let alive = true
    createBackend().then(
      (backend) => {
        // Somente no modo de diagnóstico da TV (?diag=1): o roteiro de verificação usa o mesmo backend.
        if (diagnosticsEnabled()) {
          const w = window as unknown as { __iplexBackend?: Backend; __iplexTmdb?: TmdbClient }
          w.__iplexBackend = backend
          w.__iplexTmdb = createTmdbClient(backend)
        }
        if (alive) setApi({ backend, tmdb: createTmdbClient(backend) })
      },
      (e) => {
        diag('backend-init', `${e instanceof Error ? `${e.name}: ${e.message}` : String(e)} ${(e as Error)?.stack?.split('\n').slice(0, 3).join(' | ') ?? ''}`)
        if (alive) setError(e instanceof AppError ? e : new AppError('not-configured'))
      },
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
