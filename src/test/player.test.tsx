import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createEmitter, type PlaybackAdapter } from '../platform/playback/types'

const created: Array<PlaybackAdapter & { load: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn>; emit: (e: string, d: unknown) => void }> = []
vi.mock('../platform/playback/createAdapter', () => ({
  createPlaybackAdapter: () => {
    const emitter = createEmitter()
    const adapter = {
      kind: 'html5' as const,
      capabilities: { seek: true, audioTracks: true, subtitles: true },
      load: vi.fn(async () => emitter.emit('state', { state: 'playing' })),
      play: vi.fn(async () => undefined),
      pause: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
      seek: vi.fn(async () => undefined),
      getTracks: vi.fn(async () => []),
      selectTrack: vi.fn(async () => undefined),
      setSubtitlesVisible: vi.fn(async () => undefined),
      on: emitter.on,
      destroy: vi.fn(async () => undefined),
      emit: (e: string, d: unknown) => emitter.emit(e as never, d as never),
    }
    created.push(adapter)
    return adapter
  },
}))

const { App } = await import('../app/App')
const { createMockBackend } = await import('../dev/mock/mockBackend')
const { browserContext } = await import('../platform/environment')

function start(path: string) {
  window.history.replaceState({}, '', '/?mock=single')
  const backend = createMockBackend()
  const saveProgress = vi.spyOn(backend, 'saveProgress')
  window.history.replaceState({}, '', path)
  const view = render(<App backend={backend} detect={async () => browserContext()} />)
  return { backend, saveProgress, ...view }
}

beforeEach(() => {
  created.length = 0
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })))
})
afterEach(() => {
  vi.unstubAllGlobals()
  sessionStorage.clear()
  localStorage.clear()
})

describe('player', () => {
  it('canal ao vivo: URL autorizada pelo backend, sem menu e sem linha do tempo', async () => {
    start('/assistir?s=demo-source&i=c-1&k=channel&t=Canal')
    await waitFor(() => expect(created[0]?.load).toHaveBeenCalled(), { timeout: 5000 })
    expect(created[0]!.load.mock.calls[0]![0]).toMatchObject({ url: expect.stringContaining('bipbop'), live: true })
    expect(screen.queryByRole('navigation', { name: 'Menu principal' })).toBeNull()
    expect(await screen.findByText('Ao vivo')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Avançar 10 segundos' })).toBeNull()
    expect(screen.queryByRole('progressbar', { name: 'Posição' })).toBeNull()
  })

  it('filme: controles de VOD, progresso salvo na saída e recursos liberados', async () => {
    const { saveProgress, unmount } = start('/assistir?s=demo-source&i=m-bbb&k=movie&t=Big')
    await waitFor(() => expect(created[0]?.load).toHaveBeenCalled(), { timeout: 5000 })
    act(() => created[0]!.emit('time', { positionMs: 120_000, durationMs: 600_000 }))
    expect(await screen.findByRole('button', { name: 'Avançar 10 segundos' })).toBeTruthy()
    unmount()
    await waitFor(() => expect(created[0]!.destroy).toHaveBeenCalled())
    expect(saveProgress).toHaveBeenCalledWith(expect.objectContaining({ contentId: 'm-bbb', positionSec: 120, durationSec: 600 }))
  })

  it('erro de reprodução mostra estado específico com nova tentativa', async () => {
    start('/assistir?s=demo-source&i=m-bbb&k=movie&t=Big')
    await waitFor(() => expect(created[0]?.load).toHaveBeenCalled(), { timeout: 5000 })
    act(() => created[0]!.emit('error', { code: 'x', message: 'falha' }))
    expect(await screen.findByText('Não foi possível reproduzir')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeTruthy()
  })

  it('conteúdo sem fonte reproduzível: erro claro, nada é tocado', async () => {
    start('/assistir?s=demo-source&i=m-cosmos&k=movie&t=Cosmos')
    expect(await screen.findByText('Fonte IPTV indisponível', {}, { timeout: 5000 })).toBeTruthy()
    expect(created).toHaveLength(0)
  })
})
