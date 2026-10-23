import { describe, expect, it, vi } from 'vitest'
import type { CatalogItem } from '../api/types'
import { findCatalogTitle } from './tmdbAvailability'

const item = (id: string, kind: CatalogItem['kind'], title: string): CatalogItem => ({ id, sourceId: 's', kind, title, category: '', providerRef: id, version: '1' })
const matched = (tmdbId: number) => ({ status: 'matched' as const, confidence: 1, sourceTitle: '', query: '', year: null, summary: { tmdbId } as never })

describe('findCatalogTitle', () => {
  it('abre só o mesmo título (mesmo id TMDB) e do mesmo tipo', async () => {
    const search = vi.fn(async () => [item('a', 'series', 'Matrix'), item('b', 'movie', 'Matrix (1999)'), item('c', 'movie', 'Matrix Reloaded')])
    const match = vi.fn(async (c: CatalogItem) => matched(c.id === 'b' ? 603 : 604))
    expect((await findCatalogTitle(search, match, { tmdbId: 603, kind: 'movie', title: 'Matrix' }))?.id).toBe('b')
    expect(match).not.toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }))
  })

  it('nome parecido sem o mesmo id não é tratado como disponível; tenta o título original', async () => {
    const search = vi.fn(async (term: string) => (term === 'The Matrix' ? [item('x', 'movie', 'The Matrix')] : [item('y', 'movie', 'Matrix')]))
    const match = vi.fn(async (c: CatalogItem) => (c.id === 'x' ? matched(603) : matched(1)))
    expect((await findCatalogTitle(search, match, { tmdbId: 603, kind: 'movie', title: 'Matrix', originalTitle: 'The Matrix' }))?.id).toBe('x')
    expect(await findCatalogTitle(async () => [item('y', 'movie', 'Matrix')], async () => matched(1), { tmdbId: 603, kind: 'movie', title: 'Matrix' })).toBeNull()
  })
})
