/**
 * Vinculação da TV a uma família (validada no backend).
 *
 * 1. beginDevicePair → código de 6 dígitos + token de uso único (TTL 5 min).
 * 2. O administrador confirma no iPlex Gestor (QR iplex://pair?token=… ou código).
 * 3. A TV consulta finishDevicePair com recuo exponencial (3 s → 15 s) até
 *    receber o custom token. As regras do Firestore não liberam leitura da
 *    sessão de pareamento ao cliente, por isso não há listener em tempo real.
 * 4. Expirou → estado "expirado" com opção de gerar novo código.
 *
 * Identificadores locais (installationId) são enviados apenas como dica.
 */
import type { Backend, PairingRequest } from '../../services/api/backend'
import { AppError, toAppError } from '../../services/api/errors'
import type { DeviceIdentity, PairingSession } from '../../services/api/types'

export type PairingState =
  | { phase: 'creating' }
  | { phase: 'waiting'; session: PairingSession }
  | { phase: 'linked'; identity: DeviceIdentity }
  | { phase: 'expired' }
  | { phase: 'error'; error: AppError }

export const PAIRING_URI = (token: string) => `iplex://pair?token=${encodeURIComponent(token)}`

export interface PairingControllerOptions {
  backend: Pick<Backend, 'beginPairing' | 'pollPairing'>
  request: PairingRequest
  initialDelayMs: number
  maxDelayMs: number
  onChange: (state: PairingState) => void
  now?: () => number
  wait?: (ms: number) => Promise<void>
}

export function createPairingController(options: PairingControllerOptions) {
  const now = options.now ?? Date.now
  const wait = options.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  let run = 0

  async function start() {
    const id = ++run
    const alive = () => id === run
    options.onChange({ phase: 'creating' })
    let session: PairingSession
    try {
      session = await options.backend.beginPairing(options.request)
    } catch (error) {
      if (alive()) options.onChange({ phase: 'error', error: toAppError(error, { authenticated: false }) })
      return
    }
    if (!alive()) return
    options.onChange({ phase: 'waiting', session })
    let delay = options.initialDelayMs
    let failures = 0
    while (alive()) {
      const remaining = session.expiresAt - now()
      if (remaining <= 0) {
        options.onChange({ phase: 'expired' })
        return
      }
      await wait(Math.min(delay, Math.max(250, remaining)))
      if (!alive()) return
      if (session.expiresAt <= now()) {
        options.onChange({ phase: 'expired' })
        return
      }
      try {
        const result = await options.backend.pollPairing(session.token)
        if (!alive()) return
        failures = 0
        if (result.status === 'linked') {
          options.onChange({ phase: 'linked', identity: result.identity })
          return
        }
        if (result.status === 'expired') {
          options.onChange({ phase: 'expired' })
          return
        }
      } catch (error) {
        const appError = toAppError(error, { authenticated: false })
        failures += 1
        // Falhas transitórias não interrompem o pareamento; persistentes sim.
        if (!appError.retryable || failures >= 4) {
          if (alive()) options.onChange({ phase: 'error', error: appError })
          return
        }
      }
      delay = Math.min(options.maxDelayMs, Math.round(delay * 1.5))
    }
  }

  return {
    start,
    cancel() {
      run += 1
    },
  }
}
