/**
 * Backend real: projeto Firebase iplex-2c8fc.
 *  - Callable `player` (us-central1) do repositório do Gestor: endpoint do
 *    Player, SEM App Check (o reCAPTCHA é incompatível com o Tizen 5.5) e com
 *    lista fechada de ações + credencial de dispositivo verificada no servidor.
 *    A callable `manager` (com App Check) continua exclusiva do Gestor;
 *  - Firebase Auth: credencial do dispositivo via custom token (uid tv_<deviceId>,
 *    claims deviceId/familyId) emitido em finishDevicePair;
 *  - Biblioteca e gerações pela callable, com autorização do perfil ativo.
 *    O Web não lê o Firestore diretamente.
 * Nenhuma credencial administrativa passa pelo navegador. URLs individuais
 * de reprodução podem conter credenciais do provedor e não devem ser registradas.
 */
import { initializeApp, type FirebaseApp } from 'firebase/app'
import {
  browserLocalPersistence,
  connectAuthEmulator,
  indexedDBLocalPersistence,
  initializeAuth,
  signInWithCustomToken,
  signOut,
  type Auth,
} from 'firebase/auth'
import { connectFunctionsEmulator, getFunctions, httpsCallable, type Functions } from 'firebase/functions'
import { EMULATOR_HOST, FUNCTIONS_REGION, type FirebaseWebConfig } from '../../config/env'
import type { Backend, CatalogQuery, HeartbeatResult, PairingRequest, ProgressWrite } from '../api/backend'
import { AppError, isAmbiguousAuthFailure, toAppError } from '../api/errors'
import type {
  AccountIdentity,
  CatalogCategory,
  CatalogItem,
  CatalogChunk,
  CatalogDelta,
  CatalogManifest,
  CatalogPage,
  CatalogSetName,
  DeviceIdentity,
  EpgResult,
  Generations,
  Lease,
  Library,
  LibraryEntry,
  PairingPoll,
  PairingSession,
  PinCheck,
  PlayRequestClaim,
  Profile,
  ProgressEntry,
  SeriesDetails,
  Space,
  StreamGrant,
} from '../api/types'
import { normalizeSeriesDetails } from '../catalog/normalize'
import { parseAccountIdentity, parseHeartbeat, parsePinCheck, parsePlayRequestClaim, parseProfiles } from '../api/validation'
import { diag } from '../../platform/diagnostics'

interface Context {
  app: FirebaseApp
  auth: Auth
  functions: Functions
}

/** Callable do Player no backend (repositório do Gestor). */
export const PLAYER_CALLABLE = 'player'

let shared: Backend | null = null
/** Uma só instância por página: a pré-aquecida em main.tsx é a mesma que a interface usa. */
export function sharedFirebaseBackend(config: FirebaseWebConfig): Backend {
  return (shared ??= createFirebaseBackend(config))
}

export function createFirebaseBackend(config: FirebaseWebConfig): Backend {
  let ctx: Context | null = null
  let account: AccountIdentity | null = null
  const context = (): Context => {
    if (ctx) return ctx
    const app = initializeApp(config)
    const auth = initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] })
    const functions = getFunctions(app, FUNCTIONS_REGION)
    if (import.meta.env.MODE === 'emulator' && EMULATOR_HOST) {
      connectAuthEmulator(auth, `http://${EMULATOR_HOST}:9099`, { disableWarnings: true })
      connectFunctionsEmulator(functions, EMULATOR_HOST, 5001)
    }
    ctx = { app, auth, functions }
    return ctx
  }

  async function call<T>(action: string, payload: Record<string, unknown> = {}, recheck = true): Promise<T> {
    const { functions, auth } = context()
    try {
      const player = httpsCallable<{ action: string; payload: Record<string, unknown> }, T>(functions, PLAYER_CALLABLE, { timeout: 60000 })
      const bytes = crypto.getRandomValues(new Uint8Array(16))
      const requestId = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
      const result = await player({ action, payload: { ...payload, requestId, issuedAt: Date.now() } })
      diag('call', `${action} ok`)
      return result.data
    } catch (error) {
      const e = error as { code?: string; message?: string }
      diag('call', `${action} fail ${e?.code ?? ''} ${e?.message ?? ''}`)
      const mapped = toAppError(error, { authenticated: !!auth.currentUser })
      if (isAmbiguousAuthFailure(mapped) && auth.currentUser) {
        // Não desvincula por um erro ambíguo: renova a credencial e tenta uma vez; se persistir, é
        // falha recuperável ("tentar novamente"), nunca um pedido para vincular de novo.
        if (recheck) {
          await auth.currentUser.getIdToken(true).catch(() => undefined)
          return call<T>(action, payload, false)
        }
        throw new AppError('server-unavailable', `auth-unconfirmed:${mapped.code}`)
      }
      throw mapped
    }
  }

  async function restore(): Promise<DeviceIdentity | null> {
    const started = performance.now()
    const { auth } = context()
    try {
      await auth.authStateReady()
      diag('auth', `ready ${Math.round(performance.now() - started)}ms`)
      const identity = await identityFromUser()
      diag('auth', `identity ${Math.round(performance.now() - started)}ms`)
      return identity
    } catch (error) {
      throw toAppError(error)
    }
  }
  let warmed: Promise<DeviceIdentity | null> | null = null

  async function identityFromUser(): Promise<DeviceIdentity | null> {
    const { auth } = context()
    const user = auth.currentUser
    if (!user) return null
    const token = await user.getIdTokenResult()
    const deviceId = token.claims.deviceId
    const familyId = token.claims.familyId
    if (typeof deviceId !== 'string' || typeof familyId !== 'string' || user.uid !== `tv_${deviceId}`) {
      // Sessão que não é de dispositivo pareado: nunca é usada como Player.
      await signOut(auth)
      return null
    }
    return { deviceId, familyId }
  }

  return {
    label: 'firebase',

    async restoreDevice() {
      // Reaproveita, uma única vez, a restauração iniciada por warmUp (depois disso cada chamada confere de novo).
      if (warmed) {
        const early = warmed
        warmed = null
        return early
      }
      return restore()
    },

    warmUp() {
      if (warmed) return
      warmed = restore()
      warmed.catch(() => undefined)
    },

    async beginPairing(request: PairingRequest): Promise<PairingSession> {
      const result = await call<Partial<PairingSession>>('beginDevicePair', { ...request })
      if (!result?.token || typeof result.expiresAt !== 'number') throw new AppError('server-unavailable', 'pairing-invalid-response')
      return {
        token: result.token,
        expiresAt: result.expiresAt,
        code: typeof result.code === 'string' ? result.code : null,
        formattedCode: typeof result.formattedCode === 'string' ? result.formattedCode : null,
        deviceId: typeof result.deviceId === 'string' ? result.deviceId : null,
      }
    },

    async pollPairing(token: string): Promise<PairingPoll> {
      try {
        const { customToken } = await call<{ customToken: string }>('finishDevicePair', { token })
        const { auth } = context()
        await signInWithCustomToken(auth, customToken)
        const identity = await identityFromUser()
        if (!identity) throw new AppError('device-unpaired', 'claims-missing')
        return { status: 'linked', identity }
      } catch (error) {
        const appError = toAppError(error, { authenticated: false })
        if (appError.kind === 'pairing-pending') return { status: 'pending' }
        if (appError.kind === 'pairing-expired') return { status: 'expired' }
        throw appError
      }
    },

    async forgetDevice() {
      await signOut(context().auth)
    },

    async getIdToken() {
      const user = context().auth.currentUser
      return user ? user.getIdToken() : null
    },

    async getAppCheckToken() {
      // O Web não usa App Check (ver docs/AUDITORIA-APP-CHECK-TV.md).
      return null
    },

    async listProfiles(): Promise<Profile[]> {
      const raw = await call<unknown>('listPlayerProfiles')
      const profiles = parseProfiles(raw)
      account = parseAccountIdentity(raw)
      return profiles
    },

    accountIdentity() {
      return account
    },

    async verifyAdultPin(profileId: string, pin: string): Promise<PinCheck> {
      return parsePinCheck(await call<unknown>('verifyAdultPin', { profileId, pin }))
    },

    async verifyProfilePin(profileId: string, pin: string): Promise<PinCheck> {
      // O PIN vai só para o backend (HTTPS) e é descartado; o resultado é validado aqui.
      return parsePinCheck(await call<unknown>('verifyProfilePin', { profileId, pin }))
    },

    async acquireSession(profileId: string): Promise<Lease> {
      const lease = await call<{ id: string; profileId: string; expiresAt: number }>('acquireSession', { profileId })
      return { id: lease.id, profileId: lease.profileId, expiresAt: lease.expiresAt }
    },
    async reportPlayback(input) {
      await call('reportPlayback', { ...input })
    },

    async heartbeat(sessionId: string): Promise<HeartbeatResult> {
      return parseHeartbeat(await call<unknown>('heartbeat', { sessionId }))
    },
    async releaseSession(sessionId: string, options?: { suspend?: boolean }) {
      await call('releaseSession', { sessionId, ...(options?.suspend ? { suspend: true } : {}) })
    },

    watchPlayRequests(identity, onPending, onError, onAccess) {
      let stop: (() => void) | null = null
      let closed = false
      // Firestore só é carregado quando a TV está pareada (chunk separado).
      void import('./playRequestListener')
        .then(({ listenPlayRequests }) => {
          if (closed) return
          stop = listenPlayRequests(context().app, identity, onPending, onError, onAccess)
        })
        .catch(() => onError('unavailable'))
      return () => {
        closed = true
        stop?.()
      }
    },
    async claimPlayRequest(id: string): Promise<PlayRequestClaim> {
      return parsePlayRequestClaim(await call<unknown>('claimPlayRequest', { playRequestId: id }))
    },
    async updatePlayRequest(id, status, errorCode) {
      await call('updatePlayRequest', { playRequestId: id, status, ...(errorCode ? { errorCode } : {}) })
    },

    async listSpaces(profileId: string): Promise<Space[]> {
      const { spaces } = await call<{ spaces: Space[] }>('listProfileSpaces', { profileId })
      return spaces
    },

    async readCatalog(profileId: string, q: CatalogQuery): Promise<CatalogPage> {
      const raw = await call<{
        version: string
        items: CatalogItem[]
        categories?: CatalogCategory[]
        cursor: number
        hasMore: boolean
      }>('readSourceCatalog', {
        id: q.sourceId,
        profileId,
        cursor: q.cursor ?? 0,
        ...(q.search ? { search: q.search } : {}),
      })
      return {
        version: raw.version,
        items: raw.items.map((item) => ({ ...item, sourceId: q.sourceId })),
        categories: raw.categories ?? [],
        cursor: raw.cursor,
        hasMore: raw.hasMore,
      }
    },

    async readCatalogManifest(profileId: string, sourceId: string): Promise<CatalogManifest> {
      return call<CatalogManifest>('readCatalogManifest', { id: sourceId, profileId })
    },

    async readCatalogChunk(profileId: string, sourceId: string, set: CatalogSetName, n: number, version: string): Promise<CatalogChunk> {
      return call<CatalogChunk>('readCatalogChunk', { id: sourceId, profileId, set, n, version })
    },

    async readCatalogDelta(profileId: string, sourceId: string, from: string): Promise<CatalogDelta> {
      return call<CatalogDelta>('readCatalogDelta', { id: sourceId, profileId, from })
    },

    async readSeries(profileId: string, sourceId: string, seriesId: string): Promise<SeriesDetails | null> {
      const raw = await call<{ seriesId: string; details: unknown }>('readSourceSeries', { id: sourceId, seriesId, profileId })
      return normalizeSeriesDetails(raw.seriesId, raw.details)
    },

    async readEpg(sourceId: string, channelId: string): Promise<EpgResult> {
      try {
        const raw = await call<{ programmes?: unknown }>('readSourceEpg', { id: sourceId, channelId })
        const programmes = Array.isArray(raw?.programmes) ? raw.programmes : []
        return {
          supported: true,
          programmes: programmes
            .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object')
            .filter((p) => typeof p.startAt === 'number' && typeof p.endAt === 'number')
            .map((p) => ({
              channelId: String(p.channelId ?? channelId),
              title: typeof p.title === 'string' ? p.title : '',
              startAt: p.startAt as number,
              endAt: p.endAt as number,
              description: typeof p.description === 'string' ? p.description : '',
            })),
        }
      } catch (error) {
        // Backend anterior (sem EPG para TVs) ou fonte sem guia: nada é inventado.
        const e = toAppError(error)
        if (e.kind === 'backend-outdated' || e.kind === 'content-unavailable' || e.kind === 'source-locked') return { supported: false }
        throw e
      }
    },

    async resolveStream(profileId: string, input): Promise<StreamGrant> {
      return call<StreamGrant>('resolveSourceStream', {
        id: input.sourceId,
        itemId: input.itemId,
        profileId,
        ...(input.episodeId ? { episodeId: input.episodeId } : {}),
      })
    },

    async readGenerations(_identity: DeviceIdentity, profileId: string): Promise<Generations | null> {
      return call<Generations>('readPlayerGenerations', { profileId })
    },

    async readLibrary(_identity: DeviceIdentity, profileId: string): Promise<Library> {
      const { favorites, progress, watched, wishlist = [] } = await call<Record<string, Record<string, unknown>[]>>('readPlayerLibrary', { profileId })
      return {
        favorites: favorites.map(entry),
        wishlist: wishlist.map(entry),
        progress: progress.map((d): ProgressEntry => ({
          contentId: String(d.contentId), position: Number(d.position) || 0, duration: Number(d.duration) || 0,
          generation: Number(d.generation) || 0, updatedAt: Number(d.updatedAt) || 0,
        })),
        watched: watched.map((d) => ({ ...entry(d), updatedAt: Number(d.completedAt) || 0 })),
      }
    },

    async setFavorite({ profileId, contentId, title, generation, remove }) {
      await call('favorite', { profileId, contentId, title: title.slice(0, 80), generation, ...(remove ? { remove: true } : {}) })
    },

    async setWishlist(input) {
      await call('wishlist', input)
    },

    async saveProgress(input: ProgressWrite) {
      return call<{ ignored?: string }>('watchProgress', {
        profileId: input.profileId,
        contentId: input.contentId,
        position: input.positionSec,
        duration: input.durationSec,
        generation: input.generation,
        ...(input.watchedGeneration !== undefined ? { watchedGeneration: input.watchedGeneration } : {}),
        ...(input.session ?? {}),
      })
    },

    async markWatched({ profileId, contentId, title, generation }) {
      await call('markWatched', { profileId, contentId, title: title.slice(0, 80), generation })
    },
  }
}

function entry(d: Record<string, unknown>): LibraryEntry {
  return {
    contentId: String(d.contentId),
    title: typeof d.title === 'string' ? d.title : null,
    generation: Number(d.generation) || 0,
    updatedAt: Number(d.updatedAt) || 0,
  }
}
