import { describe, expect, it } from 'vitest'
import { createProgressSession, resolveResumeMs, RESTORE_GIVE_UP_MS } from './progressSession'
import { createProgressTracker } from './progressTracker'

const MIN = 60_000
const make = (over: Partial<Parameters<typeof createProgressSession>[0]> = {}) => {
  let t = 1_000
  const clock = { now: () => t, advance: (ms: number) => (t += ms) }
  const session = createProgressSession({ playId: 'play-test-0001', startedAt: 1_000, origin: 'resume', targetMs: 38 * MIN, now: clock.now, ...over })
  return { session, clock }
}

describe('retomada aos 38 minutos', () => {
  it('não grava durante a inicialização nem antes de a retomada ser confirmada', () => {
    const { session } = make()
    expect(session.canSave(0, 120 * MIN)).toBe(false)
    session.onState('playing')
    expect(session.onTime(0)).toEqual({ seek: 38 * MIN }) // ainda no zero: reaplica o seek
    expect(session.canSave(0, 120 * MIN)).toBe(false)
    expect(session.restore).toBe('pending')
  })

  it('confirma só quando o player realmente chegou perto do alvo e então libera as gravações', () => {
    const { session } = make()
    session.onState('playing')
    session.onTime(0)
    expect(session.onTime(38 * MIN + 1_200)).toBeNull()
    expect(session.restore).toBe('verified')
    expect(session.canSave(38 * MIN + 1_200, 120 * MIN)).toBe(true)
  })

  it('stream sem seek: tenta de novo, desiste e NUNCA grava (progresso salvo preservado)', () => {
    const { session, clock } = make()
    session.onState('playing')
    const actions = [session.onTime(1_000), session.onTime(2_000), session.onTime(3_000), session.onTime(4_000)]
    expect(actions.filter(Boolean)).toHaveLength(3)
    expect(session.restore).toBe('failed')
    clock.advance(RESTORE_GIVE_UP_MS + 1)
    expect(session.canSave(30_000, 120 * MIN)).toBe(false)
  })

  it('seek manual do usuário (para trás) é progresso legítimo e libera a gravação', () => {
    const { session } = make()
    session.onState('playing')
    session.onTime(0)
    session.onUserSeek()
    expect(session.canSave(10 * MIN, 120 * MIN)).toBe(true)
    expect(session.next().userSeek).toBe(true)
  })

  it('seq cresce a cada gravação e carrega playId/origem (eventos fora de ordem são descartáveis)', () => {
    const { session } = make()
    const a = session.next(), b = session.next()
    expect(b.seq).toBe(a.seq + 1)
    expect(a).toMatchObject({ playId: 'play-test-0001', origin: 'resume', startedAt: 1_000 })
  })
})

describe('outros cenários', () => {
  it('reinício intencional (sem alvo) grava depois de tocar, não na inicialização', () => {
    const { session } = make({ origin: 'restart', targetMs: undefined })
    expect(session.canSave(0, 120 * MIN)).toBe(false) // ainda carregando
    session.onState('playing')
    expect(session.canSave(0, 120 * MIN)).toBe(true)
    expect(session.next().origin).toBe('restart')
  })

  it('duração desconhecida nunca grava', () => {
    const { session } = make({ origin: 'restart', targetMs: undefined })
    session.onState('playing')
    expect(session.canSave(5_000, 0)).toBe(false)
  })

  it('pausa depois de retomar mantém a gravação liberada', () => {
    const { session } = make()
    session.onState('playing')
    session.onTime(38 * MIN)
    session.onState('paused')
    expect(session.canSave(38 * MIN + 5_000, 120 * MIN)).toBe(true)
  })
})

describe('resolveResumeMs', () => {
  it('prefere a posição do backend e valida a da biblioteca', () => {
    expect(resolveResumeMs(2280, { position: 100, duration: 7200 })).toBe(2_280_000)
    expect(resolveResumeMs(null, { position: 2280.7, duration: 7200 })).toBe(2_280_000)
  })
  it('início, fim e concluído não retomam', () => {
    expect(resolveResumeMs(null, { position: 3, duration: 7200 })).toBeNull()
    expect(resolveResumeMs(null, { position: 7150, duration: 7200 })).toBeNull()
    expect(resolveResumeMs(null, { position: 6900, duration: 7200 })).toBeNull()
    expect(resolveResumeMs(null, null)).toBeNull()
  })
})

describe('gravações no Firebase (17)', () => {
  it('sem gravar a cada segundo; falha de rede permite repetir a mesma posição', () => {
    let t = 0
    const tracker = createProgressTracker({ intervalMs: 30_000, minDeltaMs: 10_000 }, () => t)
    let writes = 0
    for (let sec = 0; sec <= 120; sec++) {
      t = sec * 1000
      if (tracker.shouldSave(sec * 1000 + 38 * MIN, 120 * MIN)) {
        tracker.markSaved(sec * 1000 + 38 * MIN)
        writes++
      }
    }
    expect(writes).toBe(5) // 0, 30, 60, 90, 120 s: 1 a cada 30 s
    t += 1000
    expect(tracker.shouldSave(38 * MIN + 140_000, 120 * MIN, true)).toBe(true)
    tracker.markSaved(38 * MIN + 140_000)
    expect(tracker.shouldSave(38 * MIN + 140_000, 120 * MIN, true)).toBe(false)
    tracker.markFailed()
    expect(tracker.shouldSave(38 * MIN + 140_000, 120 * MIN, true)).toBe(true) // pausa/saída tentam de novo
  })
})
