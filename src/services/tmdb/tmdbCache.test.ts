import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTmdbClient } from './tmdbClient'

beforeEach(() => localStorage.clear())

describe('cache local das correspondências TMDB', () => {
  it('repete a consulta só uma vez por item (memória) e a guarda no aparelho', async () => {
    vi.useFakeTimers()
    const result = { status: 'matched', confidence: 1, summary: { tmdbId: 1, kind: 'movie', title: 'T', poster: 'p', backdrop: 'b' } }
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => result })) as unknown as typeof fetch
    const client = createTmdbClient({ getIdToken: async () => null, getAppCheckToken: async () => null }, fetchImpl)
    const item = { sourceId: 's', id: 'i' }
    await client.match('movie', 'T', 2020, item)
    await client.match('movie', 'T', 2020, item)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(2000)
    expect(localStorage.getItem('iplex.tmdb.match.v1')).toContain('"s:i"')
    // Novo cliente (nova abertura do app): lê do aparelho, sem rede.
    const again = createTmdbClient({ getIdToken: async () => null, getAppCheckToken: async () => null }, fetchImpl)
    await again.match('movie', 'T', 2020, item)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })
})
