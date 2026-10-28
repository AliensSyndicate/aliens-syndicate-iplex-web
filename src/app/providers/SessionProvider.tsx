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
import type { HeartbeatResult } from '../../services/api/backend'
import { AppError, isAmbiguousAuthFailure, toAppError } from '../../services/api/errors'
import type { CatalogRecord, DeviceIdentity, Lease, Profile, Space } from '../../services/api/types'
import { CatalogStore } from '../../services/catalog/catalogStore'
import { CATALOG } from '../../config/features'
import { prefetchScreens } from '../screens'
import { resetViewMemory } from '../../features/catalog/viewMemory'
import { getCatalogCache } from '../../services/catalog/catalogCache'
import { syncSources } from '../../services/catalog/catalogSync'
import { LibraryStore } from '../../services/library/libraryStore'
import { LeaseManager } from '../../services/session/leaseManager'
import { readJson, writeJson } from '../../utils/storage'
import { withTimeout } from '../../utils/async'
import { diag } from '../../platform/diagnostics'
import { useBackend } from './BackendProvider'
import { usePlatform } from './PlatformProvider'

/** Etapas reais da inicialização (cada uma só aparece quando de fato começa). */
export type StartupStep = 'device' | 'connection' | 'account' | 'profile' | 'movies' | 'series' | 'channels' | 'done'

export interface ReadySession {
  status: 'ready'
  identity: DeviceIdentity
  profiles: Profile[]
  profile: Profile
  lease: Lease
  spaces: Space[]
  spacesError: AppError | null
  /** Fonte IPTV do usuário com erro: a TV navega normalmente, sem conteúdo (marca d'água e sem botões de reproduzir). */
  unavailable: boolean
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
  /** Confirma agora se a credencial da TV ainda vale (ex.: sinal de desvinculação). */
  checkDevice(): Promise<void>
  /** Permissões do perfil mudaram no Control: some/aparece o conteúdo adulto na hora e o catálogo é refeito em seguida. */
  refreshAccess(): Promise<void>
  /** Respostas do heartbeat (pedido de reprodução pendente). Devolve o cancelamento. */
  onHeartbeat(listener: (result: HeartbeatResult) => void): () => void
}

const LAST_PROFILE_KEY = 'iplex.lastProfile.v1'
const UNAVAILABLE_RETRY_MS = 30_000

/** Desvínculo de verdade (revogada/removida no Gestor). Falha ambígua de credencial NÃO desvincula. */
const isUnpaired = (error: AppError) => error.kind === 'device-unpaired' && !isAmbiguousAuthFailure(error)
/**
 * Só a fonte IPTV do usuário com erro entra no app sem conteúdo (marca d'água). Falha do NOSSO servidor
 * (verificação do dispositivo, perfis, conta) barra o app na tela inicial, com "Tentar novamente".
 */
const isUnavailable = (error: AppError) => error.kind === 'iptv-unavailable'
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
  const onPermissions = useRef<(result: HeartbeatResult) => void>(() => undefined)
  const refreshing = useRef(false)
  const refreshAgain = useRef(false)
  const beatListeners = useRef(new Set<(result: HeartbeatResult) => void>())

  const leases = useMemo(
    () =>
      new LeaseManager({
        backend,
        heartbeatMs: TIMING.leaseHeartbeatMs,
        onLost: (error) => handleLost.current(error),
        onBeat: (result) => {
          beatListeners.current.forEach((listener) => listener(result))
          onPermissions.current(result)
        },
      }),
    [backend],
  )

  const step = <T,>(promise: Promise<T>) => withTimeout(promise, TIMING.startupStepTimeoutMs, () => new AppError('server-unavailable', 'timeout'))

  const toPairing = useCallback(async () => {
    leases.dispose()
    // Perdeu o acesso: nenhum catálogo local sobrevive à conta/dispositivo.
    await getCatalogCache().clearAll().catch(() => undefined)
    await backend.forgetDevice().catch(() => undefined)
    setState({ status: 'pairing' })
  }, [backend, leases])

  /**
   * As permissões do perfil mudaram no iPlex Control (ex.: conteúdo adulto): relê o perfil e refaz o catálogo em
   * segundo plano, sem reiniciar a sessão. O menu e as listas se atualizam sozinhos quando o novo catálogo chega.
   */
  /** `force`: aviso novo do Control durante uma atualização em andamento → roda de novo ao terminar (a batida repetida não). */
  const refreshAccess = useCallback(async (force = false): Promise<void> => {
    const current = stateRef.current
    if (current.status !== 'ready') return
    if (refreshing.current) {
      if (force) refreshAgain.current = true
      return
    }
    refreshing.current = true
    try {
      const profiles = sortProfiles(await backend.listProfiles())
      const profile = profiles.find((p) => p.id === current.profile.id)
      if (!profile) return
      // 1) Rápido: o que mudou no conteúdo adulto aparece/some na hora (manifesto + só o conjunto adulto, que é pequeno).
      try {
        for (const space of current.spaces) {
          const manifest = await backend.readCatalogManifest(profile.id, space.sourceId)
          if (manifest.adultEnabled !== true) {
            current.catalog.applyAdult(space.sourceId, [], false)
            continue
          }
          const records: CatalogRecord[] = []
          for (let n = 0; n < (manifest.sets.adult?.chunks ?? 0); n += 1) {
            const chunk = await backend.readCatalogChunk(profile.id, space.sourceId, 'adult', n, manifest.version)
            records.push(...chunk.records)
          }
          current.catalog.applyAdult(space.sourceId, records, true)
        }
        const quick = stateRef.current
        if (quick.status === 'ready' && quick.profile.id === profile.id) setState({ ...quick, profile, profiles })
        diag('sync', `adulto atualizado na hora v${profile.permissionsVersion}`)
      } catch {
        // Sem os conjuntos (backend antigo) ou rede: o refazer completo abaixo cobre.
      }
      // 2) Completo, em segundo plano: demais permissões (fontes, tipos) e cache local.
      let results: Awaited<ReturnType<typeof syncSources>> | null = null
      try {
        results = await syncSources(
          { backend, cache: getCatalogCache(), diag },
          `${current.identity.familyId}:${profile.id}`,
          profile.id,
          current.spaces.map((space) => space.sourceId),
        )
      } catch (raw) {
        if (toAppError(raw).kind !== 'backend-outdated') throw raw
        // Backend sem os conjuntos: refaz as páginas (o backend já aplica as novas permissões).
        await Promise.all((['movie', 'series', 'channel'] as const).map((kind) => current.catalog.reload(kind)))
      }
      const now = stateRef.current
      if (now.status !== 'ready' || now.profile.id !== profile.id) return
      for (const result of results ?? []) current.catalog.hydrate(result.sourceId, result.sets, result.version, result.adultEnabled)
      setState({ ...now, profile, profiles })
      diag('sync', `permissões atualizadas v${profile.permissionsVersion}`)
    } catch {
      // Sem rede ou fonte ocupada: a próxima batida tenta de novo.
    } finally {
      refreshing.current = false
      if (refreshAgain.current) {
        refreshAgain.current = false
        void refreshAccess(true)
      }
    }
  }, [backend])
  useEffect(() => {
    onPermissions.current = (result) => {
      const current = stateRef.current
      diag('beat', `versão=${String(result.permissionsVersion)} adulto=${String(result.adultEnabled)} perfil=${current.status === 'ready' ? `${current.profile.name}#${current.profile.permissionsVersion}` : current.status}`)
      if (current.status !== 'ready' || typeof result.permissionsVersion !== 'number') return
      // Adulto desligado: some já (a AppLayout relê o catálogo); o catálogo novo chega em seguida.
      if (result.adultEnabled === false && current.catalog.adultEnabled()) {
        current.catalog.revokeAdult()
        setState({ ...current })
      }
      if (result.permissionsVersion !== current.profile.permissionsVersion) void refreshAccess()
    }
  }, [refreshAccess])

  /**
   * Fonte IPTV do usuário fora do ar: o iPlex (nosso servidor) responde, então o app entra e navega com o que já
   * existe: catálogo do cache local (se a lista já foi usada) e biblioteca do perfil (favoritos, lista, histórico).
   * Sem lease e sem reprodução; a marca d'água avisa e a sessão completa volta sozinha quando a fonte responder.
   */
  const enterUnavailable = useCallback(
    async (identity: DeviceIdentity, profiles: Profile[], profile: Profile, alive: () => boolean, known: Space[] | null = null) => {
      const all = known ?? (await backend.listSpaces(profile.id).catch(() => [] as Space[]))
      const scope = `${identity.familyId}:${profile.id}`
      const cached: Array<{ space: Space; result: NonNullable<Awaited<ReturnType<ReturnType<typeof getCatalogCache>['load']>>> }> = []
      for (const space of all) {
        const result = await getCatalogCache().load(scope, space.sourceId).catch(() => null)
        if (result) cached.push({ space, result })
      }
      if (!alive()) return
      const spaces = cached.map((entry) => entry.space)
      const catalog = new CatalogStore(backend, profile.id, spaces)
      for (const { space, result } of cached) catalog.hydrate(space.sourceId, result.sets, result.meta.version, result.sets.adult.length > 0)
      const library = new LibraryStore(backend, identity, profile, (id) => catalog.findLoaded(id))
      await library.load().catch(() => library.markLoaded())
      if (!alive()) return catalog.dispose()
      diag('session', `indisponível: entrando com ${spaces.length} fonte(s) do cache`)
      setState({ status: 'ready', identity, profiles, profile, lease: { id: 'unavailable', profileId: profile.id, expiresAt: 0 }, spaces, spacesError: null, unavailable: true, catalog, library })
    },
    [backend],
  )

  const enter = useCallback(
    async (identity: DeviceIdentity, profiles: Profile[], profile: Profile, options: { pinVerified?: boolean; tryOnly?: boolean } = {}) => {
      const id = ++run.current
      const alive = () => id === run.current
      if (requiresPin(profile, profiles) && !options.pinVerified) {
        setState({ status: 'choosing', identity, profiles, notice: new AppError('profile-locked') })
        return
      }
      const current = stateRef.current
      // Troca de perfil com o app já aberto: só as configurações e os dados do novo perfil (o catálogo vem do cache local).
      const switching = current.status === 'ready' && current.profile.id !== profile.id
      if (current.status === 'ready') {
        current.catalog.dispose()
        if (current.profile.id !== profile.id) await leases.release()
      }
      if (switching) resetViewMemory()
      setState({ status: 'starting', step: switching ? 'profile' : 'account' })
      let lease: Lease
      try {
        lease = await step(leases.acquire(profile.id))
      } catch (raw) {
        if (!alive()) return
        const error = toAppError(raw)
        if (isUnpaired(error)) return void toPairing()
        // Entrada automática no último perfil: PIN exigido pelo servidor → escolha de perfil, sem mensagem de erro.
        if (options.tryOnly && (error.kind === 'profile-locked' || error.kind === 'parental-pin-missing')) {
          setState({ status: 'choosing', identity, profiles, notice: error.kind === 'parental-pin-missing' ? error : null })
          return
        }
        if (error.kind === 'profile-in-use' || error.kind === 'profile-unavailable') {
          setState({ status: 'choosing', identity, profiles, notice: error })
          return
        }
        if (isUnavailable(error)) return void (await enterUnavailable(identity, profiles, profile, alive))
        setState({ status: 'blocked', error, identity, profiles, retryProfile: profile })
        return
      }
      if (!alive()) return
      writeJson(LAST_PROFILE_KEY, { familyId: identity.familyId, profileId: profile.id })
      // Carregamento inicial completo e sem limite de tempo: a navegação só é liberada com tudo
      // pronto (fontes, biblioteca, catálogos de filmes/séries/canais). Imagens seguem sob demanda.
      // Qualquer falha vira erro claro com "Tentar novamente", que recomeça do zero.
      const fail = (raw: unknown, known: Space[] | null = null): void => {
        const error = toAppError(raw)
        if (isUnpaired(error)) return void toPairing()
        if (isUnavailable(error)) return void enterUnavailable(identity, profiles, profile, alive, known)
        setState({ status: 'blocked', error, identity, profiles, retryProfile: profile })
      }
      let spaces: Space[]
      try {
        spaces = await backend.listSpaces(profile.id)
      } catch (raw) {
        if (alive()) fail(raw)
        return
      }
      if (!alive()) return
      // Todas as fontes IPTV do usuário com erro: entra sem conteúdo (marca d'água), sem tocar no nosso servidor.
      if (spaces.length > 0 && spaces.every((space) => space.unavailable)) return void (await enterUnavailable(identity, profiles, profile, alive, spaces))
      const catalog = new CatalogStore(backend, profile.id, spaces)
      const library = new LibraryStore(backend, identity, profile, (id) => catalog.findLoaded(id))
      try {
        await library.load()
      } catch (raw) {
        catalog.dispose()
        if (alive()) fail(raw, spaces)
        return
      }
      if (!alive()) return catalog.dispose()
      const hasKind = (kind: 'movie' | 'series' | 'channel') => spaces.some((space) => space.kinds.includes(kind))
      const loadKinds = async (kinds: Array<'movie' | 'series' | 'channel'>) => {
        const present = kinds.filter(hasKind)
        await Promise.all(present.map((kind) => catalog.ensure(kind, CATALOG.maxPages)))
        for (const kind of present) {
          const error = catalog.errorFor(kind)
          if (error) throw error
        }
      }
      try {
        // Seis conjuntos (cache local + diferenças); o formato paginado só entra se o backend for antigo.
        let prepared = false
        try {
          const results = await syncSources(
            { backend, cache: getCatalogCache(), diag },
            `${identity.familyId}:${profile.id}`,
            profile.id,
            spaces.map((space) => space.sourceId),
            (group) => {
              // O grupo adulto não tem texto próprio na inicialização.
              if (alive() && group !== 'adult' && !switching) setState({ status: 'starting', step: group })
            },
          )
          for (const result of results) {
            catalog.hydrate(result.sourceId, result.sets, result.version, result.adultEnabled)
            diag('sync', `fonte=${result.sourceId.slice(0, 8)} modo=${result.mode} ${result.ms}ms`)
          }
          prepared = true
        } catch (raw) {
          if (toAppError(raw).kind !== 'backend-outdated') throw raw
          diag('sync', 'backend sem seis conjuntos: formato paginado')
        }
        if (!prepared) {
          setState({ status: 'starting', step: 'movies' })
          await loadKinds(['movie'])
          setState({ status: 'starting', step: 'series' })
          await loadKinds(['series'])
          setState({ status: 'starting', step: 'channels' })
          await loadKinds(['channel'])
        }
        // Meu iPlex é preparado junto (telas já carregadas na troca de perfil; biblioteca e catálogo já estão prontos aqui).
        await prefetchScreens()
        if (!switching) {
          if (alive()) setState({ status: 'starting', step: 'done' })
          // O texto final precisa ser legível antes de entrar na interface.
          await new Promise((resolve) => setTimeout(resolve, 400))
        }
      } catch (raw) {
        catalog.dispose()
        if (alive()) fail(raw, spaces)
        return
      }
      if (!alive()) return catalog.dispose()
      setState({ status: 'ready', identity, profiles, profile, lease, spaces, spacesError: null, unavailable: false, catalog, library })
    },
    [backend, leases, toPairing, enterUnavailable],
  )

  const loadProfiles = useCallback(async (identity: DeviceIdentity, alive: () => boolean) => {
    setState({ status: 'starting', step: 'connection' })
    let profiles: Profile[]
    try {
      profiles = sortProfiles(await step(backend.listProfiles()))
    } catch (raw) {
      if (!alive()) return
      const error = toAppError(raw)
      if (isUnpaired(error)) return void toPairing()
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
      // Adulto com infantil na família: sem PIN no cliente, mas o backend valida (sessão por PIN ainda ativa ou não).
      await enter(identity, profiles, decision.profile, decision.tryOnly ? { pinVerified: true, tryOnly: true } : {})
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
      if (isUnpaired(error)) return void toPairing()
      setState({ status: 'blocked', error, identity: current.identity, profiles: current.profiles, retryProfile: current.profile })
    }
  }, [toPairing])

  useEffect(() => {
    diag('session', state.status === 'starting' ? `starting ${state.step}` : state.status === 'blocked' ? `blocked ${state.error.kind} ${state.error.code}` : state.status)
  }, [state])

  useEffect(() => {
    void boot()
    return () => {
      run.current += 1
    }
  }, [boot])

  // Fonte IPTV com erro: confere em silêncio a cada 30 s e, quando ela responder, recarrega a sessão completa.
  const unavailableProfileId = state.status === 'ready' && state.unavailable ? state.profile.id : null
  useEffect(() => {
    if (!unavailableProfileId) return
    const id = setInterval(() => {
      const probe = async () => {
        const spaces = await backend.listSpaces(unavailableProfileId)
        if (spaces.length === 0 || spaces.every((space) => space.unavailable)) throw new AppError('iptv-unavailable', 'still-down')
      }
      probe().then(() => void boot(), () => undefined)
    }, UNAVAILABLE_RETRY_MS)
    return () => clearInterval(id)
  }, [unavailableProfileId, backend, boot])

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
      refreshAccess: () => refreshAccess(true),
      checkDevice: async () => {
        const current = stateRef.current
        if (current.status === 'ready') return leases.checkNow()
        if (current.status !== 'choosing') return
        try {
          await backend.listProfiles()
        } catch (raw) {
          if (isUnpaired(toAppError(raw)) && stateRef.current === current) await toPairing()
        }
      },
      onHeartbeat: (listener) => {
        beatListeners.current.add(listener)
        return () => {
          beatListeners.current.delete(listener)
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
