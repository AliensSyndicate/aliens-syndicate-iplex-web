import { describe, expect, it, vi } from 'vitest'
import { AppError } from '../api/errors'
import { LeaseManager } from './leaseManager'

function setup(overrides: Partial<{ acquire: () => Promise<unknown>; heartbeat: () => Promise<void> }> = {}) {
  let tick: (() => void) | null = null
  const backend = {
    acquireSession: vi.fn(overrides.acquire ?? (async (profileId: string) => ({ id: `l-${Math.random()}`, profileId, expiresAt: Date.now() + 90000 }))),
    heartbeat: vi.fn(overrides.heartbeat ?? (async () => undefined)),
    releaseSession: vi.fn(async () => undefined),
  }
  const onLost = vi.fn()
  const manager = new LeaseManager({
    backend: backend as never,
    heartbeatMs: 30000,
    onLost,
    setTimer: (fn) => {
      tick = fn
      return 1 as unknown as ReturnType<typeof setTimeout>
    },
    clearTimer: () => {
      tick = null
    },
  })
  return { manager, backend, onLost, beat: async () => { const t = tick; t?.(); await new Promise((r) => setTimeout(r, 0)) } }
}

describe('LeaseManager', () => {
  it('adquire e renova com heartbeat', async () => {
    const { manager, backend, beat } = setup()
    await manager.acquire('admin')
    await beat()
    await beat()
    expect(backend.heartbeat).toHaveBeenCalledTimes(2)
  })
  it('recupera um lease expirado com nova tentativa', async () => {
    const { manager, backend, beat, onLost } = setup({ heartbeat: async () => { throw new AppError('session-expired') } })
    await manager.acquire('admin')
    await beat()
    expect(backend.acquireSession).toHaveBeenCalledTimes(2)
    expect(onLost).not.toHaveBeenCalled()
  })
  it('limite de sessões na recuperação é reportado', async () => {
    let calls = 0
    const { manager, beat, onLost } = setup({
      acquire: async () => {
        calls += 1
        if (calls > 1) throw new AppError('session-limit')
        return { id: 'l1', profileId: 'admin', expiresAt: 0 }
      },
      heartbeat: async () => {
        throw new AppError('session-expired')
      },
    })
    await manager.acquire('admin')
    await beat()
    expect(onLost.mock.calls[0]![0].kind).toBe('session-limit')
    expect(manager.current).toBeNull()
  })
  it('assinatura vencida durante o uso encerra a sessão', async () => {
    const { manager, beat, onLost } = setup({ heartbeat: async () => { throw new AppError('subscription-inactive') } })
    await manager.acquire('admin')
    await beat()
    expect(onLost.mock.calls[0]![0].kind).toBe('subscription-inactive')
  })
  it('falha de rede não derruba a sessão (tenta de novo)', async () => {
    const { manager, beat, onLost, backend } = setup({ heartbeat: async () => { throw new AppError('server-unavailable') } })
    await manager.acquire('admin')
    await beat()
    await beat()
    expect(onLost).not.toHaveBeenCalled()
    expect(backend.heartbeat).toHaveBeenCalledTimes(2)
  })
  it('suspende (libera) e retoma o mesmo perfil', async () => {
    const { manager, backend } = setup()
    await manager.acquire('kids')
    await manager.suspend()
    expect(backend.releaseSession).toHaveBeenCalledTimes(1)
    expect(manager.current).toBeNull()
    await manager.resume()
    expect(backend.acquireSession).toHaveBeenLastCalledWith('kids')
  })
})

describe('LeaseManager — ocultar/mostrar rápido', () => {
  it('resume imediato após suspend retoma o mesmo perfil', async () => {
    const { manager, backend } = setup()
    await manager.acquire('admin')
    const suspending = manager.suspend()
    const resumed = await manager.resume()
    await suspending
    expect(resumed?.profileId).toBe('admin')
    expect(backend.acquireSession).toHaveBeenCalledTimes(2)
  })
})

describe('LeaseManager — PIN parental e pedidos do Control', () => {
  it('suspender (multitarefa) avisa o backend para manter a liberação por PIN; trocar de perfil não', async () => {
    const { manager, backend } = setup()
    const first = await manager.acquire('admin')
    await manager.suspend()
    expect(backend.releaseSession).toHaveBeenLastCalledWith(first.id, { suspend: true })
    const second = await manager.resume()
    await manager.release()
    expect(backend.releaseSession).toHaveBeenLastCalledWith(second!.id, undefined)
  })

  it('repassa a resposta do heartbeat (pedido pendente) e permite verificação imediata', async () => {
    const onBeat = vi.fn()
    const heartbeat = vi.fn(async () => ({ playRequest: { id: 'pr_1', expiresAt: 9 } }))
    const manager = new LeaseManager({
      backend: { acquireSession: async (profileId: string) => ({ id: 'l', profileId, expiresAt: 1 }), heartbeat, releaseSession: async () => undefined } as never,
      heartbeatMs: 30000,
      onLost: vi.fn(),
      onBeat,
      setTimer: () => 1 as unknown as ReturnType<typeof setTimeout>,
      clearTimer: () => undefined,
    })
    await manager.acquire('admin')
    await manager.checkNow()
    expect(heartbeat).toHaveBeenCalledWith('l')
    expect(onBeat).toHaveBeenCalledWith({ playRequest: { id: 'pr_1', expiresAt: 9 } })
  })
})
