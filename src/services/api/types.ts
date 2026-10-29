/**
 * Tipos de domínio do iPlex Web, alinhados ao backend existente (callable
 * `manager` do projeto iplex-2c8fc, repositório do Gestor).
 */

export type SectionId = 'my-iplex' | 'search' | 'live' | 'movies' | 'series' | 'adult'

export type ProfileType = 'admin' | 'regular' | 'kids' | 'guest'

export interface Generations {
  favorites: number
  watched: number
  progress: number
}

/** listPlayerProfiles: perfis habilitados para a TV (visitante desabilitado já vem fora). */
export interface Profile {
  id: string
  name: string
  type: ProfileType
  generations: Generations
  permissionsVersion: number
  /** Informativo (backend ≥ contrato v1): o acquireSession exige PIN parental. Ausente = regra local. */
  pinRequired?: boolean
}

/**
 * Identidade da CONTA vinculada à TV (a conta autenticada no Gestor), distinta dos
 * perfis de visualização. Só nome e foto do provedor (https); sem credenciais.
 * `photoUrl` null = avatar padrão (sem foto, p.ex. Apple).
 */
export interface AccountIdentity {
  name: string
  photoUrl: string | null
}

/** verifyProfilePin: resultado do backend. O PIN nunca é comparado no cliente. */
export interface PinCheck {
  verified: boolean
  /** false: o perfil não exige PIN (sem perfil infantil na família ou perfil não adulto). */
  required: boolean
  attemptsLeft?: number
  /** Bloqueio por tentativas: horário (ms) em que novas tentativas voltam a ser aceitas. */
  retryAt?: number
}

/**
 * Solicitação de reprodução enviada pelo iPlex Control (contrato v1,
 * docs/CONTRACTS.md do Control). Só identificadores estáveis do catálogo.
 */

export interface PlayRequestNotice {
  id: string
  expiresAt: number
  requesterName: string
  title: string
}

export interface PlayRequestContent {
  sourceId: string
  itemId: string
  episodeId: string | null
  episodeLabel: string | null
  kind: ContentKind
  title: string
  requesterName: string
  /** "Continuar assistindo" no Control: retoma do progresso salvo do perfil ativo da TV. */
  resume?: boolean
  /** Posição (s) a retomar, resolvida pelo backend; ausente = começar do início. */
  resumePositionSec?: number
  resumeDurationSec?: number
}

export type PlayRequestClaim =
  | { id: string; status: 'delivered'; request: PlayRequestContent }
  | { id: string; status: 'expired' | 'failed'; errorCode?: string }

/** Códigos que a TV pode reportar ao Control. */
export type PlayRequestErrorCode =
  | 'content-unavailable'
  | 'content-not-allowed'
  | 'source-protected'
  | 'stream-unavailable'
  | 'playback-failed'
  | 'format-unsupported'
  | 'session-limit'
  | 'subscription-required'
  | 'no-answer'
  | 'busy'

export interface DeviceIdentity {
  deviceId: string
  familyId: string
}

export interface PairingSession {
  token: string
  /** Código manual (6 dígitos). Versões anteriores do backend só devolvem o token (QR). */
  code: string | null
  formattedCode: string | null
  deviceId: string | null
  expiresAt: number
}

export type PairingPoll = { status: 'pending' } | { status: 'linked'; identity: DeviceIdentity } | { status: 'expired' }

/** Lease de reprodução/uso (90 s no backend, renovado por heartbeat). */
export interface Lease {
  id: string
  profileId: string
  expiresAt: number
}

export type ContentKind = 'channel' | 'movie' | 'series'

/** Espaço = fonte IPTV × tipo de conteúdo visível ao perfil. */
export interface Space {
  sourceId: string
  name: string
  kinds: ContentKind[]
  /** A fonte IPTV do usuário está com erro (credenciais inválidas ou última sincronização falhou). */
  unavailable?: boolean
  /** Última atualização da lista no servidor (ms), quando o backend informa. */
  lastSyncAt?: number
  /** Há uma sincronização pedida (Gestor, TV ou agenda) que ainda não terminou. */
  syncing?: boolean
}

export interface CatalogCategory {
  id: string
  name: string
  kind: ContentKind
}

/**
 * Item do catálogo normalizado pelo backend. `id` é o identificador público
 * (hash de fonte + item) e também o contentId de favoritos/progresso.
 * `title` é o nome ORIGINAL da fonte (preservado para auditoria).
 */
export interface CatalogItem {
  id: string
  sourceId: string
  kind: ContentKind
  title: string
  category: string
  categoryId?: string
  providerRef: string
  epgId?: string
  plot?: string
  year?: string | number
  rating?: string | number
  ageRating?: string
  /** Data de inclusão no catálogo (epoch ms), quando o backend fornecer. Ausente = sem data. */
  addedAt?: number
  /** URL https do logo/capa informada pela fonte IPTV (tvg-logo, stream_icon), quando existe. */
  imageRef?: string
  /** Marca explícita do provedor (Xtream is_adult), quando existe. */
  isAdult?: boolean
  version: string
}

export interface CatalogPage {
  version: string
  items: CatalogItem[]
  categories: CatalogCategory[]
  cursor: number
  hasMore: boolean
}

/**
 * Oito conjuntos do catálogo (blocos por callable, já filtrados para o perfil ativo): seis comuns e, à parte,
 * `adult_categories` e `adult` (todo conteúdo adulto de canais, filmes e séries, fora dos seis comuns).
 */
export type CatalogSetName = 'live_categories' | 'live' | 'vod_categories' | 'vod' | 'series_categories' | 'series' | 'adult_categories' | 'adult'
export interface CatalogManifest {
  version: string
  previousVersion: string | null
  /** Impressão digital das permissões do perfil: mudou → o cache local é refeito. */
  viewerKey: string
  /** Backend anterior aos conjuntos adultos não traz `adult*` (tratados como vazios). */
  sets: Partial<Record<CatalogSetName, { chunks: number; hash: string }>>
  /** O perfil está habilitado ao conteúdo adulto no iPlex Control (o item "Adulto" do menu depende disso). */
  adultEnabled?: boolean
  deltaAvailable: boolean
}
export type CatalogRecord = Record<string, unknown> & { id: string }
export interface CatalogChunk {
  version: string
  set: CatalogSetName
  n: number
  chunks: number
  records: CatalogRecord[]
}
export interface CatalogDelta {
  from: string
  to: string
  /** true: não há histórico confiável; reconstruir o cache inteiro. */
  full: boolean
  reason?: string
  steps: Array<{ version: string; sets: Partial<Record<CatalogSetName, { upserts: CatalogRecord[]; deletes: string[] }>> }>
}

export interface SeriesEpisode {
  id: string
  title: string
  season: number
  episodeNum: number | null
  duration?: string
  plot?: string
}

export interface SeriesSeason {
  seasonNumber: number
  name: string
  episodes: SeriesEpisode[]
}

export interface SeriesDetails {
  seriesId: string
  seasons: SeriesSeason[]
}

export interface Programme {
  channelId: string
  title: string
  startAt: number
  endAt: number
  description: string
}

/** null = EPG indisponível para este cliente/fonte (nunca inventar programação). */
export type EpgResult = { supported: true; programmes: Programme[] } | { supported: false }

export interface StreamGrant {
  url: string
  sourceId: string
  validatedAt: number
}

export interface LibraryEntry {
  contentId: string
  title: string | null
  generation: number
  updatedAt: number
}

export interface ProgressEntry {
  contentId: string
  position: number
  duration: number
  generation: number
  updatedAt: number
}

export interface Library {
  favorites: LibraryEntry[]
  /** Shares the favorites generation with the Control. */
  wishlist?: LibraryEntry[]
  watched: LibraryEntry[]
  progress: ProgressEntry[]
}

export interface ContentRef {
  sourceId: string
  itemId: string
  kind: ContentKind
  title: string
  episodeId?: string
}
