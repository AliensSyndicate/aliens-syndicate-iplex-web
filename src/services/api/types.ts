/**
 * Tipos de domínio do iPlex Web, alinhados ao backend existente (callable
 * `manager` do projeto iplex-2c8fc, repositório do Gestor).
 */

export type SectionId = 'my-iplex' | 'search' | 'live' | 'movies' | 'series'

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
}

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
  version: string
}

export interface CatalogPage {
  version: string
  items: CatalogItem[]
  categories: CatalogCategory[]
  cursor: number
  hasMore: boolean
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
