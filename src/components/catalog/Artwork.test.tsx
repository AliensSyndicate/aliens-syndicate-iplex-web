import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Artwork } from './Artwork'

describe('Artwork', () => {
  it('sem imagem mostra o nome dentro do card', () => {
    render(<Artwork src={null} alt="" fallback="Título sem capa" />)
    expect(screen.getByText('Título sem capa')).toBeTruthy()
  })
  it('com imagem, o nome fica no fundo e a imagem sobrepõe', () => {
    const { container } = render(<Artwork src="https://exemplo.invalid/x.jpg" alt="" fallback="Capa" />)
    const children = Array.from(container.querySelector('.iplex-artwork')!.children)
    expect(children[0]!.className).toContain('iplex-artwork__fallback')
    expect(children[1]!.tagName).toBe('IMG')
  })
  it('falha de carregamento remove a imagem e o nome continua visível', () => {
    const { container } = render(<Artwork src="https://exemplo.invalid/x.jpg" alt="" fallback="Capa quebrada" />)
    fireEvent.error(container.querySelector('img')!)
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByText('Capa quebrada')).toBeTruthy()
  })
  it('sem nome (metadados ainda carregando) não desenha texto', () => {
    const { container } = render(<Artwork src={null} alt="" fallback="" />)
    expect(container.querySelector('.iplex-artwork__fallback')).toBeNull()
  })
})
