import { beforeEach, describe, expect, it } from 'vitest'
import type { Backend } from '../api/backend'
import type { CatalogItem, DeviceIdentity, Profile } from '../api/types'
import { LibraryStore, type CatalogLookup } from './libraryStore'

const identity = { familyId: 'f', deviceId: 'd' } as DeviceIdentity
const profile = { id: 'p', type: 'regular', generations: {} } as unknown as Profile
const saved = { contentId: 'm1', itemId: 'm1', sourceId: 's', kind: 'movie', title: 'Guardado' }

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('iplex.library.index.v1.f.p', JSON.stringify({ m1: saved }))
})

const store = (lookup: CatalogLookup) => new LibraryStore({} as Backend, identity, profile, lookup)

describe('índice da biblioteca enquanto o catálogo carrega', () => {
  it('tipo ainda carregando (undefined): usa o índice do aparelho', () => {
    expect(store(() => undefined).indexed('m1')).toMatchObject({ title: 'Guardado' })
  })

  it('catálogo pronto sem o item (null): some (fonte ou permissões mudaram)', () => {
    expect(store(() => null).indexed('m1')).toBeNull()
  })

  it('catálogo com o item: os dados do catálogo valem', () => {
    const item = { id: 'm1', sourceId: 's', kind: 'movie', title: 'Do catálogo' } as CatalogItem
    expect(store((_id, kind) => (kind === 'movie' ? item : null)).indexed('m1')).toMatchObject({ title: 'Do catálogo' })
  })
})
