/**
 * Sessão do dispositivo no backend (lease de 90 s em families/{fid}.leases).
 *
 * O backend é quem aplica os limites: até 3 dispositivos simultâneos por
 * família e um dispositivo por perfil (acquire em functions/src/domain.ts).
 * Esta classe só mantém o lease vivo:
 *  - início (acquireSession), renovação (heartbeat), encerramento (releaseSession);
 *  - expiração por abandono: sem heartbeat o lease expira sozinho no backend;
 *  - recuperação: lease perdido → uma nova tentativa de acquire; persistindo, avisa;
 *  - recarga da página: o mesmo dispositivo substitui o próprio lease no backend,
 *    então recarregar não cria sessões extras nem contorna o limite.
 */
import type { Backend, HeartbeatResult } from '../api/backend'
import { AppError, toAppError } from '../api/errors'
import type { Lease } from '../api/types'

export interface LeaseManagerOptions {
  backend: Pick<Backend, 'acquireSession' | 'heartbeat' | 'releaseSession'>
  heartbeatMs: number
  onLost: (error: AppError) => void
  /** Resposta de cada heartbeat (ex.: pedido de reprodução pendente do Control). */
  onBeat?: (result: HeartbeatResult) => void
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>
  clearTimer?: (id: ReturnType<typeof setTimeout>) => void
}

export class LeaseManager {
  private lease: Lease | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private suspendedProfileId: string | null = null
  private releasing: Promise<void> | null = null
  private readonly options: LeaseManagerOptions
  private readonly setTimer: NonNullable<LeaseManagerOptions['setTimer']>
  private readonly clearTimer: NonNullable<LeaseManagerOptions['clearTimer']>

  constructor(options: LeaseManagerOptions) {
    this.options = options
    this.setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
    this.clearTimer = options.clearTimer ?? ((id) => clearTimeout(id))
  }

  get current(): Lease | null {
    return this.lease
  }

  async acquire(profileId: string): Promise<Lease> {
    this.stopTimer()
    try {
      const lease = await this.options.backend.acquireSession(profileId)
      this.lease = lease
      this.suspendedProfileId = null
      this.schedule()
      return lease
    } catch (error) {
      this.lease = null
      throw toAppError(error)
    }
  }

  /** Encerra a sessão (troca de perfil, saída). Falha de rede: o lease expira sozinho. */
  async release(options: { suspend?: boolean } = {}): Promise<void> {
    this.stopTimer()
    const lease = this.lease
    this.lease = null
    this.suspendedProfileId = null
    if (!lease) return
    try {
      await this.options.backend.releaseSession(lease.id, options.suspend ? { suspend: true } : undefined)
    } catch {
      // expira no backend em até 90 s
    }
  }

  /**
   * App oculto (multitarefa): libera a vaga e lembra o perfil para retomar.
   * O backend mantém a liberação por PIN parental desse perfil por alguns minutos.
   */
  async suspend(): Promise<void> {
    const profileId = this.lease?.profileId ?? this.suspendedProfileId
    const releasing = this.release({ suspend: true })
    // Registrado antes de aguardar: um resume() imediato (ocultar/mostrar
    // rápido) precisa saber qual perfil retomar.
    this.suspendedProfileId = profileId
    this.releasing = releasing
    await releasing
  }

  async resume(): Promise<Lease | null> {
    if (this.releasing) await this.releasing
    this.releasing = null
    const profileId = this.suspendedProfileId
    if (!profileId || this.lease) return this.lease
    return this.acquire(profileId)
  }

  /** Lease perdido (ex.: expirou): readquire para o perfil informado. */
  async ensure(profileId: string): Promise<Lease> {
    if (this.lease && this.lease.profileId === profileId) return this.lease
    return this.acquire(profileId)
  }

  /** Verificação imediata (ex.: o ouvinte do Firestore perdeu a permissão: TV desvinculada?). */
  async checkNow(): Promise<void> {
    if (!this.lease) return
    this.stopTimer()
    await this.beat()
  }

  dispose() {
    this.stopTimer()
    this.lease = null
  }

  private schedule() {
    this.stopTimer()
    this.timer = this.setTimer(() => {
      void this.beat()
    }, this.options.heartbeatMs)
  }

  private stopTimer() {
    if (this.timer !== null) this.clearTimer(this.timer)
    this.timer = null
  }

  private async beat() {
    const lease = this.lease
    if (!lease) return
    try {
      const result = await this.options.backend.heartbeat(lease.id)
      if (this.lease === lease) this.schedule()
      if (result) this.options.onBeat?.(result)
    } catch (raw) {
      if (this.lease !== lease) return
      const error = toAppError(raw)
      if (error.kind === 'session-expired') {
        // Recuperação: o lease expirou (rede instável, suspensão). Uma nova tentativa.
        try {
          await this.acquire(lease.profileId)
          return
        } catch (retry) {
          this.lease = null
          this.options.onLost(toAppError(retry))
          return
        }
      }
      if (error.kind === 'offline' || error.kind === 'server-unavailable') {
        // Falha transitória: tenta de novo antes de o lease expirar (90 s).
        this.schedule()
        return
      }
      this.lease = null
      this.options.onLost(error)
    }
  }
}
