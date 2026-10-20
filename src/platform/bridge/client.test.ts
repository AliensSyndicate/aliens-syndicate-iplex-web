import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createBridgeClient } from './client'
import { BRIDGE_PROTOCOL, BRIDGE_VERSION } from './protocol'

/** Janela falsa: parent distinto, captura postMessage e permite simular mensagens. */
function fakeWindow() {
  const listeners = new Set<(e: MessageEvent) => void>()
  const parent = { postMessage: vi.fn() } as unknown as Window
  const win = {
    parent,
    addEventListener: (_: string, fn: (e: MessageEvent) => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: (e: MessageEvent) => void) => listeners.delete(fn),
  } as unknown as Window
  const deliver = (data: unknown, { source = parent, origin = 'null' }: { source?: unknown; origin?: string } = {}) =>
    listeners.forEach((fn) => fn({ data, source, origin } as MessageEvent))
  const lastRequest = () => (parent.postMessage as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0] as { id: string; method: string }
  return { win, parent, deliver, lastRequest }
}

const response = (id: string, result: unknown) => ({ protocol: BRIDGE_PROTOCOL, version: BRIDGE_VERSION, kind: 'response', id, ok: true, result })

describe('bridge client', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('envia pedidos no envelope v1 e resolve com a resposta do shell', async () => {
    const { win, deliver, lastRequest } = fakeWindow()
    const client = createBridgeClient({ win, allowedOrigins: ['null'] })
    const promise = client.call('player.getStatus')
    const req = lastRequest()
    expect(req).toMatchObject({ protocol: 'iplex-bridge', version: 1, kind: 'request', method: 'player.getStatus' })
    deliver(response(req.id, { state: 'idle', positionMs: 0, durationMs: 0, url: null }))
    await expect(promise).resolves.toMatchObject({ state: 'idle' })
  })

  it('ignora mensagens de origem desconhecida e de outra fonte', async () => {
    const { win, deliver, lastRequest } = fakeWindow()
    const client = createBridgeClient({ win, allowedOrigins: ['null'], timeoutMs: 1000 })
    const promise = client.call('player.play')
    const req = lastRequest()
    deliver(response(req.id, {}), { origin: 'https://evil.example' })
    deliver(response(req.id, {}), { source: {} })
    vi.advanceTimersByTime(1001)
    await expect(promise).rejects.toMatchObject({ code: 'timeout' })
  })

  it('descarta respostas duplicadas e de versão diferente', async () => {
    const { win, deliver, lastRequest } = fakeWindow()
    const client = createBridgeClient({ win, allowedOrigins: ['null'] })
    const promise = client.call('player.pause')
    const req = lastRequest()
    deliver({ ...response(req.id, { n: 0 }), version: 2 })
    deliver(response(req.id, { n: 1 }))
    deliver(response(req.id, { n: 2 }))
    await expect(promise).resolves.toEqual({ n: 1 })
  })

  it('propaga o código de erro do shell (ex.: unsupported_version)', async () => {
    const { win, deliver, lastRequest } = fakeWindow()
    const client = createBridgeClient({ win, allowedOrigins: ['null'] })
    const promise = client.call('app.exit')
    deliver({ protocol: BRIDGE_PROTOCOL, version: BRIDGE_VERSION, kind: 'response', id: lastRequest().id, ok: false, error: { code: 'unsupported_version', message: 'v2' } })
    await expect(promise).rejects.toMatchObject({ code: 'unsupported_version' })
  })

  it('aceita só eventos conhecidos com dados válidos', () => {
    const { win, deliver } = fakeWindow()
    const client = createBridgeClient({ win, allowedOrigins: ['null'] })
    const spy = vi.fn()
    client.on('player.time', spy)
    deliver({ protocol: BRIDGE_PROTOCOL, version: BRIDGE_VERSION, kind: 'event', event: 'player.time', data: { positionMs: 1, durationMs: 2 } })
    deliver({ protocol: BRIDGE_PROTOCOL, version: BRIDGE_VERSION, kind: 'event', event: 'player.time', data: null })
    deliver({ protocol: BRIDGE_PROTOCOL, version: BRIDGE_VERSION, kind: 'event', event: 'evil.command', data: {} })
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('marca desconexão após timeouts seguidos e reconecta na próxima mensagem', async () => {
    const { win, deliver } = fakeWindow()
    const client = createBridgeClient({ win, allowedOrigins: ['null'], timeoutMs: 100 })
    const states: string[] = []
    client.onConnection((s) => states.push(s))
    for (let i = 0; i < 3; i += 1) {
      const p = client.call('player.getStatus').catch(() => undefined)
      vi.advanceTimersByTime(101)
      await p
    }
    expect(client.connection).toBe('disconnected')
    deliver({ protocol: BRIDGE_PROTOCOL, version: BRIDGE_VERSION, kind: 'event', event: 'network.status', data: { online: true } })
    expect(states).toEqual(['disconnected', 'connected'])
  })

  it('dispose rejeita pendências e remove o listener', async () => {
    const { win } = fakeWindow()
    const client = createBridgeClient({ win, allowedOrigins: ['null'] })
    const promise = client.call('player.stop')
    client.dispose()
    await expect(promise).rejects.toMatchObject({ code: 'disconnected' })
    await expect(client.call('player.stop')).rejects.toMatchObject({ code: 'unavailable' })
  })
})
