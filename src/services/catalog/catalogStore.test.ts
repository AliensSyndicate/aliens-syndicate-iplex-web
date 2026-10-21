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
