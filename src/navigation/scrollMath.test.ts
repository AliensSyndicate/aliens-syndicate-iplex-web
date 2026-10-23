import { describe, expect, it } from 'vitest'
import { centeredTop, revealTop } from './scrollMath'

describe('centeredTop', () => {
  it('centraliza no meio da lista', () => {
    expect(centeredTop(1000, 60, 600, 3000)).toBe(730)
  })
  it('não passa do início nem do fim reais (sem espaço artificial)', () => {
    expect(centeredTop(0, 60, 600, 3000)).toBe(0)
    expect(centeredTop(100, 60, 600, 3000)).toBe(0)
    expect(centeredTop(3500, 60, 600, 3000)).toBe(3000)
  })
  it('lista menor que a área não rola', () => {
    expect(centeredTop(200, 60, 600, 0)).toBe(0)
  })
})

describe('revealTop', () => {
  it('não rola quando o item já está visível', () => {
    expect(revealTop(500, 600, 300, 800, 24, 5000)).toBe(500)
  })
  it('rola o mínimo para cima e para baixo', () => {
    expect(revealTop(500, 400, 300, 800, 24, 5000)).toBe(376)
    expect(revealTop(0, 700, 300, 800, 24, 5000)).toBe(224)
  })
  it('respeita os limites', () => {
    expect(revealTop(100, 0, 300, 800, 24, 5000)).toBe(0)
    expect(revealTop(0, 9000, 300, 800, 24, 5000)).toBe(5000)
  })
})

describe('faixa coberta pelo menu transparente (topInset)', () => {
  it('centraliza na área visível abaixo do menu', () => {
    expect(centeredTop(1000, 60, 1000, 5000, 160)).toBe(450)
  })
  it('o primeiro item fica no início real (scrollTop 0)', () => {
    expect(centeredTop(160, 68, 1000, 5000, 160)).toBe(0)
  })
  it('um item não fica atrás do menu ao rolar para cima', () => {
    expect(revealTop(1000, 900, 300, 1000, 24, 5000, 160)).toBe(716)
  })
})
