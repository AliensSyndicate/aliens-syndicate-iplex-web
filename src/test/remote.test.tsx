/**
 * Pedidos de reprodução do iPlex Control na TV (contrato v1): iniciar direto,
 * confirmar quando já há reprodução, esperar a escolha de perfil, falhas e
 * desvinculação sinalizada pelo ouvinte.
 */
import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../app/App'
import { createMockBackend } from '../dev/mock/mockBackend'
import { __resetPlayRequestReports, isPlaybackActive } from '../features/remote/playRequestReport'
import { browserContext } from '../platform/environment'
import { AppError } from '../services/api/errors'
import type { Backend } from '../services/api/backend'
import type { PlayRequestClaim, PlayRequestNotice } from '../services/api/types'

// Adaptador de reprodução falso: "tocando" logo após carregar (como AVPlay/Clappr reais).
vi.mock('../platform/playback/createAdapter', async () => {
  const { createEmitter } = await import('../platform/playback/types')
  return {
    createPlaybackAdapter: () => {
      const emitter = createEmitter()
      return {
        kind: 'clappr' as const,
        capabilities: { seek: true, audioTracks: false, subtitles: false },
        load: async () => emitter.emit('state', { state: 'playing' }),
        play: async () => undefined,
        pause: async () => undefined,
        stop: async () => undefined,
        seek: async () => undefined,
        getTracks: async () => [],
        selectTrack: async () => undefined,
        setSubtitlesVisible: async () => undefined,
        on: emitter.on,
        destroy: async () => undefined,
      }
    },
  }
})

const detect = async () => browserContext()

function start(path: string, scenario: string, patch: (base: Backend) => Partial<Backend> = () => ({})) {
  window.history.replaceState({}, '', `${path}${path.includes('?') ? '&' : '?'}mock=${scenario}`)
  const base = createMockBackend()
  let onPending: ((n: PlayRequestNotice) => void) | null = null
  let onError: ((r: 'revoked' | 'unavailable') => void) | null = null
  const updatePlayRequest = vi.fn(async () => undefined)
  const backend = {
    ...base,
    watchPlayRequests: (_identity, pending, error) => {
      onPending = pending
      onError = error
      return () => undefined
    },
    updatePlayRequest,
    ...patch(base),
  } as Backend
  window.history.replaceState({}, '', path)
  render(<App backend={backend} detect={detect} />)
  return {
    backend,
    updatePlayRequest,
    push: async (notice: Partial<PlayRequestNotice> = {}) => {
      await waitFor(() => expect(onPending).not.toBeNull(), { timeout: 5000 })
      act(() => onPending!({ id: 'r1', expiresAt: Date.now() + 60_000, requesterName: 'Ana', title: 'Sintel (2010)', ...notice }))
    },
    fail: async (reason: 'revoked' | 'unavailable') => {
      await waitFor(() => expect(onError).not.toBeNull(), { timeout: 5000 })
      act(() => onError!(reason))
    },
  }
}

const delivered = (id: string): PlayRequestClaim => ({
  id,
  status: 'delivered',
  request: { sourceId: 'demo-source', itemId: 'm-sintel', episodeId: null, episodeLabel: null, kind: 'movie', title: 'Sintel (2010)', requesterName: 'Ana' },
})

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })))
  __resetPlayRequestReports()
})
afterEach(() => {
  vi.unstubAllGlobals()
  sessionStorage.clear()
  localStorage.clear()
})

describe('pedido de reprodução do iPlex Control', { timeout: 15_000 }, () => {
  it('sem reprodução em andamento: inicia direto o conteúdo pedido', async () => {
    const claim = vi.fn(async (id: string) => delivered(id))
    const t = start('/', 'single', () => ({ claimPlayRequest: claim }))
    await waitFor(() => expect(window.location.pathname).toBe('/meu-iplex'), { timeout: 5000 })
    await t.push()
    await waitFor(() => expect(window.location.pathname).toBe('/assistir'), { timeout: 5000 })
    const q = new URLSearchParams(window.location.search)
    expect(q.get('i')).toBe('m-sintel')
    expect(q.get('k')).toBe('movie')
    expect(q.get('pr')).toBe('r1')
    expect(claim).toHaveBeenCalledWith('r1')
    expect(t.updatePlayRequest).not.toHaveBeenCalledWith('r1', 'confirming')
    // "started" só quando a mídia realmente toca.
    await waitFor(() => expect(t.updatePlayRequest).toHaveBeenCalledWith('r1', 'started', undefined))
  })

  it('com reprodução em andamento: pergunta na TV e mantém a atual se recusado', async () => {
    const t = start('/assistir?s=demo-source&i=m-bbb&k=movie&t=Big%20Buck%20Bunny%20(2008)', 'single', () => ({ claimPlayRequest: async (id) => delivered(id) }))
    await waitFor(() => expect(isPlaybackActive()).toBe(true), { timeout: 5000 })
    await t.push({ id: 'r2' })
    expect(await screen.findByText('Pedido de reprodução', {}, { timeout: 5000 })).toBeTruthy()
    expect(screen.getByText(/Ana quer assistir “Sintel \(2010\)” nesta TV/)).toBeTruthy()
    expect(t.updatePlayRequest).toHaveBeenCalledWith('r2', 'confirming')
    screen.getByRole('button', { name: 'Continuar assistindo' }).click()
    await waitFor(() => expect(t.updatePlayRequest).toHaveBeenCalledWith('r2', 'declined', 'busy'))
    expect(new URLSearchParams(window.location.search).get('i')).toBe('m-bbb')
  })

  it('player em erro não conta como reprodução em andamento: inicia direto', async () => {
    const t = start('/assistir?s=demo-source&i=nao-existe&k=movie&t=Inexistente', 'single', () => ({ claimPlayRequest: async (id) => delivered(id) }))
    expect(await screen.findByText('Conteúdo indisponível', {}, { timeout: 5000 })).toBeTruthy()
    await t.push({ id: 'r9' })
    await waitFor(() => expect(new URLSearchParams(window.location.search).get('i')).toBe('m-sintel'), { timeout: 5000 })
    expect(t.updatePlayRequest).not.toHaveBeenCalledWith('r9', 'confirming')
  })

  it('confirmado na TV: troca para o conteúdo pedido', async () => {
    const t = start('/assistir?s=demo-source&i=m-bbb&k=movie&t=Big%20Buck%20Bunny%20(2008)', 'single', () => ({ claimPlayRequest: async (id) => delivered(id) }))
    await waitFor(() => expect(isPlaybackActive()).toBe(true), { timeout: 5000 })
    await t.push({ id: 'r3' })
    ;(await screen.findByRole('button', { name: 'Assistir agora' }, { timeout: 5000 })).click()
    await waitFor(() => expect(new URLSearchParams(window.location.search).get('i')).toBe('m-sintel'))
    expect(new URLSearchParams(window.location.search).get('pr')).toBe('r3')
  })

  it('na seleção de perfis: avisa e espera o perfil antes de aceitar o pedido', async () => {
    const claim = vi.fn(async (id: string) => delivered(id))
    const t = start('/', 'default', () => ({ claimPlayRequest: claim }))
    expect(await screen.findByText('Quem está assistindo?', {}, { timeout: 5000 })).toBeTruthy()
    await t.push()
    expect(await screen.findByText(/Ana pediu para assistir “Sintel \(2010\)”\. Escolha um perfil para continuar\./)).toBeTruthy()
    expect(claim).not.toHaveBeenCalled()
    screen.getByRole('button', { name: /Infantil Demo, Infantil/ }).click()
    await waitFor(() => expect(claim).toHaveBeenCalledWith('r1'), { timeout: 5000 })
  })

  it('conteúdo não permitido ao perfil ativo: a TV avisa e não reproduz', async () => {
    const t = start('/', 'single', () => ({ claimPlayRequest: async (id) => ({ id, status: 'failed', errorCode: 'content-not-allowed' }) }))
    await waitFor(() => expect(window.location.pathname).toBe('/meu-iplex'), { timeout: 5000 })
    await t.push()
    expect(await screen.findByText(/não está disponível para o perfil atual/, {}, { timeout: 5000 })).toBeTruthy()
    expect(window.location.pathname).toBe('/meu-iplex')
  })

  it('pedido expirado não é aceito nem inicia nada', async () => {
    const claim = vi.fn(async (id: string) => delivered(id))
    const t = start('/', 'single', () => ({ claimPlayRequest: claim }))
    await waitFor(() => expect(window.location.pathname).toBe('/meu-iplex'), { timeout: 5000 })
    await t.push({ expiresAt: Date.now() - 1 })
    await new Promise((r) => setTimeout(r, 50))
    expect(claim).not.toHaveBeenCalled()
    expect(window.location.pathname).toBe('/meu-iplex')
  })

  it('ouvinte sem permissão (TV desvinculada com o app aberto) → volta à vinculação', async () => {
    const t = start('/', 'single', () => ({ heartbeat: async () => { throw new AppError('device-unpaired', 'device-revoked') } }))
    await waitFor(() => expect(window.location.pathname).toBe('/meu-iplex'), { timeout: 5000 })
    await t.fail('revoked')
    expect(await screen.findByText('Vincule esta TV à sua família', {}, { timeout: 5000 })).toBeTruthy()
  })
})
