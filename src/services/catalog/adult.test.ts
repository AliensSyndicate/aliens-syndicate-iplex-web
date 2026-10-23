import { describe, expect, it, vi } from 'vitest'
import { contentPath } from '../../app/routes/paths'
import type { CatalogItem, CatalogPage } from '../api/types'
import { isAdultItem } from './adult'
import { CatalogStore } from './catalogStore'
import { ADULT_LABEL } from './categoryLabels'
import { LibraryStore, indexFromItem } from '../library/libraryStore'

const mk = (id: string, over: Partial<CatalogItem> = {}): CatalogItem => ({ id, sourceId: 's1', kind: 'movie', title: id, category: 'Ação', categoryId: 'a', providerRef: id, version: 'v1', ...over })

describe('conteúdo adulto', () => {
  it('detecta por categoria, título, classificação 18 e marca do provedor', () => {
    expect(isAdultItem(mk('x', { category: 'Adulto +18' }))).toBe(true)
    expect(isAdultItem(mk('Filme XXX'))).toBe(true)
    expect(isAdultItem(mk('x', { ageRating: '18' }))).toBe(true)
    expect(isAdultItem(mk('x', { ageRating: '18 anos' }))).toBe(true)
    expect(isAdultItem(mk('x', { isAdult: true }))).toBe(true)
    expect(isAdultItem(mk('Sexo e a Cidade'))).toBe(false)
    expect(isAdultItem(mk('Ação Total', { ageRating: '16' }))).toBe(false)
  })

  it('o catálogo agrupa todo item adulto em "Adulto", e só ali', async () => {
    const all = [mk('ok1'), mk('ok2'), mk('Filme XXX'), mk('x3', { ageRating: '18' }), mk('x4', { category: 'Erótico', categoryId: 'e' })]
    const backend = { readCatalog: vi.fn(async (): Promise<CatalogPage> => ({ version: 'v1', items: all, categories: [], cursor: 5, hasMore: false })) }
    const store = new CatalogStore(backend, 'p', [{ sourceId: 's1', name: 'F', kinds: ['movie'] }])
    await store.ensure('movie', 1)
    const groups = store.categories('movie')
    const adult = groups.find((g) => g.name === ADULT_LABEL)
    expect(adult?.items.map((i) => i.id).sort()).toEqual(['Filme XXX', 'x3', 'x4'])
    for (const g of groups.filter((x) => x.name !== ADULT_LABEL)) expect(g.items.some(isAdultItem)).toBe(false)
  })

  it('nunca abre detalhes: filme toca direto, série vai aos episódios', () => {
    expect(contentPath(mk('a', { title: 'Filme XXX' }))).toContain('/assistir')
    expect(contentPath(mk('a', { kind: 'series', title: 'Série XXX' }))).toContain('/temporadas')
    expect(contentPath(mk('b'))).toContain('/titulo/')
    expect(contentPath(mk('b', { kind: 'series' }))).not.toContain('/temporadas')
  })

  it('a biblioteca não grava favorito nem progresso de conteúdo adulto', async () => {
    const backend = { setFavorite: vi.fn(async () => ({})), saveProgress: vi.fn(async () => ({})) }
    const store = new LibraryStore(backend as never, { familyId: 'f', deviceId: 'd' } as never, { id: 'p', name: 'P', type: 'admin', generations: { favorites: 0, watched: 0, progress: 0 }, permissionsVersion: 1 } as never)
    const adult = mk('Filme XXX')
    await store.setFavorite(adult, true)
    await store.saveProgress(adult.id, 10, 100, indexFromItem(adult))
    expect(backend.setFavorite).not.toHaveBeenCalled()
    expect(backend.saveProgress).not.toHaveBeenCalled()
  })
})
