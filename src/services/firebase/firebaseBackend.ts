/**
 * Backend real: projeto Firebase iplex-2c8fc.
 *  - Callable `manager` (us-central1, App Check obrigatório) do repositório do Gestor;
 *  - Firebase Auth: credencial do dispositivo via custom token (uid tv_<deviceId>,
 *    claims deviceId/familyId) emitido em finishDevicePair;
 *  - Firestore (lite, somente leitura): biblioteca do perfil, que as regras
 *    liberam ao Player pareado (families/{fid}/profiles/{pid}/...).
 * Nenhuma credencial administrativa ou IPTV passa pelo navegador.
 */
import { initializeApp, type FirebaseApp } from 'firebase/app'
import { getToken, initializeAppCheck, ReCaptchaEnterpriseProvider, type AppCheck } from 'firebase/app-check'
import {
  browserLocalPersistence,
  indexedDBLocalPersistence,
  initializeAuth,
  signInWithCustomToken,
  signOut,
  type Auth,
} from 'firebase/auth'
import { getFunctions, httpsCallable, type Functions } from 'firebase/functions'
import { APP_CHECK_DEBUG_TOKEN, APP_CHECK_SITE_KEY, FUNCTIONS_REGION, type FirebaseWebConfig } from '../../config/env'
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

interface Context {
  app: FirebaseApp
  auth: Auth
  functions: Functions
  appCheck: AppCheck | null
}

export function createFirebaseBackend(config: FirebaseWebConfig): Backend {
  let ctx: Context | null = null
  const context = (): Context => {
    if (ctx) return ctx
    const app = initializeApp(config)
    let appCheck: AppCheck | null = null
    if (APP_CHECK_SITE_KEY) {
      if (APP_CHECK_DEBUG_TOKEN) (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN?: string }).FIREBASE_APPCHECK_DEBUG_TOKEN = APP_CHECK_DEBUG_TOKEN
      appCheck = initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(APP_CHECK_SITE_KEY), isTokenAutoRefreshEnabled: true })
    }
    const auth = initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] })
    const functions = getFunctions(app, FUNCTIONS_REGION)
    ctx = { app, auth, functions, appCheck }
    return ctx
  }

  async function call<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
    const { functions, auth } = context()
    try {
      const manager = httpsCallable<{ action: string; payload: Record<string, unknown> }, T>(functions, 'manager', { timeout: 60000 })
      const result = await manager({ action, payload })
      return result.data
    } catch (error) {
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

  async function firestore() {
    const [{ getFirestore, collection, doc, getDoc, getDocs, limit, orderBy, query }] = await Promise.all([import('firebase/firestore/lite')])
    return { db: getFirestore(context().app), collection, doc, getDoc, getDocs, limit, orderBy, query }
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
      const { appCheck } = context()
      if (!appCheck) return null
      try {
        return (await getToken(appCheck, false)).token
      } catch {
        return null
      }
    },

    async listProfiles(): Promise<Profile[]> {
      try {
        const { profiles } = await call<{ profiles: Profile[] }>('listPlayerProfiles')
        return profiles
      } catch (error) {
        if (!(error instanceof AppError) || error.kind !== 'backend-outdated') throw error
      }
      // Backend anterior (sem listPlayerProfiles): as regras do Firestore liberam
      // ao Player pareado a leitura dos perfis da própria família. Perfis sem
      // tipo são "regular" (mesma regra de profileView no backend novo); o
      // acesso a cada perfil continua validado no acquireSession.
      const identity = await identityFromUser()
      if (!identity) throw new AppError('device-unpaired', 'claims-missing')
      try {
        const { db, collection, getDocs } = await firestore()
        const docs = (await getDocs(collection(db, 'families', identity.familyId, 'profiles'))).docs
        return docs
          .map((d): Record<string, unknown> & { id: string } => ({ ...(d.data() as Record<string, unknown>), id: d.id }))
          .filter((d) => d.enabled !== false && d.deleting !== true && (d.type !== 'guest' || d.enabled === true))
          .map((d) => {
            const g = (d.generations ?? {}) as Partial<Generations>
            const type = (['admin', 'regular', 'kids', 'guest'] as const).includes(d.type as never) ? (d.type as Profile['type']) : 'regular'
            return {
              id: d.id,
              name: String(d.name ?? ''),
              type,
              generations: { favorites: g.favorites ?? 0, watched: g.watched ?? 0, progress: g.progress ?? 0 },
              permissionsVersion: Number(d.permissionsVersion) || 0,
            }
          })
      } catch (error) {
        throw toAppError(error)
      }
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

    async readGenerations(identity: DeviceIdentity, profileId: string): Promise<Generations | null> {
      try {
        const { db, doc, getDoc } = await firestore()
        const snap = await getDoc(doc(db, 'families', identity.familyId, 'profiles', profileId))
        const data = snap.data() as { generations?: Partial<Generations> } | undefined
        if (!data) return null
        return { favorites: data.generations?.favorites ?? 0, watched: data.generations?.watched ?? 0, progress: data.generations?.progress ?? 0 }
      } catch (error) {
        throw toAppError(error)
      }
    },

    async readLibrary(identity: DeviceIdentity, profileId: string): Promise<Library> {
      try {
        const { db, collection, getDocs, limit, orderBy, query } = await firestore()
        const base = ['families', identity.familyId, 'profiles', profileId] as const
        const read = async (name: string) =>
          (await getDocs(query(collection(db, ...base, name), orderBy('updatedAt', 'desc'), limit(100)))).docs.map((d) => d.data())
        const readWatched = async () =>
          (await getDocs(query(collection(db, ...base, 'watched'), orderBy('completedAt', 'desc'), limit(100)))).docs.map((d) => d.data())
        const [favorites, progress, watched] = await Promise.all([read('favorites'), read('watch_progress'), readWatched()])
        return {
          favorites: favorites.map(entry),
          progress: progress.map(
            (d): ProgressEntry => ({
              contentId: String(d.contentId),
              position: Number(d.position) || 0,
              duration: Number(d.duration) || 0,
              generation: Number(d.generation) || 0,
              updatedAt: Number(d.updatedAt) || 0,
            }),
          ),
          watched: watched.map((d) => ({ ...entry(d), updatedAt: Number(d.completedAt) || 0 })),
        }
      } catch (error) {
        throw toAppError(error)
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
