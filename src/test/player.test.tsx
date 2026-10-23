import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createEmitter, type PlaybackAdapter } from '../platform/playback/types'

type FakeAdapter = PlaybackAdapter & {
  load: ReturnType<typeof vi.fn>
  destroy: ReturnType<typeof vi.fn>
  seek: ReturnType<typeof vi.fn>
  play: ReturnType<typeof vi.fn>
  pause: ReturnType<typeof vi.fn>
  emit: (e: string, d: unknown) => void
}
const created: FakeAdapter[] = []
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
type Backend = ReturnType<typeof createMockBackend>

function start(path: string, prepare?: (backend: Backend) => unknown) {
  window.history.replaceState({}, '', '/?mock=single')
  const backend = createMockBackend()
  void prepare?.(backend)
  const saveProgress = vi.spyOn(backend, 'saveProgress')
  const updatePlayRequest = vi.spyOn(backend, 'updatePlayRequest').mockResolvedValue(undefined)
  window.history.replaceState({}, '', path)
  const view = render(<App backend={backend} detect={async () => browserContext()} />)
  return { backend, saveProgress, updatePlayRequest, ...view }
}

const adapter = () => created[created.length - 1]!
const playing = async (n = 1) => {
  await waitFor(() => expect(created[n - 1]?.load).toHaveBeenCalled(), { timeout: 5000 })
  return created[n - 1]!
}
const press = (key: string, keyCode: number) => act(() => void fireEvent.keyDown(window, { key, keyCode }))
const enter = () => press('Enter', 13)
const overlayMode = () => document.querySelector('.iplex-player__overlay')?.getAttribute('data-overlay-mode')
const time = (positionMs: number, durationMs: number, a = adapter()) => act(() => a.emit('time', { positionMs, durationMs }))

const MOVIE = '/assistir?s=demo-source&i=m-bbb&k=movie&t=Big'
const EPISODE = (e: string) => `/assistir?s=demo-source&i=s-demo&k=series&t=Demo&e=${e}`

beforeEach(() => {
  created.length = 0
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })))
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  sessionStorage.clear()
  localStorage.clear()
})

describe('player', () => {
  it('canal ao vivo: URL autorizada pelo backend, sem menu e sem linha do tempo', async () => {
    start('/assistir?s=demo-source&i=c-1&k=channel&t=Canal')
    await playing()
    expect(created[0]!.load.mock.calls[0]![0]).toMatchObject({ url: expect.stringContaining('bipbop'), live: true })
    expect(screen.queryByRole('navigation', { name: 'Menu principal' })).toBeNull()
    expect(await screen.findByText('Ao vivo')).toBeTruthy()
    enter()
    expect(await screen.findByRole('button', { name: 'Pausar' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Avançar 10 segundos' })).toBeNull()
    expect(screen.queryByRole('progressbar', { name: 'Posição' })).toBeNull()
    expect(screen.queryByRole('slider', { name: 'Posição' })).toBeNull()
  })

  it('1. filme do zero: sem posição inicial, sessão "restart", progresso salvo na saída', async () => {
    const { saveProgress, unmount } = start(MOVIE)
    const a = await playing()
    expect(a.load.mock.calls[0]![0]).not.toHaveProperty('startPositionMs')
    time(120_000, 600_000, a)
    unmount()
    await waitFor(() => expect(a.destroy).toHaveBeenCalled())
    expect(saveProgress).toHaveBeenCalledWith(expect.objectContaining({ contentId: 'm-bbb', positionSec: 120, durationSec: 600, session: expect.objectContaining({ origin: 'restart' }) }))
  })

  it('2. filme retomado da biblioteca: abre na posição salva e não grava zero antes de confirmar', async () => {
    const { saveProgress } = start(`${MOVIE}&r=1`, (b) => b.saveProgress({ profileId: 'admin', contentId: 'm-bbb', positionSec: 300, durationSec: 600, generation: 0 }))
    const a = await playing()
    expect(a.load.mock.calls[0]![0]).toMatchObject({ startPositionMs: 300_000 })
    saveProgress.mockClear()
    // Inicialização reporta 0: nada é gravado (apagaria o progresso válido).
    time(0, 600_000, a)
    act(() => a.emit('state', { state: 'paused' }))
    expect(saveProgress).not.toHaveBeenCalled()
    time(301_000, 600_000, a)
    act(() => a.emit('state', { state: 'paused' }))
    await waitFor(() => expect(saveProgress).toHaveBeenCalledWith(expect.objectContaining({ positionSec: 301, session: expect.objectContaining({ origin: 'resume' }) })))
  })

  it('3. filme pedido pelo iPlex Control: posição do pedido e confirmação "started"', async () => {
    const { updatePlayRequest } = start(`${MOVIE}&r=1&ra=1234&pr=req-1`)
    const a = await playing()
    expect(a.load.mock.calls[0]![0]).toMatchObject({ startPositionMs: 1_234_000 })
    await waitFor(() => expect(updatePlayRequest).toHaveBeenCalledWith('req-1', 'started', undefined))
  })

  it('relógios: ao iniciar os dois marcam 00:00 e depois mostram os valores reais', async () => {
    start(MOVIE)
    const a = await playing()
    // Antes de qualquer evento de tempo: posição e duração em 00:00 (nunca "--:--").
    expect(screen.getAllByText('00:00').length).toBe(2)
    expect(screen.queryByText('--:--')).toBeNull()
    time(30_000, 600_000, a)
    expect(screen.getByText('00:30')).toBeTruthy()
    expect(screen.getByText('10:00')).toBeTruthy()
  })

  it('barra de posição selecionada: moldura própria para o anel externo (vão interno transparente)', async () => {
    start(MOVIE)
    const a = await playing()
    time(100_000, 1_000_000, a)
    enter()
    const bar = await screen.findByRole('slider', { name: 'Posição' })
    expect(bar.parentElement?.classList.contains('iplex-player__bar-frame')).toBe(true)
  })

  it('4–6. overlay inicial informativo, some após 5 s e OK abre os controles interativos', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    start(MOVIE)
    const a = await playing()
    time(38 * 60_000 + 12_000, 2 * 3_600_000 + 15 * 60_000, a)
    expect(overlayMode()).toBe('info')
    expect(screen.getByText('00:38:12')).toBeTruthy()
    expect(screen.getByText('02:15:00')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Pausar' })).toBeNull()
    act(() => void vi.advanceTimersByTime(5_100))
    expect(overlayMode()).toBe('hidden')
    expect(a.pause).not.toHaveBeenCalled()
    enter()
    expect(overlayMode()).toBe('interactive')
    const toggle = await screen.findByRole('button', { name: 'Pausar' })
    await waitFor(() => expect(document.activeElement).toBe(toggle))
    // OK que abre os controles não aciona o botão.
    expect(a.pause).not.toHaveBeenCalled()
    // Cada interação reinicia os 5 s.
    act(() => void vi.advanceTimersByTime(4_000))
    press('ArrowRight', 39)
    act(() => void vi.advanceTimersByTime(4_000))
    expect(overlayMode()).toBe('interactive')
    act(() => void vi.advanceTimersByTime(1_200))
    expect(overlayMode()).toBe('hidden')
  })

  it('7. ±10 s: seek pedido ao player e só aplicado na barra após confirmação', async () => {
    start(MOVIE)
    const a = await playing()
    time(120_000, 600_000, a)
    enter()
    fireEvent.click(await screen.findByRole('button', { name: 'Avançar 10 segundos' }))
    expect(a.seek).toHaveBeenLastCalledWith(130_000)
    expect(screen.getByRole('slider', { name: 'Posição' }).getAttribute('aria-valuenow')).toBe('20')
    expect(screen.getByText(/Buscando 02:10/)).toBeTruthy()
    time(130_000, 600_000, a)
    expect(screen.queryByText(/Buscando/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Voltar 10 segundos' }))
    expect(a.seek).toHaveBeenLastCalledWith(120_000)
    // Limites da mídia: nunca antes do início.
    time(120_000, 600_000, a)
    time(4_000, 600_000, a)
    fireEvent.click(screen.getByRole('button', { name: 'Voltar 10 segundos' }))
    expect(a.seek).toHaveBeenLastCalledWith(0)
  })

  it('8. reproduzir/pausar reflete o estado real do player', async () => {
    start(MOVIE)
    const a = await playing()
    time(60_000, 600_000, a)
    enter()
    fireEvent.click(await screen.findByRole('button', { name: 'Pausar' }))
    expect(a.pause).toHaveBeenCalled()
    // Ainda "Pausar" até o player confirmar a pausa.
    expect(screen.getByRole('button', { name: 'Pausar' })).toBeTruthy()
    act(() => a.emit('state', { state: 'paused' }))
    fireEvent.click(screen.getByRole('button', { name: 'Reproduzir' }))
    expect(a.play).toHaveBeenCalled()
  })

  it('9. barra navegável: setas movem uma prévia, OK confirma; Voltar descarta', async () => {
    start(MOVIE)
    const a = await playing()
    time(100_000, 1_000_000, a)
    enter()
    const bar = await screen.findByRole('slider', { name: 'Posição' })
    act(() => bar.focus())
    press('ArrowRight', 39)
    press('ArrowRight', 39)
    expect(a.seek).not.toHaveBeenCalled()
    expect(screen.getByText(/Ir para 02:00/)).toBeTruthy()
    // A dica fica acima da barra, à direita das informações (não abaixo da barra).
    const hint = screen.getByText(/Ir para 02:00/)
    expect(hint.closest('.iplex-player__heading-row')).not.toBeNull()
    expect(hint.closest('.iplex-player__timeline')).toBeNull()
    enter()
    expect(a.seek).toHaveBeenLastCalledWith(120_000)
    press('ArrowLeft', 37)
    expect(screen.getByText(/Ir para 01:50/)).toBeTruthy()
    press('Escape', 27)
    expect(screen.queryByText(/Ir para/)).toBeNull()
    expect(window.location.pathname).toBe('/assistir')
  })

  it('10. com o overlay fechado, Esquerda/Direita não fazem seek', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    start(MOVIE)
    const a = await playing()
    time(100_000, 600_000, a)
    act(() => void vi.advanceTimersByTime(5_100))
    expect(overlayMode()).toBe('hidden')
    press('ArrowRight', 39)
    press('ArrowLeft', 37)
    expect(a.seek).not.toHaveBeenCalled()
    expect(overlayMode()).toBe('hidden')
  })

  it('11. série: nome, T1:E2 e título do episódio; selos só com dados confiáveis', async () => {
    start(EPISODE('102'))
    const a = await playing()
    expect(await screen.findByText('T1:E2')).toBeTruthy()
    expect(screen.getByText('Episódio de demonstração 2')).toBeTruthy()
    expect(screen.queryByRole('list', { name: 'Informações técnicas' })).toBeNull()
    act(() => a.emit('media', { width: 1920, height: 1080 }))
    expect(screen.getByText('Full HD')).toBeTruthy()
  })

  it('12–13, 18. próximo episódio nos últimos 30 s; contagem segue o tempo real e não sobrepõe o overlay', async () => {
    start(EPISODE('102'))
    const a = await playing()
    time(500_000, 600_000, a)
    expect(screen.queryByRole('button', { name: /^Próximo episódio em \d+s$/ })).toBeNull()
    time(580_000, 600_000, a)
    expect(await screen.findByRole('button', { name: /^Próximo episódio em \d+s$/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Próximo episódio em 20s' })).toBeTruthy()
    // Nasce focado no controle remoto.
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Próximo episódio em 20s' }))
    // Só o botão (sem cartão, rótulo do episódio nem contador separado).
    expect(screen.queryByText('T1:E3 · Episódio de demonstração 3')).toBeNull()
    expect(screen.queryByRole('timer')).toBeNull()
    // Pausado: sem eventos de tempo, a contagem não anda.
    act(() => a.emit('state', { state: 'paused' }))
    await new Promise((r) => setTimeout(r, 1_100))
    expect(screen.getByRole('button', { name: 'Próximo episódio em 20s' })).toBeTruthy()
    time(585_000, 600_000, a)
    expect(screen.getByRole('button', { name: 'Próximo episódio em 15s' })).toBeTruthy()
    // Seek para trás sai da janela.
    time(400_000, 600_000, a)
    expect(screen.queryByRole('button', { name: /^Próximo episódio em/ })).toBeNull()
    // Overlay interativo e botão juntos: o botão fica no canto superior direito, fora do overlay e sem mexer no painel.
    enter()
    time(590_000, 600_000, a)
    const overlay = document.querySelector('.iplex-player__overlay')!
    expect(overlay.classList.contains('has-next')).toBe(false)
    // Sem indicador de carregamento no centro da tela durante a reprodução.
    expect(document.querySelector('.iplex-player__buffering')).toBeNull()
    expect(overlay.contains(screen.getByRole('button', { name: /^Próximo episódio em \d+s$/ }))).toBe(false)
    // Pausado antes: o botão central oferece Reproduzir.
    expect(screen.getByRole('button', { name: 'Reproduzir' })).toBeTruthy()
  })

  it('14, 16. próximo episódio manual: atual concluído e o próximo começa do zero', async () => {
    const { saveProgress } = start(EPISODE('102'))
    const a = await playing()
    time(585_000, 600_000, a)
    fireEvent.click(await screen.findByRole('button', { name: /^Próximo episódio em \d+s$/ }))
    await waitFor(() => expect(saveProgress).toHaveBeenCalledWith(expect.objectContaining({ contentId: 's-demo_e102', positionSec: 600, durationSec: 600 })))
    const next = await playing(2)
    expect(window.location.search).toContain('e=103')
    expect(window.location.search).not.toContain('r=1')
    expect(next.load.mock.calls[0]![0]).not.toHaveProperty('startPositionMs')
    expect(a.destroy).toHaveBeenCalled()
    expect(saveProgress.mock.calls.filter(([w]) => w.contentId === 's-demo_e102').at(-1)![0]).toMatchObject({ positionSec: 600 })
  })

  it('15. contagem chega a zero: próximo episódio automático', async () => {
    const { saveProgress } = start(EPISODE('103'))
    const a = await playing()
    time(590_000, 600_000, a)
    time(600_000, 600_000, a)
    await playing(2)
    expect(window.location.search).toContain('e=201')
    expect(saveProgress).toHaveBeenCalledWith(expect.objectContaining({ contentId: 's-demo_e103', positionSec: 600 }))
  })

  it('17. último episódio disponível: sem botão; o fim conclui e sai do player', async () => {
    const { saveProgress } = start(EPISODE('203'))
    const a = await playing()
    time(590_000, 600_000, a)
    expect(screen.queryByRole('button', { name: /^Próximo episódio em \d+s$/ })).toBeNull()
    act(() => a.emit('ended', {}))
    await waitFor(() => expect(window.location.pathname).toBe('/titulo/demo-source/s-demo'))
    expect(saveProgress).toHaveBeenCalledWith(expect.objectContaining({ contentId: 's-demo_e203', positionSec: 600 }))
    expect(created).toHaveLength(1)
  })

  it('19. Voltar salva, encerra o player e abre os detalhes do conteúdo', async () => {
    const { saveProgress } = start(MOVIE)
    const a = await playing()
    time(200_000, 600_000, a)
    press('Escape', 27)
    await waitFor(() => expect(window.location.pathname).toBe('/titulo/demo-source/m-bbb'))
    expect(a.destroy).toHaveBeenCalled()
    expect(saveProgress).toHaveBeenCalledWith(expect.objectContaining({ contentId: 'm-bbb', positionSec: 200 }))
  })

  it('19–20. a partir dos detalhes: Voltar e o fim natural retornam aos detalhes, sem reiniciar', async () => {
    start('/titulo/demo-source/m-bbb?t=Big')
    fireEvent.click(await screen.findByRole('button', { name: 'Assistir agora' }, { timeout: 5000 }))
    const a = await playing()
    time(200_000, 600_000, a)
    press('Escape', 27)
    await screen.findByRole('button', { name: 'Continuar' })
    expect(window.location.pathname).toBe('/titulo/demo-source/m-bbb')
    fireEvent.click(screen.getByRole('button', { name: 'Assistir do início' }))
    const b = await playing(2)
    time(599_500, 600_000, b)
    act(() => b.emit('ended', {}))
    await waitFor(() => expect(window.location.pathname).toBe('/titulo/demo-source/m-bbb'))
    // Concluído: nada de "Continuar" e nenhuma nova reprodução automática.
    expect(await screen.findByRole('button', { name: 'Assistir agora' })).toBeTruthy()
    expect(created).toHaveLength(2)
  })

  it('término inesperado (longe do fim) não conclui: erro com nova tentativa', async () => {
    const { saveProgress } = start(MOVIE)
    const a = await playing()
    time(100_000, 600_000, a)
    act(() => a.emit('ended', {}))
    expect(await screen.findByText('Não foi possível reproduzir')).toBeTruthy()
    expect(saveProgress.mock.calls.some(([w]) => w.positionSec === 600)).toBe(false)
  })

  it('erro de reprodução mostra estado específico com nova tentativa', async () => {
    start(MOVIE)
    await playing()
    act(() => adapter().emit('error', { code: 'x', message: 'falha' }))
    expect(await screen.findByText('Não foi possível reproduzir')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeTruthy()
  })

  it('conteúdo sem fonte reproduzível: erro claro, nada é tocado', async () => {
    start('/assistir?s=demo-source&i=m-cosmos&k=movie&t=Cosmos')
    expect(await screen.findByText('Fonte IPTV indisponível', {}, { timeout: 5000 })).toBeTruthy()
    expect(created).toHaveLength(0)
  })
})

describe('detalhes', () => {
  it('abrir os detalhes não resolve nem carrega mídia', async () => {
    const { backend } = start('/titulo/demo-source/m-bbb?t=Big')
    const resolve = vi.spyOn(backend, 'resolveStream')
    expect(await screen.findByRole('button', { name: 'Assistir agora' }, { timeout: 5000 })).toBeTruthy()
    expect(resolve).not.toHaveBeenCalled()
    expect(created).toHaveLength(0)
  })

  it('episódio com progresso: escolher entre Continuar e Assistir do início', async () => {
    start('/titulo/demo-source/s-demo?t=Demo', (b) => b.saveProgress({ profileId: 'admin', contentId: 's-demo_e102', positionSec: 120, durationSec: 600, generation: 0 }))
    expect(await screen.findByRole('button', { name: 'Continuar T1:E2' }, { timeout: 5000 })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Temporadas' }))
    fireEvent.click(await screen.findByRole('button', { name: /Episódio 2:/ }, { timeout: 5000 }))
    expect(await screen.findByRole('dialog')).toBeTruthy()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Assistir do início' }))
    const a = await playing()
    expect(window.location.search).toContain('e=102')
    expect(window.location.search).not.toContain('r=1')
    expect(a.load.mock.calls[0]![0]).not.toHaveProperty('startPositionMs')
  })
})

describe('próximo episódio com os controles abertos', () => {
  it('ao surgir, o botão toma o foco mesmo com o overlay interativo', async () => {
    start(EPISODE('102'))
    const a = await playing()
    time(100_000, 600_000, a)
    enter()
    await screen.findByRole('button', { name: 'Pausar' })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Pausar' }))
    time(585_000, 600_000, a)
    const next = await screen.findByRole('button', { name: /^Próximo episódio em \d+s$/ })
    await waitFor(() => expect(document.activeElement).toBe(next))
  })
})
