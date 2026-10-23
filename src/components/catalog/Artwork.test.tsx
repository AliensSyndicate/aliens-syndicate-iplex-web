import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Artwork } from './Artwork'

describe('Artwork', () => {
  it('sem imagem mostra o nome dentro do card', () => {
    render(<Artwork src={null} alt="" fallback="Título sem capa" />)
    expect(screen.getByText('Título sem capa')).toBeTruthy()
  })
  it('falha de carregamento troca a imagem pelo nome', () => {
    const { container } = render(<Artwork src="https://exemplo.invalid/x.jpg" alt="" fallback="Capa quebrada" />)
    expect(screen.queryByText('Capa quebrada')).toBeNull()
    fireEvent.error(container.querySelector('img')!)
    expect(screen.getByText('Capa quebrada')).toBeTruthy()
  })
  it('sem nome (metadados ainda carregando) não desenha texto', () => {
    const { container } = render(<Artwork src={null} alt="" fallback="" />)
    expect(container.querySelector('.iplex-artwork__fallback')).toBeNull()
  })
})
