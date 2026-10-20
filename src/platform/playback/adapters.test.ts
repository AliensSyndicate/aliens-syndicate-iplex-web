import { describe, expect, it, vi } from 'vitest'
import type { BridgeClient } from '../bridge/client'
import { BRIDGE_METHODS } from '../bridge/protocol'
import { createBridgePlaybackAdapter } from './bridgeAdapter'
import { browserFormatSupport, createClapprAdapter } from './clapprAdapter'

function fakeBridge() {
  const handlers = new Map<string, (d: unknown) => void>()
  const call = vi.fn(async (method: string) => (method === 'player.getTracks' ? [{ kind: 'audio', index: 0, language: 'por', selected: true }] : { state: 'ready', positionMs: 0, durationMs: 0, url: null }))
  const bridge = { call, on: (name: string, fn: (d: unknown) => void) => (handlers.set(name, fn), () => handlers.delete(name)) } as unknown as BridgeClient
  return { bridge, call, emit: (name: string, data: unknown) => handlers.get(name)?.(data), handlers }
}

describe('adaptador AVPlay (ponte)', () => {
  it('abre a mídia pelo player.open e repassa eventos', async () => {
    const { bridge, call, emit } = fakeBridge()
    const adapter = createBridgePlaybackAdapter(bridge, BRIDGE_METHODS)
    const times: number[] = []
    adapter.on('time', (t) => times.push(t.positionMs))
    await adapter.load({ url: 'https://x/a.m3u8', live: false, startPositionMs: 12000 }, null)
    expect(call).toHaveBeenCalledWith('player.open', { url: 'https://x/a.m3u8', autoplay: true, startPositionMs: 12000 })
    emit('player.time', { positionMs: 5, durationMs: 10 })
    expect(times).toEqual([5])
    await adapter.pause()
    await adapter.play()
    expect(call).toHaveBeenCalledWith('player.pause')
    expect(call).toHaveBeenCalledWith('player.play')
  })
  it('ao vivo: sem seek e sem posição inicial', async () => {
    const { bridge, call } = fakeBridge()
    const adapter = createBridgePlaybackAdapter(bridge, BRIDGE_METHODS)
    await adapter.load({ url: 'https://x/live.ts', live: true, startPositionMs: 5000 }, null)
    expect(call).toHaveBeenCalledWith('player.open', { url: 'https://x/live.ts', autoplay: true })
    await adapter.seek!(1000)
    expect(call).not.toHaveBeenCalledWith('player.seek', expect.anything())
  })
  it('respeita capacidades anunciadas', async () => {
    const { bridge } = fakeBridge()
    const adapter = createBridgePlaybackAdapter(bridge, ['app.ready', 'player.open', 'player.play', 'player.pause', 'player.stop'])
    expect(adapter.capabilities).toEqual({ seek: false, audioTracks: false, subtitles: false })
    expect(await adapter.getTracks()).toEqual([])
  })
  it('destroy para o player e remove listeners', async () => {
    const { bridge, call, handlers } = fakeBridge()
    const adapter = createBridgePlaybackAdapter(bridge, BRIDGE_METHODS)
    await adapter.destroy()
    expect(call).toHaveBeenCalledWith('player.stop')
    expect(handlers.size).toBe(0)
  })
})

describe('adaptador Clappr', () => {
  function fakeClappr() {
    const instances: Array<{ options: Record<string, unknown>; handlers: Map<string, (...a: unknown[]) => void>; play: ReturnType<typeof vi.fn>; pause: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn>; seek: ReturnType<typeof vi.fn> }> = []
    class Player {
      handlers = new Map<string, (...a: unknown[]) => void>()
      play = vi.fn()
      pause = vi.fn()
      stop = vi.fn()
      seek = vi.fn()
      destroy = vi.fn()
      core = { activeContainer: { on: vi.fn(), audioTracks: [], closedCaptionsTracks: [] } }
      options: Record<string, unknown>
      constructor(options: Record<string, unknown>) {
        this.options = options
        instances.push(this as never)
      }
      on(event: string, fn: (...a: unknown[]) => void) {
        this.handlers.set(event, fn)
      }
    }
    const Events = { PLAYER_READY: 'ready', PLAYER_PLAY: 'play', PLAYER_PAUSE: 'pause', PLAYER_ENDED: 'ended', PLAYER_TIMEUPDATE: 'timeupdate', PLAYER_ERROR: 'error' }
    return { mod: { Player, Events } as never, instances }
  }

  it('cria o Clappr sem interface própria e sem worker do hls.js', async () => {
    const { mod, instances } = fakeClappr()
    const adapter = createClapprAdapter(async () => mod)
    await adapter.load({ url: 'https://x/a.m3u8', live: false }, document.createElement('div'))
    expect(instances[0]!.options).toMatchObject({ chromeless: true, source: 'https://x/a.m3u8', playback: { hlsjsConfig: { enableWorker: false } } })
    const states: string[] = []
    adapter.on('state', (s) => states.push(s.state))
    instances[0]!.handlers.get('play')!()
    instances[0]!.handlers.get('pause')!()
    expect(states).toEqual(['playing', 'paused'])
    await adapter.destroy()
    expect(instances[0]!.destroy).toHaveBeenCalled()
  })
  it('retoma VOD na posição salva quando pronto', async () => {
    const { mod, instances } = fakeClappr()
    const adapter = createClapprAdapter(async () => mod)
    await adapter.load({ url: 'https://x/a.mp4', live: false, startPositionMs: 30000 }, document.createElement('div'))
    instances[0]!.handlers.get('ready')!()
    expect(instances[0]!.seek).toHaveBeenCalledWith(30)
  })
  it('formato que o navegador não reproduz gera erro claro, sem carregar o Clappr', async () => {
    const load = vi.fn()
    const adapter = createClapprAdapter(load as never)
    const errors: unknown[] = []
    adapter.on('error', (e) => errors.push(e))
    await adapter.load({ url: 'https://x/canal.ts', live: true }, document.createElement('div'))
    expect(errors[0]).toMatchObject({ unsupported: true })
    expect(load).not.toHaveBeenCalled()
  })
  it('heurística de formato', () => {
    expect(browserFormatSupport('https://x/a.m3u8?t=1')).toBe('supported')
    expect(browserFormatSupport('https://x/a.mkv')).toBe('unsupported')
    expect(browserFormatSupport('https://x/stream')).toBe('unknown')
  })
})
