import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { TIMING } from '../../config/features'
import { detectPlatform, type PlatformContext } from '../../platform/environment'
import { SplashScreen } from '../../features/startup/SplashScreen'
import { ErrorState } from '../../components/feedback/ErrorState'
import { AppError } from '../../services/api/errors'

export interface PlatformApi extends PlatformContext {
  online: boolean
  visible: boolean
  /** Encerra o app (somente quando o shell anuncia a capacidade). */
  exit(): void
}

const Ctx = createContext<PlatformApi | null>(null)

type State = { status: 'detecting' } | { status: 'ready'; context: PlatformContext } | { status: 'failed' }

export function PlatformProvider({ children, detect: injected }: { children: ReactNode; detect?: typeof detectPlatform }) {
  const detect = injected ?? detectPlatform
  const [state, setState] = useState<State>({ status: 'detecting' })
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false))
  const [visible, setVisible] = useState(true)

  const run = useCallback(() => {
    setState({ status: 'detecting' })
    detect({ timeoutMs: TIMING.bridgeHandshakeMs }).then(
      (context) => setState({ status: 'ready', context }),
      () => setState({ status: 'failed' }),
    )
  }, [detect])

  useEffect(() => {
    run()
  }, [run])

  const context = state.status === 'ready' ? state.context : null

  useEffect(() => {
    const root = document.documentElement
    if (context?.isTv) root.setAttribute('data-iplex-platform', 'tv')
    else root.removeAttribute('data-iplex-platform')
  }, [context])

  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    const onVisibility = () => setVisible(document.visibilityState !== 'hidden')
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    document.addEventListener('visibilitychange', onVisibility)
    const unsubscribers: Array<() => void> = []
    if (context?.bridge) {
      unsubscribers.push(
        context.bridge.on('network.status', ({ online: value }) => setOnline(value)),
        context.bridge.on('app.visibility', ({ visible: value }) => setVisible(value)),
      )
    }
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
      document.removeEventListener('visibilitychange', onVisibility)
      unsubscribers.forEach((u) => u())
    }
  }, [context])

  if (state.status === 'detecting') return <SplashScreen />
  if (state.status === 'failed') return <ErrorState error={new AppError('shell-communication')} onRetry={run} />

  const api: PlatformApi = {
    ...state.context,
    online,
    visible,
    exit: () => {
      if (state.context.bridge && state.context.capabilities.exit) void state.context.bridge.call('app.exit').catch(() => undefined)
    },
  }
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>
}

export function usePlatform(): PlatformApi {
  const value = useContext(Ctx)
  if (!value) throw new Error('PlatformProvider ausente')
  return value
}
