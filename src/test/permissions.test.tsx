/**
 * Mudança de permissões no Control (ex.: conteúdo adulto): a próxima batida de presença traz outra versão e a TV
 * relê o perfil e o catálogo em segundo plano, sem reiniciar a sessão.
 */
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../config/features', async (importOriginal) => {
  const original = await importOriginal<typeof import('../config/features')>()
  return { ...original, TIMING: { ...original.TIMING, leaseHeartbeatMs: 80 } }
})

const { App } = await import('../app/App')
const { createMockBackend } = await import('../dev/mock/mockBackend')
const { browserContext } = await import('../platform/environment')

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })))
})
afterEach(() => {
  vi.unstubAllGlobals()
  sessionStorage.clear()
  localStorage.clear()
})

describe('permissões do perfil mudam no Control', () => {
  it('nova versão no heartbeat: relê o perfil e refaz o catálogo, uma vez', async () => {
    window.history.replaceState({}, '', '/?mock=single')
    const real = createMockBackend()
    let version = 0
    const listProfiles = vi.fn(async () => (await real.listProfiles()).map((p) => ({ ...p, permissionsVersion: version })))
    const readCatalog = vi.fn(real.readCatalog)
    const backend = { ...real, listProfiles, readCatalog, heartbeat: async () => ({ playRequest: null, permissionsVersion: version, adultEnabled: true }) } as typeof real
    window.history.replaceState({}, '', '/')
    render(<App backend={backend} detect={async () => browserContext()} />)
    await screen.findByRole('navigation', { name: 'Menu principal' }, { timeout: 15000 })
    const profilesBefore = listProfiles.mock.calls.length
    const catalogBefore = readCatalog.mock.calls.length
    // Sem mudança: nada é refeito.
    await new Promise((r) => setTimeout(r, 400))
    expect(listProfiles.mock.calls.length).toBe(profilesBefore)
    // O administrador muda a permissão no Control.
    version = 5
    await waitFor(() => expect(listProfiles.mock.calls.length).toBeGreaterThan(profilesBefore), { timeout: 5000 })
    await waitFor(() => expect(readCatalog.mock.calls.length).toBeGreaterThan(catalogBefore), { timeout: 5000 })
    // Perfil atualizado: as batidas seguintes (mesma versão) não repetem o trabalho.
    const profilesAfter = listProfiles.mock.calls.length
    await new Promise((r) => setTimeout(r, 500))
    expect(listProfiles.mock.calls.length).toBe(profilesAfter)
  }, 40000)
})
