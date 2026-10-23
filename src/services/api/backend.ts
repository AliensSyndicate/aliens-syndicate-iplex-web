/**
 * Contrato entre a interface e o backend. Implementações:
 *  - services/firebase/firebaseBackend.ts — real (callable `manager`, Auth, Firestore);
 *  - dev/mock/mockBackend.ts — só desenvolvimento, isolado e identificado.
 *
 * Toda decisão de acesso (dispositivo, assinatura, perfil, conteúdo, sessão)
 * acontece no backend. O cliente apenas reflete as respostas.
 */
import type {
  AccountIdentity,
  CatalogChunk,
  CatalogDelta,
  CatalogManifest,
  CatalogPage,
  CatalogSetName,
  ContentKind,
  DeviceIdentity,
  EpgResult,
  Lease,
  Library,
  PinCheck,
  PlayRequestClaim,
  PlayRequestErrorCode,
  PlayRequestNotice,
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
  /** Sessão de reprodução (ver progressSession.ts). */
  session?: { playId: string; startedAt: number; seq: number; origin: 'start' | 'resume' | 'restart'; userSeek?: true }
}

/** `ignored`: o backend descartou o evento (atrasado, fora de ordem, inicialização, retomada não aplicada). */
export interface ProgressResult {
  ignored?: string
}

export interface PlaybackStatusWrite {
  sessionId: string
  sourceId: string
  itemId: string
  episodeId?: string
  state: 'playing' | 'paused' | 'stopped'
  positionSec?: number
  durationSec?: number
}

export interface HeartbeatResult {
  playRequest: { id: string; expiresAt: number } | null
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
  /** Conta vinculada à TV, vinda da última listagem de perfis (null = ainda desconhecida ou sem dado). */
  accountIdentity(): AccountIdentity | null
  /**
   * PIN parental (perfil adulto quando há perfil infantil). Validado no backend,
   * com limite de tentativas; o acquireSession seguinte é liberado só para este perfil.
   */
  verifyProfilePin(profileId: string, pin: string): Promise<PinCheck>

  acquireSession(profileId: string): Promise<Lease>
  /** Renova o lease; devolve um pedido de reprodução pendente (reserva do ouvinte). */
  heartbeat(sessionId: string): Promise<HeartbeatResult>
  /** Publica o que a TV está tocando (somente status, para o Control). */
  reportPlayback(input: PlaybackStatusWrite): Promise<void>
  /** `suspend`: multitarefa — mantém a liberação por PIN para retomar o mesmo perfil. */
  releaseSession(sessionId: string, options?: { suspend?: boolean }): Promise<void>

  /**
   * Pedidos de reprodução do iPlex Control para esta TV. Ouvinte em tempo real
   * (somente leitura, regras do Firestore); devolve a função para encerrar.
   * `onError('revoked')`: a credencial deixou de valer (TV desvinculada).
   */
  watchPlayRequests(identity: DeviceIdentity, onPending: (notice: PlayRequestNotice) => void, onError: (reason: 'revoked' | 'unavailable') => void): () => void
  claimPlayRequest(id: string): Promise<PlayRequestClaim>
  updatePlayRequest(id: string, status: 'confirming' | 'started' | 'declined' | 'failed', errorCode?: PlayRequestErrorCode): Promise<void>

  listSpaces(profileId: string): Promise<Space[]>
  readCatalog(profileId: string, query: CatalogQuery): Promise<CatalogPage>
  /** Seis conjuntos do catálogo: manifesto, blocos e diferenças desde uma versão. */
  readCatalogManifest(profileId: string, sourceId: string): Promise<CatalogManifest>
  readCatalogChunk(profileId: string, sourceId: string, set: CatalogSetName, n: number, version: string): Promise<CatalogChunk>
  readCatalogDelta(profileId: string, sourceId: string, from: string): Promise<CatalogDelta>
  readSeries(profileId: string, sourceId: string, seriesId: string): Promise<SeriesDetails | null>
  readEpg(sourceId: string, channelId: string): Promise<EpgResult>
  resolveStream(profileId: string, input: { sourceId: string; itemId: string; episodeId?: string }): Promise<StreamGrant>

  readLibrary(identity: DeviceIdentity, profileId: string): Promise<Library>
  readGenerations(identity: DeviceIdentity, profileId: string): Promise<Profile['generations'] | null>
  setFavorite(input: { profileId: string; contentId: string; title: string; generation: number; remove: boolean }): Promise<void>
  saveProgress(input: ProgressWrite): Promise<ProgressResult | void>
  markWatched(input: { profileId: string; contentId: string; title: string; generation: number }): Promise<void>
}
