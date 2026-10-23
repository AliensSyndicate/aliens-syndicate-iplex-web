import { describe, expect, it } from 'vitest'
import { categoryKey, categoryLabel, isAdultName } from './categoryLabels'

describe('de-para de categorias', () => {
  it('corrige acento e caixa, com a primeira letra maiúscula', () => {
    expect(categoryLabel('AÇAO')).toBe('Ação')
    expect(categoryLabel('ACAO')).toBe('Ação')
    expect(categoryLabel('comédia')).toBe('Comédia')
    expect(categoryLabel('FICCAO CIENTIFICA')).toBe('Ficção científica')
    expect(categoryLabel('DESENHOS')).toBe('Desenhos')
  })
  it('traduz nomes em inglês e espanhol', () => {
    expect(categoryLabel('Action')).toBe('Ação')
    expect(categoryLabel('Sci-Fi')).toBe('Ficção científica')
    expect(categoryLabel('Documental')).toBe('Documentário')
  })
  it('remove prefixos genéricos', () => {
    expect(categoryLabel('FILMES | AÇÃO')).toBe('Ação')
    expect(categoryLabel('Canais - Esportes')).toBe('Esportes')
  })
  it('padroniza os serviços de streaming', () => {
    expect(categoryLabel('HBO MAX')).toBe('HBO Max')
    expect(categoryLabel('APPLETV+')).toBe('Apple TV+')
    expect(categoryLabel('PARAMOUNT+')).toBe('Paramount+')
    expect(categoryLabel('AMAZON PRIME VIDEO')).toBe('Amazon Prime Video')
  })
  it('todas as variações adultas viram exatamente "Adulto"', () => {
    for (const name of ['ADULTOS', 'Adulto +18', 'XXX', '18+', 'Eróticos', 'Conteúdo Adulto', 'adult', 'PORN']) {
      expect(categoryLabel(name)).toBe('Adulto')
      expect(isAdultName(name)).toBe(true)
    }
    expect(isAdultName('Ação')).toBe(false)
  })
  it('sem regra: caixa de frase (como "Continuar assistindo"), siglas e marcas preservadas', () => {
    expect(categoryLabel('ESPECIAL DE FIM DE ANO')).toBe('Especial de fim de ano')
    expect(categoryLabel('canais UHD premium')).toBe('Canais UHD premium')
    expect(categoryLabel('SERIES 24 HORAS')).toBe('Séries 24 horas')
    expect(categoryLabel('YOUTUBE 24 HORAS')).toBe('YouTube 24 horas')
    expect(categoryLabel('FICÇÃO/FANTASIA')).toBe('Ficção e fantasia')
    expect(categoryLabel('  ')).toBe('Sem categoria')
  })
  it('nomes diferentes com o mesmo texto são o mesmo grupo', () => {
    expect(categoryKey('AÇAO')).toBe(categoryKey('Action'))
    expect(categoryKey('XXX')).toBe(categoryKey('Adultos'))
  })
})
