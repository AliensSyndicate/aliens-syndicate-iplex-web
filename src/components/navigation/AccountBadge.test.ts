import { describe, expect, it } from 'vitest'
import { accountInitials } from './AccountBadge'

describe('accountInitials', () => {
  it('primeira letra dos dois primeiros nomes', () => {
    expect(accountInitials('Charles Santos')).toBe('CS')
    expect(accountInitials('ana maria da silva')).toBe('AM')
    expect(accountInitials('  Bia ')).toBe('B')
  })
  it('nome de uma letra ou vazio', () => {
    expect(accountInitials('x')).toBe('X')
    expect(accountInitials('')).toBe('?')
  })
})
