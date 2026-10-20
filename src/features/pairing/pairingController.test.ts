import { describe, expect, it, vi } from 'vitest'
import { AppError } from '../../services/api/errors'
import type { PairingPoll } from '../../services/api/types'
import { createPairingController, PAIRING_URI, type PairingState } from './pairingController'

function run(polls: Array<PairingPoll | Error>, { expiresIn = 60000 } = {}) {
  let now = 0
  const states: PairingState[] = []
  const backend = {
    beginPairing: vi.fn(async () => ({ token: 't'.repeat(64), code: '123456', formattedCode: '123-456', deviceId: 'd', expiresAt: now + expiresIn })),
    pollPairing: vi.fn(async () => {
      const next = polls.shift() ?? { status: 'pending' as const }
      if (next instanceof Error) throw next
      return next
    }),
  }
  const waits: number[] = []
  const controller = createPairingController({
    backend,
    request: { name: 'TV', platform: 'tizen' },
    initialDelayMs: 3000,
    maxDelayMs: 15000,
    onChange: (s) => states.push(s),
    now: () => now,
    wait: async (ms) => {
      waits.push(ms)
      now += ms
    },
  })
  return { controller, states, backend, waits }
}

describe('pareamento', () => {
  it('aguarda confirmação e conclui com a identidade do backend', async () => {
    const { controller, states } = run([{ status: 'pending' }, { status: 'linked', identity: { deviceId: 'd', familyId: 'f' } }])
    await controller.start()
    expect(states.map((s) => s.phase)).toEqual(['creating', 'waiting', 'linked'])
  })
  it('expira localmente quando o TTL acaba', async () => {
    const { controller, states } = run([], { expiresIn: 10000 })
    await controller.start()
    expect(states.at(-1)?.phase).toBe('expired')
  })
  it('consulta com recuo exponencial limitado', async () => {
    const { controller, waits } = run([], { expiresIn: 120000 })
    await controller.start()
    expect(waits[0]).toBe(3000)
    expect(waits[1]).toBe(4500)
    expect(Math.max(...waits)).toBeLessThanOrEqual(15000)
  })
  it('tolera falha transitória e para em erro persistente', async () => {
    const transient = new AppError('server-unavailable')
    const ok = run([transient, { status: 'linked', identity: { deviceId: 'd', familyId: 'f' } }])
    await ok.controller.start()
    expect(ok.states.at(-1)?.phase).toBe('linked')
    const fatal = run([new AppError('app-check')])
    await fatal.controller.start()
    expect(fatal.states.at(-1)?.phase).toBe('error')
  })
  it('QR aponta para o fluxo do Gestor', () => {
    expect(PAIRING_URI('abc')).toBe('iplex://pair?token=abc')
  })
})
