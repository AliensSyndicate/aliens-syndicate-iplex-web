import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ContentCarousel } from './ContentCarousel'

describe('ContentCarousel', () => {
  it('"Ver tudo" é o último elemento da própria fileira', () => {
    const onSeeAll = vi.fn()
    render(
      <ContentCarousel title="Favoritos" id="my-favorites" onSeeAll={onSeeAll}>
        <button data-nav="">A</button>
        <button data-nav="">B</button>
      </ContentCarousel>,
    )
    const track = screen.getByRole('list')
    const last = track.lastElementChild as HTMLElement
    expect(last.textContent).toBe('Ver tudo')
    last.click()
    expect(onSeeAll).toHaveBeenCalled()
  })
})
