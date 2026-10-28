import { describe, expect, it } from 'vitest'
import { buildSidebar, isAdultCategory, sortItems, sortOptionsFor } from './collections'
import type { CatalogItem } from '../../services/api/types'

const item = (title: string): CatalogItem => ({ id: title, sourceId: 's', kind: 'movie', title, category: '', providerRef: '', version: '' })

describe('menu lateral do catálogo', () => {
  const categories = [
    { key: 'terror', name: 'Terror' },
    { key: 'adulto', name: 'Adulto +18' },
    { key: 'acao', name: 'Ação' },
    { key: 'drama', name: 'Drama' },
  ]
  it('ordem: continuar, favoritos, todos, categorias A–Z e adulto por último', () => {
    const ids = buildSidebar({ personal: true, allowAdult: true, categories }).map((e) => e.label)
    expect(ids).toEqual(['Continuar assistindo', 'Favoritos', 'Todos', 'Ação', 'Drama', 'Terror', 'Adulto +18'])
  })
  it('"Adulto" é sempre o último item do menu, mesmo com mais categorias depois na ordem alfabética', () => {
    const labels = buildSidebar({ personal: true, allowAdult: true, categories: [...categories, { key: 'zen', name: 'Zen' }, { key: 'xxx', name: 'XXX' }] }).map((e) => e.label)
    expect(labels[labels.length - 1]).toMatch(/xxx|adulto/i)
    expect(labels.indexOf('Zen')).toBeLessThan(labels.indexOf('Adulto +18'))
  })
  it('tela Adulto: só as categorias fixas, sem Todos, Continuar nem Favoritos', () => {
    const labels = buildSidebar({ personal: false, allowAdult: true, showAll: false, categories: [{ key: 'adult-series', name: 'Séries' }, { key: 'adult-live', name: 'Ao Vivo' }, { key: 'adult-movies', name: 'Filmes' }], has: { all: true } }).map((e) => e.label)
    expect(labels).toEqual(['Ao Vivo', 'Filmes', 'Séries'])
  })
  it('adulto só quando permitido; visitante sem coleções pessoais', () => {
    const labels = buildSidebar({ personal: false, allowAdult: false, categories }).map((e) => e.label)
    expect(labels).toEqual(['Todos', 'Ação', 'Drama', 'Terror'])
  })
  it('não inventa gêneros: sem categorias do fornecedor, só as coleções fixas', () => {
    expect(buildSidebar({ personal: true, allowAdult: true, categories: [] }).map((e) => e.id)).toEqual(['continue', 'favorites', 'all'])
  })
  it('detecta categorias adultas pelo nome', () => {
    expect(isAdultCategory('Conteúdo Adulto')).toBe(true)
    expect(isAdultCategory('XXX')).toBe(true)
    expect(isAdultCategory('Ação')).toBe(false)
    expect(isAdultCategory('Adultos e Crianças')).toBe(true)
  })
})

describe('ordenação', () => {
  const items = [item('Zebra'), item('árvore'), item('Casa 10'), item('Casa 2')]
  it('A–Z é alfabético, acentos e números naturais', () => {
    expect(sortItems(items, 'az').map((i) => i.title)).toEqual(['árvore', 'Casa 2', 'Casa 10', 'Zebra'])
  })
  it('Z–A inverte e não altera a lista original', () => {
    expect(sortItems(items, 'za').map((i) => i.title)).toEqual(['Zebra', 'Casa 10', 'Casa 2', 'árvore'])
    expect(items[0]!.title).toBe('Zebra')
  })
})

describe('ordenação por data de adição', () => {
  const dated = (title: string, addedAt?: number): CatalogItem => ({ ...item(title), ...(addedAt !== undefined ? { addedAt } : {}) })
  it('mais recentes primeiro; sem data no fim', () => {
    const list = [dated('B', 1), dated('A'), dated('C', 3)]
    expect(sortItems(list, 'added').map((i) => i.title)).toEqual(['C', 'B', 'A'])
  })
  it('a opção só aparece quando há datas reais', () => {
    expect(sortOptionsFor([dated('A')]).map((o) => o.id)).toEqual(['az', 'za'])
    expect(sortOptionsFor([dated('A', 5)]).map((o) => o.id)).toEqual(['az', 'za', 'added'])
  })
})

describe('menu lateral só com conteúdo', () => {
  const categories = [{ key: 'acao', name: 'Ação' }]
  it('oculta Continuar assistindo e Favoritos vazios', () => {
    const labels = buildSidebar({ personal: true, allowAdult: false, categories, has: { continue: false, favorites: false, all: true } }).map((e) => e.label)
    expect(labels).toEqual(['Todos', 'Ação'])
  })
  it('mostra as coleções pessoais quando têm itens', () => {
    const labels = buildSidebar({ personal: true, allowAdult: false, categories, has: { continue: true, favorites: false, all: true } }).map((e) => e.label)
    expect(labels).toEqual(['Continuar assistindo', 'Todos', 'Ação'])
  })
  it('mostra lista de desejo quando tem itens', () => {
    const labels = buildSidebar({ personal: true, allowAdult: false, categories, has: { continue: false, favorites: false, wishlist: true, all: true } }).map((e) => e.label)
    expect(labels).toEqual(['Lista de desejo', 'Todos', 'Ação'])
  })
  it('sem nada ainda, mantém Todos para haver um item selecionado', () => {
    const ids = buildSidebar({ personal: true, allowAdult: false, categories: [], has: { continue: false, favorites: false, all: false } }).map((e) => e.id)
    expect(ids).toEqual(['all'])
  })
})
