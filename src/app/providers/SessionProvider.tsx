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
import { decideStartupProfile, requiresPin, sortProfiles, startSection } from '../../features/profiles/profileRules'
import type { HeartbeatResult } from '../../services/api/backend'
import { AppError, isAmbiguousAuthFailure, toAppError } from '../../services/api/errors'
import type { CatalogRecord, DeviceIdentity, Lease, Profile, Space } from '../../services/api/types'
import type { SourceMeta, SourceSets } from '../../services/catalog/catalogCache'
import { CatalogStore } from '../../services/catalog/catalogStore'
import { CATALOG } from '../../config/features'
import { prefetchScreens } from '../screens'
import { resetViewMemory } from '../../features/catalog/viewMemory'
import { getCatalogCache } from '../../services/catalog/catalogCache'
import { openFromCache, streamFromCache, syncSources } from '../../services/catalog/catalogSync'
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
  /** Lista IPTV em uso (a escolhida em Configurações; por padrão a primeira). */
  spaces: Space[]
  /** Todas as listas IPTV cadastradas na conta que este perfil pode usar. */
  allSpaces: Space[]
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
  /** Passa a usar outra lista IPTV e recarrega tudo desde o início. */
  selectSource(sourceId: string): Promise<void>
  /**
   * Atualiza a lista em uso (mesma sincronização manual do Gestor), sem sair da tela: a lista aparece como
   * sincronizando e, ao terminar, o catálogo novo entra em segundo plano.
   */
  syncSource(sourceId: string): Promise<void>
  /**
   * Quem volta a um perfil cuja tela inicial é Meu iPlex pode ver o esqueleto dela durante a inicialização (em vez do
   * texto de etapas). Vale até a inicialização cair no download completo, que volta ao texto de progresso.
   */
  earlySkeleton: boolean
  /** Perfil em que a inicialização está entrando (para desenhar o menu junto do esqueleto). */
  enteringProfile: Profile | null
  /** Respostas do heartbeat (pedido de reprodução pendente). Devolve o cancelamento. */
  onHeartbeat(listener: (result: HeartbeatResult) => void): () => void
}

const LAST_PROFILE_KEY = 'iplex.lastProfile.v1'
const activeSourceKey = (identity: DeviceIdentity, profile: Profile) => `iplex.activeSource.v1.${identity.familyId}.${profile.id}`
const syncTimesKey = (identity: DeviceIdentity, profile: Profile) => `iplex.sourceSync.v1.${identity.familyId}.${profile.id}`

/** Uma lista por vez, como no iPlex Control: a escolhida (se ainda existir) ou a primeira. */
function activeSpaces(all: Space[], identity: DeviceIdentity, profile: Profile): Space[] {
  if (all.length === 0) return []
  const chosen = readJson<string>(activeSourceKey(identity, profile))
  return [all.find((space) => space.sourceId === chosen) ?? all[0]!]
}
const UNAVAILABLE_RETRY_MS = 30_000
/** Andamento de uma sincronização pedida pela TV: consulta a cada 5 s, por até 15 min. */
const SYNC_POLL_MS = 5_000
const SYNC_WATCH_MS = 15 * 60_000

/** Junta o estado de sincronização vindo do servidor às listas da sessão (mesma ordem e seleção). */
function mergeSpaces(spaces: Space[], fresh: Space[]): Space[] {
  return spaces.map((space) => {
    const next = fresh.find((f) => f.sourceId === space.sourceId)
    return next ? { ...space, lastSyncAt: next.lastSyncAt ?? space.lastSyncAt, syncing: next.syncing, unavailable: next.unavailable } : space
  })
}

/** Desvínculo de verdade (revogada/removida no Gestor). Falha ambígua de credencial NÃO desvincula. */
const isUnpaired = (error: AppError) => error.kind === 'device-unpaired' && !isAmbiguousAuthFailure(error)
/**
 * Só a fonte IPTV do usuário com erro entra no app sem conteúdo (marca d'água). Falha do NOSSO servidor
 * (verificação do dispositivo, perfis, conta) barra o app na tela inicial, com "Tentar novamente".
 */
const isUnavailable = (error: AppError) => error.kind === 'iptv-unavailable'
/** Biblioteca que a entrada já começou a ler (evita ler de novo ao cair na entrada sem fonte). */
interface EarlyLibrary {
  library: LibraryStore
  loading: Promise<void>
  attach: (catalog: CatalogStore) => void
}
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
  const returning = useRef(false)
  const entering = useRef<Profile | null>(null)
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
    async (identity: DeviceIdentity, profiles: Profile[], profile: Profile, alive: () => boolean, known: Space[] | null = null, early: EarlyLibrary | null = null) => {
      const registered = known ?? (await backend.listSpaces(profile.id).catch(() => [] as Space[]))
      const all = activeSpaces(registered, identity, profile)
      const scope = `${identity.familyId}:${profile.id}`
      const cache = getCatalogCache()
      // Cache no esquema atual: abre já e os grupos chegam em segundo plano. Cache do esquema antigo: o `load` migra (uma vez).
      const fast: Array<{ space: Space; meta: SourceMeta }> = []
      const legacy: Array<{ space: Space; result: NonNullable<Awaited<ReturnType<typeof cache.load>>> }> = []
      for (const space of all) {
        const meta = await cache.loadMeta(scope, space.sourceId).catch(() => null)
        if (meta) {
          fast.push({ space, meta })
          continue
        }
        const result = await cache.load(scope, space.sourceId).catch(() => null)
        if (result) legacy.push({ space, result })
      }
      if (!alive()) return
      const spaces = [...fast.map((entry) => entry.space), ...legacy.map((entry) => entry.space)]
      const catalog = new CatalogStore(backend, profile.id, spaces)
      for (const { space, meta } of fast) catalog.beginProgressive(space.sourceId, meta.version, meta.counts.adult > 0)
      for (const { space, result } of legacy) catalog.hydrate(space.sourceId, result.sets, result.meta.version, result.sets.adult.length > 0)
      const library = early?.library ?? new LibraryStore(backend, identity, profile, (id) => catalog.findLoaded(id))
      early?.attach(catalog)
      await (early?.loading ?? library.load()).catch(() => library.markLoaded())
      if (!alive()) return catalog.dispose()
      diag('session', `indisponível: entrando com ${spaces.length} fonte(s) do cache`)
      setState({ status: 'ready', identity, profiles, profile, lease: { id: 'unavailable', profileId: profile.id, expiresAt: 0 }, spaces, allSpaces: registered, spacesError: null, unavailable: true, catalog, library })
      for (const { space, meta } of fast) {
        void streamFromCache({ cache, diag }, catalog, scope, space.sourceId, meta, meta.counts.adult > 0)
          .catch(() => null)
          .then((sets) => {
            if (!sets) catalog.finishProgressive(space.sourceId)
          })
      }
    },
    [backend],
  )

  const enter = useCallback(
    async (identity: DeviceIdentity, profiles: Profile[], profile: Profile, options: { pinVerified?: boolean; tryOnly?: boolean } = {}) => {
      const id = ++run.current
      const alive = () => id === run.current
      entering.current = profile
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
      // O código das telas não depende de nada do backend: baixa enquanto o lease é obtido.
      const prefetched = prefetchScreens()
      let catalogRef: CatalogStore | null = null
      const library = new LibraryStore(backend, identity, profile, (id) => catalogRef?.findLoaded(id) ?? null)
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
      writeJson(LAST_PROFILE_KEY, { familyId: identity.familyId, profileId: profile.id, start: startSection(profile) })
      // Carregamento inicial completo e sem limite de tempo: a navegação só é liberada com tudo
      // pronto (fontes, biblioteca, catálogos de filmes/séries/canais). Imagens seguem sob demanda.
      // Qualquer falha vira erro claro com "Tentar novamente", que recomeça do zero.
      const fail = (raw: unknown, known: Space[] | null = null): void => {
        const error = toAppError(raw)
        if (isUnpaired(error)) return void toPairing()
        if (isUnavailable(error)) return void enterUnavailable(identity, profiles, profile, alive, known)
        setState({ status: 'blocked', error, identity, profiles, retryProfile: profile })
      }
      // O backend só atende espaços e biblioteca com o lease ativo (session-expired sem ele): depois do lease,
      // os dois são independentes e saem juntos.
      const listing = backend.listSpaces(profile.id)
      const loadingLibrary = library.load()
      for (const started of [listing, loadingLibrary]) started.catch(() => undefined)
      const early: EarlyLibrary = { library, loading: loadingLibrary, attach: (catalog) => void (catalogRef = catalog) }
      let spaces: Space[]
      let registered: Space[]
      try {
        registered = await listing
        spaces = activeSpaces(registered, identity, profile)
      } catch (raw) {
        if (alive()) fail(raw)
        return
      }
      if (!alive()) return
      // Todas as fontes IPTV do usuário com erro: entra sem conteúdo (marca d'água), sem tocar no nosso servidor.
      if (spaces.length > 0 && spaces.every((space) => space.unavailable)) return void (await enterUnavailable(identity, profiles, profile, alive, registered, early))
      const catalog = new CatalogStore(backend, profile.id, spaces)
      catalogRef = catalog
      try {
        await loadingLibrary
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
      let background: (() => Promise<void>) | null = null
      try {
        // Seis conjuntos (cache local + diferenças); o formato paginado só entra se o backend for antigo.
        let prepared = false
        try {
          const syncDeps = { backend, cache: getCatalogCache(), diag }
          const scope = `${identity.familyId}:${profile.id}`
          const sourceIds = spaces.map((space) => space.sourceId)
          // Cache válido (esquema atual e mesmas permissões): a interface abre já e os grupos chegam em segundo plano.
          const open = await openFromCache(syncDeps, scope, profile.id, sourceIds)
          if (open) {
            for (const entry of open) catalog.beginProgressive(entry.sourceId, entry.meta.version, entry.manifest?.adultEnabled === true)
            background = async () => {
              try {
                const preloaded = new Map<string, { meta: SourceMeta; sets: SourceSets }>()
                for (const entry of open) {
                  const sets = await streamFromCache(syncDeps, catalog, scope, entry.sourceId, entry.meta, entry.manifest?.adultEnabled === true)
                  if (!alive()) return
                  if (sets) preloaded.set(entry.sourceId, { meta: entry.meta, sets })
                }
                // Versão nova (ou cache corrompido): diferenças/baixa completa em segundo plano e troca de uma vez.
                if (open.some((entry) => !preloaded.has(entry.sourceId) || entry.manifest?.version !== entry.meta.version)) {
                  const results = await syncSources({ ...syncDeps, preloaded }, scope, profile.id, sourceIds)
                  if (!alive()) return
                  for (const result of results) {
                    await catalog.hydrateAsync(result.sourceId, result.sets, result.version, result.adultEnabled)
                    diag('sync', `fonte=${result.sourceId.slice(0, 8)} modo=${result.mode} ${result.ms}ms (segundo plano)`)
                  }
                }
                if (alive()) writeJson(syncTimesKey(identity, profile), { ...(readJson<Record<string, number>>(syncTimesKey(identity, profile)) ?? {}), ...Object.fromEntries(sourceIds.map((sourceId) => [sourceId, Date.now()])) })
              } catch (raw) {
                diag('sync', `segundo plano falhou: ${toAppError(raw).kind}`)
                for (const sourceId of sourceIds) catalog.finishProgressive(sourceId)
              }
            }
            prepared = true
          } else {
            returning.current = false
            const results = await syncSources(syncDeps, scope, profile.id, sourceIds, (group) => {
              // O grupo adulto não tem texto próprio na inicialização.
              if (alive() && group !== 'adult' && !switching) setState({ status: 'starting', step: group })
            })
            for (const result of results) {
              catalog.hydrate(result.sourceId, result.sets, result.version, result.adultEnabled)
              diag('sync', `fonte=${result.sourceId.slice(0, 8)} modo=${result.mode} ${result.ms}ms`)
            }
            prepared = true
          }
        } catch (raw) {
          if (toAppError(raw).kind !== 'backend-outdated') throw raw
          diag('sync', 'backend sem seis conjuntos: formato paginado')
          returning.current = false
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
        await prefetched
        if (!switching && !background) {
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
      if (!background) writeJson(syncTimesKey(identity, profile), { ...(readJson<Record<string, number>>(syncTimesKey(identity, profile)) ?? {}), ...Object.fromEntries(spaces.map((space) => [space.sourceId, Date.now()])) })
      setState({ status: 'ready', identity, profiles, profile, lease, spaces, allSpaces: registered, spacesError: null, unavailable: false, catalog, library })
      if (background) void background()
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
    const hint = readJson<{ familyId: string; profileId: string; start?: string }>(LAST_PROFILE_KEY)
    returning.current = hint?.familyId === identity.familyId && hint.start === 'my-iplex'
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
        const current = stateRef.current
        const spaces = current.status === 'ready' ? activeSpaces(await backend.listSpaces(unavailableProfileId), current.identity, current.profile) : await backend.listSpaces(unavailableProfileId)
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
      earlySkeleton: returning.current,
      enteringProfile: entering.current,
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
      selectSource: async (sourceId) => {
        const current = stateRef.current
        if (current.status !== 'ready') return
        writeJson(activeSourceKey(current.identity, current.profile), sourceId)
        await enter(current.identity, current.profiles, current.profile, { pinVerified: true })
      },
      syncSource: async (sourceId) => {
        const current = stateRef.current
        if (current.status !== 'ready') return
        await backend.syncSource(sourceId)
        const mark = (spaces: Space[]) => spaces.map((space) => (space.sourceId === sourceId ? { ...space, syncing: true } : space))
        setState({ ...current, spaces: mark(current.spaces), allSpaces: mark(current.allSpaces) })
        diag('sync', `lista ${sourceId} pedida pela TV`)
        const profileId = current.profile.id
        void (async () => {
          const until = Date.now() + SYNC_WATCH_MS
          while (Date.now() < until) {
            await new Promise((resolve) => setTimeout(resolve, SYNC_POLL_MS))
            const now = stateRef.current
            if (now.status !== 'ready' || now.profile.id !== profileId) return
            let fresh: Space[]
            try {
              fresh = await backend.listSpaces(profileId)
            } catch {
              continue
            }
            const latest = stateRef.current
            if (latest.status !== 'ready' || latest.profile.id !== profileId) return
            setState({ ...latest, spaces: mergeSpaces(latest.spaces, fresh), allSpaces: mergeSpaces(latest.allSpaces, fresh) })
            if (fresh.find((space) => space.sourceId === sourceId)?.syncing) continue
            diag('sync', `lista ${sourceId} sincronizada; catálogo novo em segundo plano`)
            // Mesmo caminho da mudança de permissões: baixa só o que mudou e atualiza as telas sozinho.
            await refreshAccess(true)
            return
          }
        })()
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
