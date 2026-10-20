import { describe, expect, it, vi } from 'vitest'
import { routeTmdb } from './router.ts'
import { createTmdbService, TtlCache } from './service.ts'

function fakeFetch(responses: Record<string, unknown>) {
  return vi.fn(async (url: string, init: { headers: Record<string, string> }) => {
    expect(init.headers.Authorization).toBe('Bearer secret-token')
    const key = Object.keys(responses).find((k) => url.includes(k))
    if (!key) return { ok: false, status: 404, json: async () => ({}) }
    return { ok: true, status: 200, json: async () => responses[key] }
  })
}

const MATRIX = { id: 603, title: 'Matrix', original_title: 'The Matrix', release_date: '1999-03-31', overview: 'Neo…', vote_average: 8.2, vote_count: 100, poster_path: '/p.jpg', backdrop_path: '/b.jpg', popularity: 50 }

describe('routeTmdb', () => {
  it('casa título IPTV com TMDB e envia o token só no cabeçalho do servidor', async () => {
    const fetchImpl = fakeFetch({ '/search/movie': { results: [MATRIX] } })
    const service = createTmdbService({ readAccessToken: 'secret-token', fetchImpl })
    const res = await routeTmdb(service, '/api/tmdb/match', new URLSearchParams({ kind: 'movie', title: 'Matrix (1999) FHD' }))
    expect(res.status).toBe(200)
    const body = res.body as { status: string; summary: { tmdbId: number; poster: string }; sourceTitle: string }
    expect(body.status).toBe('matched')
    expect(body.summary.tmdbId).toBe(603)
    expect(body.summary.poster).toBe('https://image.tmdb.org/t/p/w342/p.jpg')
    expect(body.sourceTitle).toBe('Matrix (1999) FHD')
    expect(fetchImpl.mock.calls[0]![0]).toContain('language=pt-BR')
    expect(fetchImpl.mock.calls[0]![0]).not.toContain('secret-token')
  })

  it('usa cache para consultas repetidas', async () => {
    const fetchImpl = fakeFetch({ '/search/movie': { results: [MATRIX] } })
    const service = createTmdbService({ readAccessToken: 'secret-token', fetchImpl, cache: new TtlCache() })
    await routeTmdb(service, '/api/tmdb/match', new URLSearchParams({ kind: 'movie', title: 'Matrix 1999' }))
    await routeTmdb(service, '/api/tmdb/match', new URLSearchParams({ kind: 'movie', title: 'Matrix 1999' }))
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('não é um proxy aberto: caminhos fora da lista retornam 404', async () => {
    const fetchImpl = fakeFetch({})
    const service = createTmdbService({ readAccessToken: 'secret-token', fetchImpl })
    expect((await routeTmdb(service, '/api/tmdb/account/1/lists', new URLSearchParams())).status).toBe(404)
    expect((await routeTmdb(service, '/api/tmdb/match', new URLSearchParams({ kind: 'person', title: 'x' }))).status).toBe(400)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('detalhes de filme com classificação BR e fallback de sinopse', async () => {
    const fetchImpl = fakeFetch({
      'language=pt-BR': { ...MATRIX, overview: '', runtime: 136, genres: [{ name: 'Ação' }], credits: { cast: [{ name: 'Keanu Reeves', character: 'Neo' }], crew: [{ name: 'Lana Wachowski', job: 'Director' }] }, release_dates: { results: [{ iso_3166_1: 'BR', release_dates: [{ certification: '14' }] }] } },
      'language=en-US': { overview: 'English overview' },
    })
    const service = createTmdbService({ readAccessToken: 'secret-token', fetchImpl })
    const res = await routeTmdb(service, '/api/tmdb/movie/603', new URLSearchParams())
    expect(res.body).toMatchObject({ certification: '14', runtimeMinutes: 136, overview: 'English overview', genres: ['Ação'] })
  })

  it('mapeia erros do TMDB sem vazar detalhes', async () => {
    const service = createTmdbService({ readAccessToken: 'secret-token', fetchImpl: async () => ({ ok: false, status: 429, json: async () => ({}) }) })
    const res = await routeTmdb(service, '/api/tmdb/tv/1', new URLSearchParams())
    expect(res.status).toBe(503)
  })

  it('exige token', () => {
    expect(() => createTmdbService({ readAccessToken: '' })).toThrow()
  })
})
