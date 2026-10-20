/**
 * Taxonomia de erros do iPlex Web. Cada estado tem origem e ação próprias:
 * nunca tratar fonte IPTV fora do ar como assinatura vencida, por exemplo.
 * Códigos do backend: DomainError do repositório do Gestor (functions/src).
 */

export type AppErrorKind =
  | 'offline'
  | 'server-unavailable'
  | 'not-configured'
  | 'shell-communication'
  | 'device-unpaired'
  | 'pairing-expired'
  | 'pairing-pending'
  | 'subscription-inactive'
  | 'session-expired'
  | 'session-limit'
  | 'profile-in-use'
  | 'profile-unavailable'
  | 'profile-locked'
  | 'iptv-not-configured'
  | 'iptv-unavailable'
  | 'source-locked'
  | 'content-unavailable'
  | 'playback-error'
  | 'format-unsupported'
  | 'rate-limited'
  | 'not-supported'
  | 'backend-outdated'
  | 'typography'
  | 'unknown'

export class AppError extends Error {
  readonly kind: AppErrorKind
  readonly code: string
  readonly details: Record<string, unknown>
  constructor(kind: AppErrorKind, code: string = kind, details: Record<string, unknown> = {}) {
    super(code)
    this.name = 'AppError'
    this.kind = kind
    this.code = code
    this.details = details
  }
  get retryable(): boolean {
    return RETRYABLE.has(this.kind)
  }
}

const RETRYABLE = new Set<AppErrorKind>([
  'offline',
  'server-unavailable',
  'iptv-unavailable',
  'session-expired',
  'session-limit',
  'profile-in-use',
  'playback-error',
  'shell-communication',
  'rate-limited',
  'subscription-inactive',
  'unknown',
])

const IPTV_CODES = new Set([
  'source-authorization-required',
  'source-conflict',
  'provider-unavailable',
  'provider-rate-limited',
  'provider-time-budget',
  'invalid-credentials',
  'download-failed',
  'catalog-integrity',
  'invalid-catalog',
  'unsafe-provider',
  'catalog-too-large',
])

/** Código de domínio (DomainError.code) → tipo de erro do Web. */
export function kindForDomainCode(code: string): AppErrorKind {
  if (code === 'device-revoked' || code === 'device-required') return 'device-unpaired'
  if (code === 'subscription-required') return 'subscription-inactive'
  if (code === 'session-expired') return 'session-expired'
  if (code === 'session-limit') return 'session-limit'
  if (code === 'profile-in-use') return 'profile-in-use'
  if (code === 'profile-disabled' || code === 'profile-unavailable') return 'profile-unavailable'
  if (code === 'pin-required') return 'source-locked'
  if (code === 'not-found') return 'content-unavailable'
  if (code === 'invalid-token') return 'pairing-pending'
  if (code === 'pairing-expired') return 'pairing-expired'
  if (code === 'rate-limited') return 'rate-limited'
  if (code === 'guest-not-persisted') return 'not-supported'
  if (code === 'invalid-action') return 'backend-outdated'
  if (IPTV_CODES.has(code)) return 'iptv-unavailable'
  if (code === 'operation-failed' || code === 'internal') return 'server-unavailable'
  return 'unknown'
}

interface FirebaseLikeError {
  code?: unknown
  message?: unknown
  details?: unknown
}

const isOnline = () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false)

/**
 * Converte erros do SDK Firebase (callable/auth/firestore) e de rede.
 * `authenticated` indica se a chamada carregava credencial de dispositivo:
 * sem credencial, "unauthenticated" só pode ser App Check.
 */
export function toAppError(error: unknown, { authenticated = true }: { authenticated?: boolean } = {}): AppError {
  if (error instanceof AppError) return error
  const e = (error ?? {}) as FirebaseLikeError
  const code = typeof e.code === 'string' ? e.code : ''
  // O SDK do Firebase (v13) acrescenta o status HTTP: "subscription-required [400]".
  const message = typeof e.message === 'string' ? e.message.replace(/\s*\[\d{3}\]\s*$/, '').trim() : ''
  const details = e.details && typeof e.details === 'object' ? (e.details as Record<string, unknown>) : {}
  if (!isOnline()) return new AppError('offline')
  const fnCode = code.replace(/^functions\//, '')
  if (code.startsWith('functions/')) {
    if (fnCode === 'unavailable' || fnCode === 'deadline-exceeded') return new AppError('server-unavailable', fnCode)
    if (fnCode === 'unauthenticated') {
      return new AppError('device-unpaired', authenticated ? 'unauthenticated' : 'credential-missing')
    }
    if (fnCode === 'invalid-argument') return new AppError('unknown', 'invalid-input')
    // Callable `player` ainda não publicada no backend.
    if (fnCode === 'not-found') return new AppError('backend-outdated', 'player-not-deployed')
    if (fnCode === 'internal') {
      // O SDK usa "internal" também para falha de rede/CORS sem resposta.
      return new AppError('server-unavailable', message || 'internal')
    }
    const kind = kindForDomainCode(message)
    return new AppError(kind, message || fnCode, details)
  }
  if (code === 'auth/network-request-failed' || code === 'unavailable') return new AppError('server-unavailable', code)
  if (code === 'auth/user-token-expired' || code === 'auth/user-disabled' || code === 'auth/invalid-user-token') {
    return new AppError('device-unpaired', code)
  }
  if (code === 'permission-denied') return new AppError('device-unpaired', code)
  if (error instanceof TypeError) return new AppError('server-unavailable', 'network')
  return new AppError('unknown', code || message || 'unknown')
}
