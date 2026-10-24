import { beforeEach, describe, expect, it } from 'vitest'
import { addRecent, readRecents, recentKey, type RecentEntry } from './recentSearches'

const item = (id: string): RecentEntry => ({ type: 'item', kind: 'movie', sourceId: 's', itemId: id })
const person = (id: number): RecentEntry => ({ type: 'person', personId: id, name: `Ator ${id}`, photo: null, knownFor: 'Acting', scope: { sourceId: 's', itemId: 'i', title: 'T' } })

describe('recentes da busca (itens abertos)', () => {
  beforeEach(() => window.localStorage.clear())
  it('mais recente primeiro, sem repetir (item ou ator) e no máximo 20', () => {
    addRecent('f', 'p', item('a'))
    addRecent('f', 'p', person(7))
    addRecent('f', 'p', item('b'))
    addRecent('f', 'p', item('a'))
    expect(readRecents('f', 'p').map(recentKey)).toEqual(['i:a', 'i:b', 'p:7'])
    for (let i = 0; i < 30; i++) addRecent('f', 'p', item(`x${i}`))
    expect(readRecents('f', 'p')).toHaveLength(20)
  })
  it('é por perfil e ignora dados inválidos', () => {
    addRecent('f', 'a', item('a'))
    expect(readRecents('f', 'b')).toEqual([])
    window.localStorage.setItem('iplex.search.recent.v2.f.c', JSON.stringify([{ type: 'x' }, item('ok')]))
    expect(readRecents('f', 'c')).toEqual([item('ok')])
  })
})
