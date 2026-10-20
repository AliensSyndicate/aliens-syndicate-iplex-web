/**
 * Orquestração da inicialização e da sessão do perfil:
 *   dispositivo (credencial) → perfis autorizados → decisão de perfil →
 *   lease no backend (valida assinatura e limites) → espaços IPTV do perfil.
 *
 * Nenhuma etapa é liberada por dado local: a credencial é validada pelo
 * backend em cada chamada, a assinatura em acquireSession, as permissões em
 * cada leitura de catálogo/stream. Falha de fonte IPTV não bloqueia o app e
 * nunca é apresentada como assinatura inativa.
 */
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { TIMING } from '../../config/features'
import { decideStartupProfile, requiresPin, sortProfiles } from '../../features/profiles/profileRules'
import { AppError, toAppError } from '../../services/api/errors'
import type { DeviceIdentity, Lease, Profile, Space } from '../../services/api/types'
import { CatalogStore } from '../../services/catalog/catalogStore'
import { LibraryStore } from '../../services/library/libraryStore'
import { LeaseManager } from '../../services/session/leaseManager'
import { readJson, writeJson } from '../../utils/storage'
import { withTimeout } from '../../utils/async'
import { useBackend } from './BackendProvider'
import { usePlatform } from './PlatformProvider'

export type StartupStep = 'device' | 'profiles' | 'session' | 'catalog'

export interface ReadySession {
  status: 'ready'
  identity: DeviceIdentity
  profiles: Profile[]
  profile: Profile
  lease: Lease
  spaces: Space[]
  spacesError: AppError | null
  catalog: CatalogStore
  library: LibraryStore
}

export type SessionState =
  | { status: 'starting'; step: StartupStep }
  | { status: 'pairing' }
  | { status: 'choosing'; identity: DeviceIdentity; profiles: Profile[]; notice: AppError | null }
  | ReadySession
  | { status: 'blocked'; error: AppError; identity: DeviceIdentity | null; profiles: Profile[]; retryProfile: Profile | null }

export interface SessionApi {
  state: SessionState
  retry(): void
  paired(identity: DeviceIdentity): void
  /** `pinVerified`: o backend validou o PIN (obrigatório quando requiresPin). */
  enterProfile(profile: Profile, options?: { pinVerified?: boolean }): Promise<void>
  switchProfile(): Promise<void>
  /** Esquece a credencial local e volta ao pareamento (desvincular é no Gestor). */
  forgetDevice(): Promise<void>
  reloadSpaces(): Promise<void>
  /** Readquire o lease do perfil atual (após session-expired). */
  recoverSession(): Promise<void>
}

const LAST_PROFILE_KEY = 'iplex.lastProfile.v1'
const Ctx = createContext<SessionApi | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const { backend } = useBackend()
  const platform = usePlatform()
  const [state, setState] = useState<SessionState>({ status: 'starting', step: 'device' })
  const stateRef = useRef(state)
  useLayoutEffect(() => {
    stateRef.current = state
  })
  const run = useRef(0)
  const handleLost = useRef<(error: AppError) => void>(() => undefined)

  const leases = useMemo(
    () =>
      new LeaseManager({
        backend,
        heartbeatMs: TIMING.leaseHeartbeatMs,
        onLost: (error) => handleLost.current(error),
      }),
    [backend],
  )

  const step = <T,>(promise: Promise<T>) => withTimeout(promise, TIMING.startupStepTimeoutMs, () => new AppError('server-unavailable', 'timeout'))

  const toPairing = useCallback(async () => {
    leases.dispose()
    await backend.forgetDevice().catch(() => undefined)
    setState({ status: 'pairing' })
  }, [backend, leases])

  const enter = useCallback(
    async (identity: DeviceIdentity, profiles: Profile[], profile: Profile, options: { pinVerified?: boolean } = {}) => {
      const id = ++run.current
      const alive = () => id === run.current
      if (requiresPin(profile, profiles) && !options.pinVerified) {
        setState({ status: 'choosing', identity, profiles, notice: new AppError('profile-locked') })
        return
      }
      const current = stateRef.current
      if (current.status === 'ready') {
        current.catalog.dispose()
        if (current.profile.id !== profile.id) await leases.release()
      }
      setState({ status: 'starting', step: 'session' })
      let lease: Lease
      try {
        lease = await step(leases.acquire(profile.id))
      } catch (raw) {
        if (!alive()) return
        const error = toAppError(raw)
        if (error.kind === 'device-unpaired') return void toPairing()
        if (error.kind === 'profile-in-use' || error.kind === 'profile-unavailable') {
          setState({ status: 'choosing', identity, profiles, notice: error })
          return
        }
        setState({ status: 'blocked', error, identity, profiles, retryProfile: profile })
        return
      }
      if (!alive()) return
      writeJson(LAST_PROFILE_KEY, { familyId: identity.familyId, profileId: profile.id })
      setState({ status: 'starting', step: 'catalog' })
      let spaces: Space[] = []
      let spacesError: AppError | null = null
      try {
        spaces = await step(backend.listSpaces(profile.id))
      } catch (raw) {
        const error = toAppError(raw)
        if (error.kind === 'device-unpaired') return void toPairing()
        // Fonte IPTV indisponível ≠ assinatura: o app abre e as seções mostram o estado.
        spacesError = error.kind === 'unknown' ? new AppError('iptv-unavailable', error.code) : error
      }
      if (!alive()) return
      const catalog = new CatalogStore(backend, profile.id, spaces)
      const library = new LibraryStore(backend, identity, profile)
      void library.load().catch(() => undefined)
      setState({ status: 'ready', identity, profiles, profile, lease, spaces, spacesError, catalog, library })
    },
    [backend, leases, toPairing],
  )

  const loadProfiles = useCallback(async (identity: DeviceIdentity, alive: () => boolean) => {
    setState({ status: 'starting', step: 'profiles' })
    let profiles: Profile[]
    try {
      profiles = sortProfiles(await step(backend.listProfiles()))
    } catch (raw) {
      if (!alive()) return
      const error = toAppError(raw)
      if (error.kind === 'device-unpaired') return void toPairing()
      setState({ status: 'blocked', error, identity, profiles: [], retryProfile: null })
      return
    }
    if (!alive()) return
    const hint = readJson<{ familyId: string; profileId: string }>(LAST_PROFILE_KEY)
    const decision = decideStartupProfile(profiles, hint?.familyId === identity.familyId ? hint.profileId : null)
    if (decision.type === 'none') {
      setState({ status: 'blocked', error: new AppError('profile-unavailable', 'no-profiles'), identity, profiles, retryProfile: null })
      return
    }
    if (decision.type === 'enter') {
      await enter(identity, profiles, decision.profile)
      return
    }
    setState({ status: 'choosing', identity, profiles, notice: null })
  }, [backend, enter, toPairing])

  const boot = useCallback(async () => {
    const id = ++run.current
    const alive = () => id === run.current
    setState({ status: 'starting', step: 'device' })
    let identity: DeviceIdentity | null
    try {
      identity = await step(backend.restoreDevice())
    } catch (raw) {
      if (alive()) setState({ status: 'blocked', error: toAppError(raw), identity: null, profiles: [], retryProfile: null })
      return
    }
    if (!alive()) return
    if (!identity) {
      setState({ status: 'pairing' })
      return
    }
    await loadProfiles(identity, alive)
  }, [backend, loadProfiles])

  useEffect(() => {
    handleLost.current = (error: AppError) => {
      const current = stateRef.current
      if (current.status !== 'ready') return
      if (error.kind === 'device-unpaired') return void toPairing()
      setState({ status: 'blocked', error, identity: current.identity, profiles: current.profiles, retryProfile: current.profile })
    }
  }, [toPairing])

  useEffect(() => {
    void boot()
    return () => {
      run.current += 1
    }
  }, [boot])

  // Multitarefa: oculto libera a vaga; ao voltar, retoma o lease do mesmo perfil.
  const visible = platform.visible
  useEffect(() => {
    if (stateRef.current.status !== 'ready') return
    if (!visible) void leases.suspend()
    else
      void leases.resume().catch((raw) => {
        handleLost.current(toAppError(raw))
      })
  }, [visible, leases])

  // Encerramento: libera o lease (melhor esforço; sem isso ele expira em 90 s).
  useEffect(() => {
    const onHide = () => {
      const lease = leases.current
      if (lease) void backend.releaseSession(lease.id).catch(() => undefined)
    }
    window.addEventListener('pagehide', onHide)
    return () => {
      window.removeEventListener('pagehide', onHide)
      leases.dispose()
    }
  }, [backend, leases])

  const api = useMemo<SessionApi>(
    () => ({
      state,
      retry: () => {
        const current = stateRef.current
        if (current.status === 'blocked' && current.identity && current.retryProfile) {
          void enter(current.identity, current.profiles, current.retryProfile, { pinVerified: true })
        } else void boot()
      },
      paired: (identity) => {
        const id = ++run.current
        void loadProfiles(identity, () => id === run.current)
      },
      enterProfile: async (profile, options) => {
        const current = stateRef.current
        const identity = 'identity' in current ? current.identity : null
        const profiles = 'profiles' in current ? current.profiles : []
        if (!identity) return
        await enter(identity, profiles, profile, options)
      },
      switchProfile: async () => {
        const current = stateRef.current
        if (current.status !== 'ready') return
        run.current += 1
        current.catalog.dispose()
        await leases.release()
        setState({ status: 'choosing', identity: current.identity, profiles: current.profiles, notice: null })
      },
      forgetDevice: async () => {
        run.current += 1
        await leases.release()
        await toPairing()
      },
      recoverSession: async () => {
        const current = stateRef.current
        if (current.status !== 'ready') return
        try {
          await leases.ensure(current.profile.id)
        } catch (raw) {
          handleLost.current(toAppError(raw))
          throw raw
        }
      },
      reloadSpaces: async () => {
        const current = stateRef.current
        if (current.status !== 'ready') return
        await enter(current.identity, current.profiles, current.profile, { pinVerified: true })
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state, boot, enter, leases, toPairing],
  )

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>
}

export function useSession(): SessionApi {
  const value = useContext(Ctx)
  if (!value) throw new Error('SessionProvider ausente')
  return value
}

export function useReadySession(): ReadySession {
  const { state } = useSession()
  if (state.status !== 'ready') throw new Error('Sessão não está pronta')
  return state
}
