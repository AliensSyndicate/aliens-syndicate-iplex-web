import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BridgeClient } from '../../platform/bridge/client'
import { HEARTBEAT_MS, enableUnifiedStartup, resetStartupForTests } from '../../platform/startup'
import { SplashScreen } from './SplashScreen'

function fakeBridge() {
  const call = vi.fn(async (..._args: unknown[]) => undefined)
  return { client: { call } as unknown as BridgeClient, call }
}
const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0) })

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  resetStartupForTests()
})

describe('tela única de inicialização', () => {
  it('sem shell novo: o Web desenha o carregamento com o texto da etapa', () => {
    render(<SplashScreen label="Configurando filmes..." />)
    expect(screen.getAllByText('Configurando filmes...').length).toBeGreaterThan(0)
  })

  it('ordem fixa (logo, "Só um instante.", etapa) e versão sempre no rodapé', () => {
    const { container } = render(<SplashScreen label="Carregando perfis..." />)
    const order = Array.from(container.querySelectorAll('.iplex-splash > *')).map((el) => el.className.split(' ').find((c) => c.startsWith('iplex-splash__')))
    expect(order).toEqual(['iplex-splash__logo', 'iplex-splash__title', 'iplex-splash__status', 'iplex-splash__spinner', 'iplex-splash__version'])
    expect(container.querySelector('.iplex-splash__title')?.textContent).toBe('Só um instante.')
    expect(container.querySelector('.iplex-splash__version')?.textContent).toMatch(/^iPlex Web · versão \S+/)
  })

  it('com shell novo: não desenha nada e informa a etapa real ao shell', async () => {
    const { client, call } = fakeBridge()
    enableUnifiedStartup(client)
    const { container } = render(<SplashScreen label="Configurando conta..." />)
    expect(container.firstChild).toBeNull()
    expect(call).toHaveBeenCalledWith('app.status', { text: 'Configurando conta...' })
    expect(call).not.toHaveBeenCalledWith('app.show')
  })

  it('texto inicial padrão é "Verificando dispositivo..." e cada mudança de etapa é enviada', async () => {
    const { client, call } = fakeBridge()
    enableUnifiedStartup(client)
    const { rerender } = render(<SplashScreen />)
    expect(call).toHaveBeenLastCalledWith('app.status', { text: 'Verificando dispositivo...' })
    rerender(<SplashScreen label="Carregando perfis..." />)
    expect(call).toHaveBeenLastCalledWith('app.status', { text: 'Carregando perfis...' })
    rerender(<SplashScreen label="Tudo pronto!" />)
    expect(call).toHaveBeenLastCalledWith('app.status', { text: 'Tudo pronto!' })
  })

  it('batimento enquanto a etapa dura (o shell vigia o silêncio)', async () => {
    const { client, call } = fakeBridge()
    enableUnifiedStartup(client)
    render(<SplashScreen label="Configurando filmes..." />)
    call.mockClear()
    await act(async () => { await vi.advanceTimersByTimeAsync(HEARTBEAT_MS * 2 + 10) })
    expect(call).toHaveBeenCalledTimes(2)
    expect(call).toHaveBeenLastCalledWith('app.status', { text: 'Configurando filmes...' })
  })

  it('ao sair da tela de carregamento revela o Web uma única vez; trocar de tela de carregamento não revela', async () => {
    const { client, call } = fakeBridge()
    enableUnifiedStartup(client)
    const first = render(<SplashScreen label="A" />)
    first.unmount()
    const second = render(<SplashScreen label="B" />) // mesma passagem: não pode revelar entre as duas
    await flush()
    expect(call).not.toHaveBeenCalledWith('app.show')
    second.unmount()
    await flush()
    expect(call.mock.calls.filter(([method]) => method === 'app.show')).toHaveLength(1)
    // Depois de revelado o shell não controla mais: o Web volta a desenhar a própria tela.
    render(<SplashScreen label="Carregando de novo" />)
    expect(screen.getAllByText('Carregando de novo').length).toBeGreaterThan(0)
  })
})
