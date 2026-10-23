import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BridgeClient } from '../bridge/client'
import { BRIDGE_METHODS } from '../bridge/protocol'
import { createBridgePlaybackAdapter } from './bridgeAdapter'
import { browserFormatSupport, createHtml5Adapter } from './html5Adapter'

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
  it('seek: a posição devolvida pelo AVPlay confirma o seek (também pausado)', async () => {
    const { bridge, call } = fakeBridge()
    call.mockImplementation(async (method: string) => (method === 'player.seek' ? { state: 'paused', positionMs: 130_000, durationMs: 600_000, url: null } : { state: 'ready', positionMs: 0, durationMs: 0, url: null }))
    const adapter = createBridgePlaybackAdapter(bridge, BRIDGE_METHODS)
    const times: Array<{ positionMs: number; durationMs: number }> = []
    adapter.on('time', (t) => times.push(t))
    await adapter.load({ url: 'https://x/a.m3u8', live: false }, null)
    await adapter.seek!(130_000)
    expect(call).toHaveBeenCalledWith('player.seek', { positionMs: 130_000 })
    expect(times).toEqual([{ positionMs: 130_000, durationMs: 600_000 }])
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

describe('adaptador do navegador (<video> + hls.js)', () => {
  function fakeHls(supported = true) {
    const instances: Array<{ config: Record<string, unknown>; handlers: Map<string, (...a: unknown[]) => void>; attachMedia: ReturnType<typeof vi.fn>; loadSource: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn>; recoverMediaError: ReturnType<typeof vi.fn>; subtitleTrack: number }> = []
    class Hls {
      static isSupported = () => supported
      static Events = { ERROR: 'hlsError' }
      static ErrorTypes = { MEDIA_ERROR: 'mediaError', NETWORK_ERROR: 'networkError' }
      handlers = new Map<string, (...a: unknown[]) => void>()
      attachMedia = vi.fn()
      loadSource = vi.fn()
      destroy = vi.fn()
      stopLoad = vi.fn()
      recoverMediaError = vi.fn()
      audioTracks = [{ name: 'Português', lang: 'por' }]
      subtitleTracks = [{ name: 'Inglês', lang: 'eng' }]
      audioTrack = 0
      subtitleTrack = -1
      subtitleDisplay = false
      config: Record<string, unknown>
      constructor(config: Record<string, unknown>) {
        this.config = config
        instances.push(this as never)
      }
      on(event: string, fn: (...a: unknown[]) => void) {
        this.handlers.set(event, fn)
      }
    }
    return { Hls: Hls as never, instances }
  }
  let play: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(async () => undefined)
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined)
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined)
  })

  it('HLS por hls.js sem worker, num <video> sem controles próprios; estados vêm do elemento', async () => {
    const { Hls, instances } = fakeHls()
    const adapter = createHtml5Adapter(async () => Hls)
    const container = document.createElement('div')
    await adapter.load({ url: 'https://x/live.m3u8', live: true }, container)
    const video = container.querySelector('video')!
    expect(video.controls).toBe(false)
    expect(instances[0]!.config).toMatchObject({ enableWorker: false })
    expect(instances[0]!.attachMedia).toHaveBeenCalledWith(video)
    expect(instances[0]!.loadSource).toHaveBeenCalledWith('https://x/live.m3u8')
    expect(play).toHaveBeenCalled()
    const states: string[] = []
    adapter.on('state', (s) => states.push(s.state))
    video.dispatchEvent(new Event('playing'))
    video.dispatchEvent(new Event('pause'))
    expect(states).toEqual(['playing', 'paused'])
    await adapter.destroy()
    expect(instances[0]!.destroy).toHaveBeenCalled()
    expect(container.querySelector('video')).toBeNull()
  })
  it('VOD: retoma na posição salva; erro de mídia fatal tenta recuperar uma vez, depois falha', async () => {
    const { Hls, instances } = fakeHls()
    const adapter = createHtml5Adapter(async () => Hls)
    await adapter.load({ url: 'https://x/filme.m3u8', live: false, startPositionMs: 30000 }, document.createElement('div'))
    expect(instances[0]!.config).toMatchObject({ startPosition: 30 })
    const errors: unknown[] = []
    adapter.on('error', (e) => errors.push(e))
    const fire = instances[0]!.handlers.get('hlsError')!
    fire('hlsError', { fatal: true, type: 'mediaError', details: 'bufferStalledError' })
    expect(instances[0]!.recoverMediaError).toHaveBeenCalledTimes(1)
    expect(errors).toEqual([])
    fire('hlsError', { fatal: true, type: 'mediaError', details: 'manifestIncompatibleCodecsError' })
    expect(errors[0]).toMatchObject({ code: 'manifestIncompatibleCodecsError', unsupported: true })
  })
  it('faixas de áudio e legenda pelo hls.js', async () => {
    const { Hls, instances } = fakeHls()
    const adapter = createHtml5Adapter(async () => Hls)
    await adapter.load({ url: 'https://x/a.m3u8', live: false }, document.createElement('div'))
    await adapter.selectTrack('text', 0)
    expect(instances[0]!.subtitleTrack).toBe(0)
    expect((await adapter.getTracks()).map((t) => [t.kind, t.label, t.selected])).toEqual([['audio', 'Português', true], ['text', 'Inglês', true]])
    await adapter.setSubtitlesVisible(false)
    expect(instances[0]!.subtitleTrack).toBe(-1)
  })
  it('MP4 direto no <video>, sem carregar o hls.js', async () => {
    const load = vi.fn()
    const adapter = createHtml5Adapter(load as never)
    const container = document.createElement('div')
    await adapter.load({ url: 'https://x/filme.mp4', live: false }, container)
    expect(container.querySelector('video')!.getAttribute('src')).toBe('https://x/filme.mp4')
    expect(load).not.toHaveBeenCalled()
  })
  it('formato que o navegador não reproduz gera erro claro, sem carregar o hls.js', async () => {
    const load = vi.fn()
    const adapter = createHtml5Adapter(load as never)
    const errors: unknown[] = []
    adapter.on('error', (e) => errors.push(e))
    await adapter.load({ url: 'https://x/canal.ts', live: true }, document.createElement('div'))
    expect(errors[0]).toMatchObject({ unsupported: true })
    expect(load).not.toHaveBeenCalled()
  })
  it('navegador sem MediaSource: erro "unsupported"', async () => {
    const { Hls } = fakeHls(false)
    const adapter = createHtml5Adapter(async () => Hls)
    const errors: unknown[] = []
    adapter.on('error', (e) => errors.push(e))
    await adapter.load({ url: 'https://x/a.m3u8', live: true }, document.createElement('div'))
    expect(errors[0]).toMatchObject({ code: 'hls_unsupported', unsupported: true })
  })
  it('heurística de formato', () => {
    expect(browserFormatSupport('https://x/a.m3u8?t=1')).toBe('supported')
    expect(browserFormatSupport('https://x/a.mkv')).toBe('unsupported')
    expect(browserFormatSupport('https://x/stream')).toBe('unknown')
  })
})
