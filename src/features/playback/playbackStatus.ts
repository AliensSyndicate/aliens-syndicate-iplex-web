/**
 * Estado de reprodução publicado para o iPlex Control ("Reproduzindo").
 *
 * Só informa; nunca recebe comandos. Muda de estado (tocando/pausado/parado) →
 * envia na hora; tocando → renova a cada `refreshMs` (o Control descarta status
 * com mais de 120 s). Falha de rede nunca afeta a reprodução.
 */
export type PlaybackStatusState = 'playing' | 'paused' | 'stopped'

export interface PlaybackStatusPayload {
  state: PlaybackStatusState
  positionSec?: number
  durationSec?: number
}

export function createStatusReporter(send: (payload: PlaybackStatusPayload) => Promise<unknown>, refreshMs = 60_000, now: () => number = Date.now) {
  let last: PlaybackStatusState | null = null
  let lastAt = -Infinity
  const deliver = (payload: PlaybackStatusPayload) => {
    last = payload.state
    lastAt = now()
    void send(payload).catch(() => {
      // Tenta de novo no próximo evento.
      lastAt = -Infinity
    })
  }
  return {
    /** Evento de tempo ou de estado do player. */
    report(payload: PlaybackStatusPayload) {
      if (payload.state === 'stopped') {
        if (last === null || last === 'stopped') return
        deliver(payload)
        return
      }
      if (payload.state !== last || now() - lastAt >= refreshMs) deliver(payload)
    },
  }
}
