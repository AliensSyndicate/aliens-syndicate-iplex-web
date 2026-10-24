import { describe, expect, it } from 'vitest'
import type { CatalogItem } from '../api/types'
import { foldText, searchItems } from './search'

const it_ = (id: string, title: string, over: Partial<CatalogItem> = {}): CatalogItem => ({ id, sourceId: 's', kind: 'movie', title, category: 'Geral', providerRef: id, version: 'v', ...over })

describe('busca no catálogo local', () => {
  it('ignora acentos e maiúsculas', () => {
    expect(foldText('  Ação  Total ')).toBe('acao total')
    expect(searchItems([it_('1', 'Ação Total')], 'ACAO').total).toBe(1)
  })
  it('ordena: começa com o termo, palavra que começa, contém; A–Z em cada grupo', () => {
    const list = [it_('c', 'Cidade das Estrelas'), it_('a', 'Estrelas do Mar'), it_('b', 'Mar de Estrelas'), it_('d', 'Superestrela')]
    expect(searchItems(list, 'estrela').items.map((i) => i.id)).toEqual(['a', 'c', 'b', 'd'])
  })
  it('nunca inclui conteúdo adulto e respeita o limite com o total real', () => {
    const list = [it_('1', 'Filme Legal'), it_('2', 'Filme XXX'), it_('3', 'Filme Bom'), it_('4', 'Filme Bonito')]
    const r = searchItems(list, 'filme', 2)
    expect(r.total).toBe(3)
    expect(r.items).toHaveLength(2)
    expect(r.items.some((i) => i.id === '2')).toBe(false)
  })
  it('termo vazio não devolve nada', () => {
    expect(searchItems([it_('1', 'A')], '  ').items).toEqual([])
  })
})
