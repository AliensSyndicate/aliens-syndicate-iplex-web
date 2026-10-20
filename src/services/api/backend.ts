/**
 * Contrato entre a interface e o backend. Implementações:
 *  - services/firebase/firebaseBackend.ts — real (callable `manager`, Auth, Firestore);
 *  - dev/mock/mockBackend.ts — só desenvolvimento, isolado e identificado.
 *
 * Toda decisão de acesso (dispositivo, assinatura, perfil, conteúdo, sessão)
 * acontece no backend. O cliente apenas reflete as respostas.
 */
import type {
  CatalogPage,
  ContentKind,
  DeviceIdentity,
  EpgResult,
  Lease,
  Library,
  PairingPoll,
  PairingSession,
  Profile,
  SeriesDetails,
  Space,
  StreamGrant,
} from './types'

export interface PairingRequest {
  name: string
  platform: 'tizen' | 'webos' | 'android_tv'
  manufacturer?: string
  model?: string
  /** Dica da plataforma (installationId do shell). Nunca prova de identidade. */
  nativeDeviceId?: string
  identitySource?: string
  identityScope?: string
  identityStability?: string
}

export interface CatalogQuery {
  sourceId: string
  cursor?: number
  search?: string
  /** Filtros desejados. O backend atual ainda não filtra por eles: o cliente filtra. */
  kind?: ContentKind
}

export interface ProgressWrite {
  profileId: string
  contentId: string
  positionSec: number
  durationSec: number
  generation: number
  watchedGeneration?: number
}

export interface Backend {
  readonly label: 'firebase' | 'mock'
  /** Restaura a credencial do dispositivo (Firebase Auth persistido). null = não pareado. */
  restoreDevice(): Promise<DeviceIdentity | null>
  beginPairing(request: PairingRequest): Promise<PairingSession>
  pollPairing(token: string): Promise<PairingPoll>
  /** Esquece a credencial local (após revogação no backend). */
  forgetDevice(): Promise<void>
  /** ID token para os endpoints internos (/api/tmdb). */
  getIdToken(): Promise<string | null>
  getAppCheckToken(): Promise<string | null>

  listProfiles(): Promise<Profile[]>
  /** Validação de PIN de perfil. O backend real ainda não oferece: rejeita com not-supported. */
  verifyProfilePin(profileId: string, pin: string): Promise<boolean>

  acquireSession(profileId: string): Promise<Lease>
  heartbeat(sessionId: string): Promise<void>
  releaseSession(sessionId: string): Promise<void>

  listSpaces(profileId: string): Promise<Space[]>
  readCatalog(profileId: string, query: CatalogQuery): Promise<CatalogPage>
  readSeries(profileId: string, sourceId: string, seriesId: string): Promise<SeriesDetails | null>
  readEpg(sourceId: string, channelId: string): Promise<EpgResult>
  resolveStream(profileId: string, input: { sourceId: string; itemId: string; episodeId?: string }): Promise<StreamGrant>

  readLibrary(identity: DeviceIdentity, profileId: string): Promise<Library>
  readGenerations(identity: DeviceIdentity, profileId: string): Promise<Profile['generations'] | null>
  setFavorite(input: { profileId: string; contentId: string; title: string; generation: number; remove: boolean }): Promise<void>
  saveProgress(input: ProgressWrite): Promise<void>
  markWatched(input: { profileId: string; contentId: string; title: string; generation: number }): Promise<void>
}
