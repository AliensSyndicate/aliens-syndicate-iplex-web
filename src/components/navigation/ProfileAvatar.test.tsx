import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ProfileAvatar } from './ProfileAvatar'

const text = (ui: React.ReactElement) => render(ui).container.textContent

describe('ProfileAvatar', () => {
  it('duas primeiras letras do nome; visitante só V', () => {
    expect(text(<ProfileAvatar profile={{ name: 'Charles Santos', type: 'admin' }} />)).toBe('CS')
    expect(text(<ProfileAvatar profile={{ name: 'Bia', type: 'regular' }} />)).toBe('B')
    expect(text(<ProfileAvatar profile={{ name: 'Visitante', type: 'guest' }} />)).toBe('V')
  })
  it('com foto mostra a imagem', () => {
    const { container } = render(<ProfileAvatar profile={{ name: 'Charles Santos', type: 'admin' }} photoUrl="https://example.com/a.png" />)
    expect(container.querySelector('img')?.getAttribute('src')).toBe('https://example.com/a.png')
  })
})
