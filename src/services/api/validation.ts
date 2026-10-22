/**
 * Validação na fronteira Web ↔ backend (contrato v1, docs/CONTRACTS.md do
 * repositório do Gestor/Control). Respostas fora do formato viram
 * `backend-outdated` em vez de estados indefinidos na interface.
 */
import type { HeartbeatResult } from './backend'
import { AppError } from './errors'
import type { AccountIdentity, ContentKind, PinCheck, PlayRequestClaim, PlayRequestNotice, Profile, ProfileType } from './types'

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const ID = /^[A-Za-z0-9_-]{1,128}$/
const PROFILE_TYPES: ProfileType[] = ['admin', 'regular', 'kids', 'guest']
const KINDS: ContentKind[] = ['channel', 'movie', 'series']
const invalid = (what: string) => new AppError('backend-outdated', `invalid-${what}`)

export function parseProfiles(raw: unknown): Profile[] {
  if (!isObject(raw) || !Array.isArray(raw.profiles)) throw invalid('profiles')
  return raw.profiles.filter(isObject).flatMap((p): Profile[] => {
    if (typeof p.id !== 'string' || !ID.test(p.id) || typeof p.name !== 'string') return []
    const type = PROFILE_TYPES.includes(p.type as ProfileType) ? (p.type as ProfileType) : 'regular'
    const g = isObject(p.generations) ? p.generations : {}
    return [{
      id: p.id,
      name: p.name,
      type,
      generations: { favorites: Number(g.favorites) || 0, watched: Number(g.watched) || 0, progress: Number(g.progress) || 0 },
      permissionsVersion: Number(p.permissionsVersion) || 0,
      ...(typeof p.pinRequired === 'boolean' ? { pinRequired: p.pinRequired } : {}),
    }]
  })
}

/** `account` de listPlayerProfiles. Ausente ou inválido (backend anterior) = sem identidade. */
export function parseAccountIdentity(raw: unknown): AccountIdentity | null {
  const account = isObject(raw) && isObject(raw.account) ? raw.account : null
  if (!account || typeof account.name !== 'string') return null
  const url = typeof account.photoUrl === 'string' && account.photoUrl.length <= 1000 && account.photoUrl.startsWith('https://') ? account.photoUrl : null
  return { name: account.name.slice(0, 80), photoUrl: url }
}

export function parsePinCheck(raw: unknown): PinCheck {
  if (!isObject(raw) || typeof raw.verified !== 'boolean') throw invalid('pin')
  return {
    verified: raw.verified,
    required: raw.required !== false,
    ...(typeof raw.attemptsLeft === 'number' ? { attemptsLeft: raw.attemptsLeft } : {}),
    ...(typeof raw.retryAt === 'number' ? { retryAt: raw.retryAt } : {}),
  }
}

export function parseHeartbeat(raw: unknown): HeartbeatResult {
  const pointer = isObject(raw) && isObject(raw.playRequest) ? raw.playRequest : null
  return {
    playRequest: pointer && typeof pointer.id === 'string' && ID.test(pointer.id) && typeof pointer.expiresAt === 'number' ? { id: pointer.id, expiresAt: pointer.expiresAt } : null,
  }
}

export function parsePlayRequestClaim(raw: unknown): PlayRequestClaim {
  if (!isObject(raw) || typeof raw.id !== 'string') throw invalid('play-request')
  if (raw.status === 'expired' || raw.status === 'failed') {
    return { id: raw.id, status: raw.status, ...(typeof raw.errorCode === 'string' ? { errorCode: raw.errorCode } : {}) }
  }
  const r = isObject(raw.request) ? raw.request : null
  if (raw.status !== 'delivered' || !r || typeof r.sourceId !== 'string' || !ID.test(r.sourceId) || typeof r.itemId !== 'string' || !ID.test(r.itemId) || !KINDS.includes(r.kind as ContentKind) || typeof r.title !== 'string') {
    throw invalid('play-request')
  }
  const episodeId = typeof r.episodeId === 'string' && ID.test(r.episodeId) ? r.episodeId : null
  return {
    id: raw.id,
    status: 'delivered',
    request: {
      sourceId: r.sourceId,
      itemId: r.itemId,
      episodeId,
      episodeLabel: typeof r.episodeLabel === 'string' ? r.episodeLabel : null,
      kind: r.kind as ContentKind,
      title: r.title,
      requesterName: typeof r.requesterName === 'string' ? r.requesterName : '',
      ...(r.resume === true && r.kind !== 'channel' ? { resume: true } : {}),
      ...(r.resume === true && r.kind !== 'channel' && typeof r.resumePositionSec === 'number' && Number.isFinite(r.resumePositionSec) && r.resumePositionSec > 0
        ? { resumePositionSec: Math.floor(r.resumePositionSec), ...(typeof r.resumeDurationSec === 'number' && r.resumeDurationSec > 0 ? { resumeDurationSec: r.resumeDurationSec } : {}) }
        : {}),
    },
  }
}

/** Documento do Firestore (somente leitura pela TV) → aviso de pedido pendente. */
export function parsePlayRequestDoc(id: string, data: unknown, now: number): PlayRequestNotice | null {
  if (!isObject(data) || data.status !== 'pending' || typeof data.expiresAt !== 'number' || data.expiresAt <= now) return null
  if (data.schemaVersion !== undefined && data.schemaVersion !== 1) return null
  return {
    id,
    expiresAt: data.expiresAt,
    requesterName: typeof data.requesterName === 'string' ? data.requesterName.slice(0, 80) : '',
    title: typeof data.title === 'string' ? data.title.slice(0, 300) : '',
  }
}

/** Marcador de desvinculação (status "revoked", recente): só um sinal para verificar a credencial. */
export function isRevocationMarker(data: unknown, now: number): boolean {
  return isObject(data) && data.status === 'revoked' && typeof data.expiresAt === 'number' && data.expiresAt > now
}
