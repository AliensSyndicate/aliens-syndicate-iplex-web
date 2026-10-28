import { describe, expect, it, vi } from 'vitest'
import { AppError } from '../api/errors'
import type { CatalogItem, CatalogPage } from '../api/types'
import { CatalogStore } from './catalogStore'
import { episodeContentId, normalizeSeriesDetails, parseEpisodeContentId } from './normalize'

const item = (id: string, kind: CatalogItem['kind'], category = 'Geral'): CatalogItem => ({ id, sourceId: 's1', kind, title: id, category, categoryId: category, providerRef: id, version: 'v1' })

function backendWith(all: CatalogItem[], version = 'v1') {
  return {
    readCatalog: vi.fn(async (_p: string, q: { cursor?: number; search?: string }): Promise<CatalogPage> => {
      const list = all.filter((i) => !q.search || i.title.includes(q.search))
      const offset = q.cursor ?? 0
      return { version, items: list.slice(offset, offset + 30), categories: [{ id: 'Ação', name: 'Ação', kind: 'movie' }], cursor: offset + 30, hasMore: offset + 30 < list.length }
    }),
  }
}

describe('CatalogStore', () => {
  it('carrega páginas progressivamente e filtra por tipo no cliente', async () => {
    const all = [...Array.from({ length: 50 }, (_, i) => item(`m${i}`, 'movie', i % 2 ? 'Ação' : 'Drama')), ...Array.from({ length: 10 }, (_, i) => item(`c${i}`, 'channel'))]
    const backend = backendWith(all)
    const store = new CatalogStore(backend, 'admin', [{ sourceId: 's1', name: 'Fonte', kinds: ['movie', 'channel'] }])
    await store.ensure('movie', 1)
    expect(backend.readCatalog).toHaveBeenCalledTimes(1)
    expect(store.items('movie').length).toBe(30)
    expect(store.hasMore('movie')).toBe(true)
    await store.loadMore('movie')
    expect(store.items('movie').length).toBe(50)
    expect(store.items('channel').length).toBe(10)
    const names = store.categories('movie').map((c) => c.name)
    expect(names[0]).toBe('Ação') // ordem da fonte primeiro
  })

  it('a mesma categoria em várias fontes vira um único grupo com os itens de todas', async () => {
    const backend = {
      readCatalog: vi.fn(async (_p: string, q: { sourceId: string }): Promise<CatalogPage> => ({
        version: 'v1',
        items: [{ ...item(`${q.sourceId}-c`, 'channel', 'Notícias'), sourceId: q.sourceId }, { ...item(`${q.sourceId}-d`, 'channel', q.sourceId === 's1' ? 'notícias ' : 'Esportes'), sourceId: q.sourceId }],
        categories: [],
        cursor: 30,
        hasMore: false,
      })),
    }
    const store = new CatalogStore(backend, 'admin', [
      { sourceId: 's1', name: 'Fonte 1', kinds: ['channel'] },
      { sourceId: 's2', name: 'Fonte 2', kinds: ['channel'] },
    ])
    await store.ensure('channel', 1)
    const groups = store.categories('channel')
    expect(groups.map((g) => g.name)).toEqual(['Esportes', 'Notícias'])
    expect(groups.find((g) => g.name === 'Notícias')!.items.map((i) => i.id).sort()).toEqual(['s1-c', 's1-d', 's2-c'])
  })

  it('não consulta fontes sem o tipo pedido', async () => {
    const backend = backendWith([item('c1', 'channel')])
    const store = new CatalogStore(backend, 'kids', [{ sourceId: 's1', name: 'Fonte', kinds: ['channel'] }])
    await store.ensure('movie')
    expect(backend.readCatalog).not.toHaveBeenCalled()
  })

  it('localiza item por URL direta pela busca do backend (que aplica permissões)', async () => {
    const backend = backendWith([item('m-x', 'movie')])
    const store = new CatalogStore(backend, 'kids', [{ sourceId: 's1', name: 'Fonte', kinds: ['movie'] }])
    expect(await store.findItem('s1', 'm-x', 'm-x')).toMatchObject({ id: 'm-x' })
    expect(await store.findItem('s1', 'bloqueado', 'bloqueado')).toBeNull()
  })

  it('erro de fonte fica no tipo e permite recarregar', async () => {
    const backend = { readCatalog: vi.fn(async () => { throw new AppError('iptv-unavailable', 'provider-unavailable') }) }
    const store = new CatalogStore(backend, 'admin', [{ sourceId: 's1', name: 'Fonte', kinds: ['movie'] }])
    await store.ensure('movie')
    expect(store.errorFor('movie')?.kind).toBe('iptv-unavailable')
  })

  it('conteúdo não autorizado na busca não vira erro', async () => {
    const backend = { readCatalog: vi.fn(async () => { throw new AppError('content-unavailable', 'not-found') }) }
    const store = new CatalogStore(backend, 'kids', [{ sourceId: 's1', name: 'Fonte', kinds: ['movie'] }])
    expect(await store.search('x')).toEqual([])
  })
})

describe('normalize', () => {
  it('ordena temporadas e episódios do formato do backend', () => {
    const details = normalizeSeriesDetails('10', {
      seasons: [{ seasonNumber: 2, name: 'Segunda' }],
      episodes: { '2': [{ id: '22', title: 'b', season: 2, episodeNum: 2 }, { id: '21', title: 'a', season: 2, episodeNum: 1 }], '1': [{ id: 11, title: 'x', episodeNum: '1' }] },
    })
    expect(details?.seasons.map((s) => s.seasonNumber)).toEqual([1, 2])
    expect(details?.seasons[1]?.name).toBe('Segunda')
    expect(details?.seasons[1]?.episodes.map((e) => e.id)).toEqual(['21', '22'])
  })
  it('contentId de episódio cabe no idSchema do backend e é reversível', () => {
    const id = episodeContentId('a'.repeat(64), '12345')
    expect(id).toMatch(/^[A-Za-z0-9_-]{1,128}$/)
    expect(parseEpisodeContentId(id)).toEqual({ seriesItemId: 'a'.repeat(64), episodeId: '12345' })
  })
})

describe('CatalogStore.hydrate (seis conjuntos)', () => {
  const sets = {
    live: [{ id: 'c1', kind: 'channel', title: 'Canal', category: 'NOTICIAS', categoryId: '5', providerRef: '1' }],
    live_categories: [{ id: '5', name: 'NOTICIAS', kind: 'channel' }],
    vod: [
      { id: 'm1', kind: 'movie', title: 'A', category: 'AÇAO', categoryId: '10', providerRef: '1' },
      { id: 'm2', kind: 'movie', title: 'B', category: 'Action', categoryId: '11', providerRef: '2' },
    ],
    vod_categories: [
      { id: '10', name: 'AÇAO', kind: 'movie' },
      { id: '11', name: 'Action', kind: 'movie' },
    ],
    series: [],
    series_categories: [],
  }
  it('entrega a fonte completa, sem páginas pendentes, e agrupa categorias pelo nome padronizado', () => {
    const store = new CatalogStore({ readCatalog: vi.fn() }, 'p', [{ sourceId: 's1', name: 'F', kinds: ['movie', 'channel', 'series'] }])
    store.hydrate('s1', sets, 'v1')
    expect(store.items('movie')).toHaveLength(2)
    expect(store.items('channel')).toHaveLength(1)
    expect(store.hasMore('movie')).toBe(false)
    expect(store.isLoading('movie')).toBe(false)
    const groups = store.categories('movie')
    expect(groups.map((g) => g.name)).toEqual(['Ação'])
    expect(groups[0]!.items).toHaveLength(2)
    expect(store.categories('channel')[0]!.name).toBe('Notícias')
  })
  it('ids de categoria originais continuam distintos nos registros (só a exibição é unificada)', () => {
    const store = new CatalogStore({ readCatalog: vi.fn() }, 'p', [{ sourceId: 's1', name: 'F', kinds: ['movie'] }])
    store.hydrate('s1', sets, 'v1')
    expect(store.items('movie').map((i) => i.categoryId).sort()).toEqual(['10', '11'])
  })

  it('carregamento progressivo: isLoading por tipo até o grupo chegar, sem consultar o backend', async () => {
    const backend = backendWith([])
    const store = new CatalogStore(backend, 'admin', [{ sourceId: 's1', name: 'Fonte', kinds: ['movie', 'channel'] }])
    store.beginProgressive('s1', 'v1', false)
    expect(store.isLoading('movie')).toBe(true)
    expect(store.hasMore('movie')).toBe(false)
    await store.ensure('movie')
    expect(backend.readCatalog).not.toHaveBeenCalled()
    await store.fillGroup('s1', 'channel', [{ id: 'c', name: 'Notícias', kind: 'channel' }], [{ id: 'c1', kind: 'channel', title: 'Canal', categoryId: 'c' }])
    expect(store.isLoading('channel')).toBe(false)
    expect(store.isLoading('movie')).toBe(true)
    expect(store.items('channel').map((i) => i.id)).toEqual(['c1'])
    await store.fillGroup('s1', 'movie', [], Array.from({ length: 4500 }, (_, i) => ({ id: `m${i}`, kind: 'movie', title: `m${i}` })))
    expect(store.items('movie')).toHaveLength(4500)
    expect(store.isLoading('movie')).toBe(false)
    expect(store.findLoaded('m4499')?.sourceId).toBe('s1')
  })

  it('hydrateAsync troca a lista de uma vez e encerra o carregamento', async () => {
    const store = new CatalogStore(backendWith([]), 'admin', [{ sourceId: 's1', name: 'Fonte', kinds: ['movie'] }])
    store.beginProgressive('s1', 'v1', false)
    await store.fillGroup('s1', 'movie', [], [{ id: 'velho', kind: 'movie', title: 'velho' }])
    await store.hydrateAsync('s1', { live: [], vod: [{ id: 'novo', kind: 'movie', title: 'novo' }], series: [], live_categories: [], vod_categories: [], series_categories: [] }, 'v2')
    expect(store.items('movie').map((i) => i.id)).toEqual(['novo'])
    expect(store.isLoading('movie')).toBe(false)
  })

  it('findItem espera o carregamento do cache antes de consultar o backend', async () => {
    const backend = backendWith([])
    const store = new CatalogStore(backend, 'admin', [{ sourceId: 's1', name: 'Fonte', kinds: ['movie'] }])
    store.beginProgressive('s1', 'v1', false)
    const pending = store.findItem('s1', 'm1', 'm1')
    await store.fillGroup('s1', 'movie', [], [{ id: 'm1', kind: 'movie', title: 'm1' }])
    await store.fillGroup('s1', 'channel', [], [])
    await store.fillGroup('s1', 'series', [], [])
    expect((await pending)?.id).toBe('m1')
    expect(backend.readCatalog).not.toHaveBeenCalled()
  })
})
