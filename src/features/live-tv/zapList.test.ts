import { describe, expect, it } from 'vitest'
import type { CatalogItem } from '../../services/api/types'
import { neighbourChannel, zapList } from './zapList'

const ch = (id: string, title: string, over: Partial<CatalogItem> = {}): CatalogItem => ({ id, sourceId: 's', kind: 'channel', title, category: 'Geral', providerRef: id, version: 'v', ...over })

describe('troca de canal', () => {
  const channels = [ch('b', 'Beta'), ch('x', 'Canal XXX', { category: 'Adulto' }), ch('a', 'Alfa'), ch('c', 'Gama')]
  it('usa a lista Todos: A–Z e sem adultos', () => {
    expect(zapList(channels, 'a').map((c) => c.id)).toEqual(['a', 'b', 'c'])
  })
  it('quem assiste a canal adulto troca só entre adultos', () => {
    expect(zapList([...channels, ch('y', 'Outro XXX')], 'x').map((c) => c.id)).toEqual(['x', 'y'])
  })
  it('vizinho circular e sem troca quando só há um canal', () => {
    const list = zapList(channels, 'a')
    expect(neighbourChannel(list, 'a', 1)?.id).toBe('b')
    expect(neighbourChannel(list, 'a', -1)?.id).toBe('c')
    expect(neighbourChannel([ch('a', 'A')], 'a', 1)).toBeNull()
  })
})
