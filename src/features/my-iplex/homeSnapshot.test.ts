import { beforeEach, describe, expect, it } from 'vitest'
import type { CatalogItem } from '../../services/api/types'
import { readHomeSnapshot, writeHomeSnapshot } from './homeSnapshot'

const item = (id: string, extra: Partial<CatalogItem> = {}) => ({ id, sourceId: 's', kind: 'movie', title: id, providerRef: id, version: 'v', ...extra }) as CatalogItem

beforeEach(() => localStorage.clear())

describe('foto dos lançamentos do Meu iPlex', () => {
  it('guarda só campos de exibição, até 20 itens, e devolve na mesma ordem', () => {
    const list = Array.from({ length: 25 }, (_, i) => item(`m${i}`, { year: 2026, addedAt: 100 - i, ...({ streamUrl: 'x' } as object) }))
    writeHomeSnapshot('k', list)
    const back = readHomeSnapshot('k')
    expect(back).toHaveLength(20)
    expect(back[0]).toEqual({ id: 'm0', sourceId: 's', kind: 'movie', title: 'm0', year: 2026, addedAt: 100, providerRef: 'm0', version: 'v' })
    expect(JSON.stringify(back)).not.toContain('streamUrl')
  })

  it('nunca guarda nem devolve adulto ou canal', () => {
    writeHomeSnapshot('k', [item('a', { isAdult: true }), item('c', { kind: 'channel' }), item('ok', { kind: 'series' })])
    expect(readHomeSnapshot('k').map((i) => i.id)).toEqual(['ok'])
    localStorage.setItem('k', JSON.stringify([item('x', { isAdult: true }), { foo: 1 }]))
    expect(readHomeSnapshot('k')).toEqual([])
  })
})
