/**
 * Uma reprodução = uma sessão de progresso (puro, testável).
 *
 * Garante, no cliente, o que o backend também impõe (`watchProgress`, docs/CONTRACTS.md §4.1):
 *  - nada é gravado antes de a posição de retomada estar confirmada no player (a
 *    inicialização/buffering/troca de mídia reportam 0 e apagariam o progresso salvo);
 *  - retomada confirmada só quando o player de fato está perto do alvo (não basta chamar seek);
 *  - seek do usuário (para frente ou para trás) é progresso legítimo e libera as gravações;
 *  - cada gravação leva `playId`, `startedAt` e `seq` crescente (eventos fora de ordem ou de
 *    sessões antigas são descartados pelo backend);
 *  - falha de rede não perde a posição: a próxima gravação leva o valor mais recente.
 */
export type ProgressOrigin = 'start' | 'resume' | 'restart'

/** Distância aceita entre o alvo e a posição real (granularidade de seek dos players). */
export const RESTORE_TOLERANCE_MS = 5_000
/** Tentativas de reaplicar o seek e tempo máximo até desistir (stream sem seek preciso). */
export const RESTORE_MAX_SEEKS = 3
export const RESTORE_GIVE_UP_MS = 12_000

export type RestoreStatus = 'none' | 'pending' | 'verified' | 'failed'

export interface ProgressSessionOptions {
  playId: string
  startedAt: number
  /** `resume`: o backend/TV pediu retomada; `restart`: começo intencional; `start`: sem progresso prévio. */
  origin: ProgressOrigin
  /** Posição a restaurar, em ms (somente `resume` com alvo conhecido). */
  targetMs?: number
  now?: () => number
}

export interface ProgressPayload {
  playId: string
  startedAt: number
  seq: number
  origin: ProgressOrigin
  userSeek?: true
}

export function createProgressSession(options: ProgressSessionOptions) {
  const now = options.now ?? Date.now
  const targetMs = options.targetMs && options.targetMs > 0 ? options.targetMs : 0
  let status: RestoreStatus = targetMs > 0 ? 'pending' : 'none'
  let seeks = 0
  let startedPlayingAt: number | null = null
  let userSeek = false
  let playing = false
  let seq = 0

  return {
    get restore(): RestoreStatus {
      return status
    },
    /** O player entrou em reprodução (ou pausou depois de tocar). */
    onState(state: 'playing' | 'paused' | 'other') {
      if (state === 'playing') {
        playing = true
        startedPlayingAt ??= now()
      }
    },
    /**
     * Cada evento de tempo do player. Retorna a ação para o player:
     * `seek` quando o alvo ainda não foi alcançado e vale reaplicar; `null` caso contrário.
     */
    onTime(positionMs: number): { seek: number } | null {
      if (status !== 'pending') return null
      if (positionMs >= targetMs - RESTORE_TOLERANCE_MS) {
        status = 'verified'
        return null
      }
      if (!playing || startedPlayingAt === null) return null
      if (now() - startedPlayingAt > RESTORE_GIVE_UP_MS || seeks >= RESTORE_MAX_SEEKS) {
        // Sem seek preciso (HLS/IPTV): toca do começo, mas o progresso salvo NÃO é sobrescrito.
        status = 'failed'
        return null
      }
      seeks += 1
      return { seek: targetMs }
    },
    /** O usuário mexeu na linha do tempo: a posição nova é progresso legítimo. */
    onUserSeek() {
      userSeek = true
      if (status === 'pending' || status === 'failed') status = 'none'
    },
    /** Pode gravar esta posição? Bloqueia inicialização e retomada ainda não confirmada. */
    canSave(positionMs: number, durationMs: number): boolean {
      if (!(durationMs > 0) || positionMs < 0) return false
      if (status === 'pending') return false
      if (status === 'failed' && !userSeek) return false
      if (!playing && !userSeek) return false
      return true
    },
    /** Próximo payload de gravação (seq estritamente crescente). */
    next(): ProgressPayload {
      seq += 1
      return { playId: options.playId, startedAt: options.startedAt, seq, origin: options.origin, ...(userSeek ? { userSeek: true as const } : {}) }
    },
  }
}

export type ProgressSession = ReturnType<typeof createProgressSession>

/** Posição de retomada (ms) vinda do pedido da TV ou do snapshot local, já validada. */
export function resolveResumeMs(fromRequestSec: number | null, fromLibrary: { position: number; duration: number } | null): number | null {
  const valid = (position: number, duration: number) =>
    Number.isFinite(position) && position >= 10 && (!(duration > 0) || (position / duration < 0.95 && duration - position >= 30))
  if (fromRequestSec !== null && valid(fromRequestSec, 0)) return Math.floor(fromRequestSec) * 1000
  if (fromLibrary && valid(fromLibrary.position, fromLibrary.duration)) return Math.floor(fromLibrary.position) * 1000
  return null
}
