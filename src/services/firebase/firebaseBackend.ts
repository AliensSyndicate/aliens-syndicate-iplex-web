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
import { initializeApp } from 'firebase/app'
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
import type { Backend, CatalogQuery, PairingRequest, ProgressWrite } from '../api/backend'
import { AppError, toAppError } from '../api/errors'
import type {
  CatalogCategory,
  CatalogItem,
  CatalogPage,
  DeviceIdentity,
  EpgResult,
  Generations,
  Lease,
  Library,
  LibraryEntry,
  PairingPoll,
  PairingSession,
  Profile,
  ProgressEntry,
  SeriesDetails,
  Space,
  StreamGrant,
} from '../api/types'
import { normalizeSeriesDetails } from '../catalog/normalize'
import { diag } from '../../platform/diagnostics'

interface Context {
  auth: Auth
  functions: Functions
}

/** Callable do Player no backend (repositório do Gestor). */
export const PLAYER_CALLABLE = 'player'

export function createFirebaseBackend(config: FirebaseWebConfig): Backend {
  let ctx: Context | null = null
  const context = (): Context => {
    if (ctx) return ctx
    const app = initializeApp(config)
    const auth = initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] })
    const functions = getFunctions(app, FUNCTIONS_REGION)
    if (import.meta.env.MODE === 'emulator' && EMULATOR_HOST) {
      connectAuthEmulator(auth, `http://${EMULATOR_HOST}:9099`, { disableWarnings: true })
      connectFunctionsEmulator(functions, EMULATOR_HOST, 5001)
    }
    ctx = { auth, functions }
    return ctx
  }

  async function call<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
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
      throw toAppError(error, { authenticated: !!auth.currentUser })
    }
  }

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
      const { auth } = context()
      try {
        await auth.authStateReady()
        return await identityFromUser()
      } catch (error) {
        throw toAppError(error)
      }
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
      const { profiles } = await call<{ profiles: Profile[] }>('listPlayerProfiles')
      return profiles
    },

    async verifyProfilePin() {
      // O backend atual não tem PIN de perfil. Falha fechada: nunca validar no cliente.
      throw new AppError('not-supported', 'profile-pin-unsupported')
    },

    async acquireSession(profileId: string): Promise<Lease> {
      const lease = await call<{ id: string; profileId: string; expiresAt: number }>('acquireSession', { profileId })
      return { id: lease.id, profileId: lease.profileId, expiresAt: lease.expiresAt }
    },
    async heartbeat(sessionId: string) {
      await call('heartbeat', { sessionId })
    },
    async releaseSession(sessionId: string) {
      await call('releaseSession', { sessionId })
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

    async readSeries(profileId: string, sourceId: string, seriesId: string): Promise<SeriesDetails | null> {
      const raw = await call<{ seriesId: string; details: unknown }>('readSourceSeries', { id: sourceId, seriesId, profileId })
      return normalizeSeriesDetails(raw.seriesId, raw.details)
    },

    async readEpg(): Promise<EpgResult> {
      // readSourceEpg do backend aceita só contas de pessoa (iptvWorkspace recusa
      // dispositivos). Sem EPG para a TV até o backend liberar: nada é inventado.
      return { supported: false }
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
      const { favorites, progress, watched } = await call<Record<string, Record<string, unknown>[]>>('readPlayerLibrary', { profileId })
      return {
        favorites: favorites.map(entry),
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

    async saveProgress(input: ProgressWrite) {
      await call('watchProgress', {
        profileId: input.profileId,
        contentId: input.contentId,
        position: input.positionSec,
        duration: input.durationSec,
        generation: input.generation,
        ...(input.watchedGeneration !== undefined ? { watchedGeneration: input.watchedGeneration } : {}),
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
