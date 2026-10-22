import { describe, expect, it, vi } from 'vitest'
import { routeDiscovery, routeTmdb } from './router.ts'
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

describe('routeDiscovery (iPlex Control)', () => {
  const PERSON = {
    id: 6384, name: 'Keanu Reeves', biography: '',
    external_ids: { instagram_id: '@keanu', twitter_id: 'https://evil.example', imdb_id: 'nm0000206', facebook_id: null }, birthday: '1964-09-02', place_of_birth: 'Beirute', profile_path: '/k.jpg', known_for_department: 'Acting',
    combined_credits: {
      cast: [
        { id: 603, media_type: 'movie', title: 'Matrix', original_title: 'The Matrix', character: 'Neo', release_date: '1999-03-31', poster_path: '/p.jpg' },
        { id: 1, media_type: 'movie', title: 'Adulto', adult: true, release_date: '2001-01-01' },
        { id: 603, media_type: 'tv', name: 'Série 603', character: 'Ele mesmo', first_air_date: '2005-01-01', episode_count: 3 },
        { id: 9, media_type: 'movie', title: 'Sem data', character: 'X' },
      ],
      crew: [{ id: 603, media_type: 'movie', title: 'Matrix', job: 'Producer', release_date: '1999-03-31' }],
    },
  }
  it('pessoa: biografia com fallback, filmografia cronológica, sem adulto, filme ≠ série com mesmo id', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('/person/6384') && url.includes('en-US')) return { ok: true, status: 200, json: async () => ({ biography: 'Actor.' }) }
      if (url.includes('/person/6384')) return { ok: true, status: 200, json: async () => PERSON }
      return { ok: false, status: 404, json: async () => ({}) }
    })
    const service = createTmdbService({ readAccessToken: 'secret-token', fetchImpl })
    const res = await routeDiscovery(service, '/api/tmdb/discover/person/6384')
    expect(res.status).toBe(200)
    const body = res.body as { biography: string; photo: string; credits: { tmdbId: number; kind: string; character: string; job: string; year: number | null }[] }
    expect(body.biography).toBe('Actor.')
    expect(body.photo).toBe('https://image.tmdb.org/t/p/h632/k.jpg')
    expect(body.credits.map((c) => `${c.kind}:${c.tmdbId}`)).toEqual(['series:603', 'movie:603', 'movie:9'])
    expect(body.credits[1]).toMatchObject({ character: 'Neo', job: 'Producer', year: 1999 })
    expect((body as unknown as { social: unknown[] }).social).toEqual([
      { network: 'instagram', url: 'https://www.instagram.com/keanu/' },
      { network: 'imdb', url: 'https://www.imdb.com/name/nm0000206/' },
    ])
  })
  it('título adulto não é descoberto; caminhos fora da lista retornam 404', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ id: 5, title: 'X', adult: true, overview: 'x' }) }))
    const service = createTmdbService({ readAccessToken: 'secret-token', fetchImpl })
    expect((await routeDiscovery(service, '/api/tmdb/discover/movie/5')).status).toBe(404)
    expect((await routeDiscovery(service, '/api/tmdb/discover/search/multi')).status).toBe(404)
    expect((await routeDiscovery(service, '/api/tmdb/discover/person/abc')).status).toBe(404)
  })
  it('detalhes trazem id das pessoas do elenco e data completa', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ...MATRIX, credits: { cast: [{ id: 6384, name: 'Keanu Reeves', character: 'Neo', profile_path: '/k.jpg' }] } }) }))
    const service = createTmdbService({ readAccessToken: 'secret-token', fetchImpl })
    const body = (await routeDiscovery(service, '/api/tmdb/discover/movie/603')).body as { releaseDate: string; cast: { id: number; role: string }[] }
    expect(body.releaseDate).toBe('1999-03-31')
    expect(body.cast[0]).toMatchObject({ id: 6384, role: 'Neo' })
  })
  it('classificação brasileira com motivos e pôster original', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ...MATRIX, release_dates: { results: [{ iso_3166_1: 'US', release_dates: [{ certification: 'R', descriptors: ['x'] }] }, { iso_3166_1: 'BR', release_dates: [{ certification: '' }, { certification: '16', descriptors: ['Violência', 'Drogas', ''] }] }] } }) }))
    const service = createTmdbService({ readAccessToken: 'secret-token', fetchImpl })
    const body = (await routeDiscovery(service, '/api/tmdb/discover/movie/603')).body as { certification: string; certificationDescriptors: string[]; posterOriginal: string }
    expect(body.certification).toBe('16')
    expect(body.certificationDescriptors).toEqual(['Violência', 'Drogas'])
    expect(body.posterOriginal).toBe('https://image.tmdb.org/t/p/original/p.jpg')
  })
  it('falha do TMDB vira erro controlado (sem vazar detalhes)', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 429, json: async () => ({}) }))
    const service = createTmdbService({ readAccessToken: 'secret-token', fetchImpl })
    expect((await routeDiscovery(service, '/api/tmdb/discover/person/1')).status).toBe(503)
  })
})

describe('discovery: actor search and recommendations', () => {
  it('busca atores sem conteúdo adulto e valida a consulta', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('/search/person')) return { ok: true, status: 200, json: async () => ({ results: [{ id: 1, name: 'Zendaya', known_for_department: 'Acting', profile_path: '/z.jpg' }, { id: 2, name: 'X', adult: true }] }) }
      return { ok: false, status: 404, json: async () => ({}) }
    })
    const service = createTmdbService({ readAccessToken: 'secret-token', fetchImpl })
    const res = await routeDiscovery(service, '/api/tmdb/discover/search/person', new URLSearchParams({ q: 'zen' }))
    expect(res.body).toEqual({ results: [{ tmdbId: 1, name: 'Zendaya', knownFor: 'Acting', photo: 'https://image.tmdb.org/t/p/w185/z.jpg' }] })
    expect((await routeDiscovery(service, '/api/tmdb/discover/search/person', new URLSearchParams({ q: 'z' }))).status).toBe(400)
  })
  it('recomendações acompanham os detalhes', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ...MATRIX, recommendations: { results: [{ id: 604, title: 'Matrix Reloaded', release_date: '2003-05-15', poster_path: '/r.jpg' }, { id: 9, title: 'Adulto', adult: true }] } }) }))
    const service = createTmdbService({ readAccessToken: 'secret-token', fetchImpl })
    const body = (await routeDiscovery(service, '/api/tmdb/discover/movie/603')).body as { recommendations: unknown[] }
    expect(body.recommendations).toEqual([{ tmdbId: 604, kind: 'movie', title: 'Matrix Reloaded', year: 2003, poster: 'https://image.tmdb.org/t/p/w342/r.jpg' }])
  })
})
