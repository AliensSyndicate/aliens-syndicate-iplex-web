import { describe, expect, it } from 'vitest'
import { decideMatch, foldText, parseSourceTitle, similarity } from './matching.ts'

describe('parseSourceTitle', () => {
  it('remove ruído de qualidade/idioma e extrai o ano', () => {
    expect(parseSourceTitle('Matrix (1999) [FHD] DUB')).toMatchObject({ query: 'Matrix', year: 1999 })
    expect(parseSourceTitle('BR: Cidade de Deus - 2002')).toMatchObject({ query: 'Cidade de Deus', year: 2002 })
    expect(parseSourceTitle('O Auto da Compadecida 4K')).toMatchObject({ query: 'O Auto da Compadecida', year: null })
  })
  it('separa temporada/episódio', () => {
    expect(parseSourceTitle('Dark S02E05')).toMatchObject({ query: 'Dark', season: 2, episode: 5 })
    expect(parseSourceTitle('Friends 1x02')).toMatchObject({ query: 'Friends', season: 1, episode: 2 })
  })
  it('não corta títulos que começam com palavras de ruído quando são o único conteúdo', () => {
    expect(parseSourceTitle('HD').query).toBe('HD')
  })
  it('normaliza acentos e pontuação', () => {
    expect(foldText('Ação & Reação!')).toBe('acao e reacao')
  })
})

describe('decideMatch', () => {
  const c = (id: number, title: string, year: number | null, originalTitle = title) => ({ id, title, originalTitle, year, popularity: 1 })

  it('aceita correspondência exata com ano', () => {
    const d = decideMatch(parseSourceTitle('Matrix (1999)'), [c(603, 'Matrix', 1999, 'The Matrix'), c(604, 'Matrix Reloaded', 2003)])
    expect(d.status).toBe('matched')
    expect(d.candidate?.id).toBe(603)
  })
  it('usa o título original', () => {
    const d = decideMatch(parseSourceTitle('The Matrix 1999'), [c(603, 'Matrix', 1999, 'The Matrix')])
    expect(d.candidate?.id).toBe(603)
  })
  it('é ambíguo com dois candidatos fortes e sem ano para desempatar', () => {
    const d = decideMatch(parseSourceTitle('Duna'), [c(1, 'Duna', 1984), c(2, 'Duna', 2021)])
    expect(d.status).toBe('ambiguous')
    expect(d.candidate).toBeNull()
  })
  it('o ano desempata títulos iguais', () => {
    const d = decideMatch(parseSourceTitle('Duna (2021)'), [c(1, 'Duna', 1984), c(2, 'Duna', 2021)])
    expect(d.candidate?.id).toBe(2)
  })
  it('recusa baixa confiança por semelhança textual fraca', () => {
    expect(decideMatch(parseSourceTitle('Batman'), [c(9, 'Batmóvel: a história', 2010)]).status).toBe('not_found')
  })
  it('ano muito diferente derruba a confiança', () => {
    expect(decideMatch(parseSourceTitle('Psicose (1960)'), [c(1, 'Psicose', 1998)]).status).toBe('not_found')
  })
  it('similaridade simétrica e limitada', () => {
    expect(similarity('abc', 'abc')).toBe(1)
    expect(similarity('', 'abc')).toBe(0)
  })
})
