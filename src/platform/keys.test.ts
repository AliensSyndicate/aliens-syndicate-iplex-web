import { describe, expect, it } from 'vitest'
import { buildKeyLookup, EXIT_KEY_CODE, normalizeKey } from './keys'

describe('keys', () => {
  it('usa os códigos reais informados pelo shell', () => {
    const lookup = buildKeyLookup({ MediaPlayPause: 10252, Back: 10009 })
    expect(normalizeKey({ key: '', keyCode: 10252 }, lookup)).toBe('MediaPlayPause')
    expect(normalizeKey({ key: '', keyCode: 10009 }, lookup)).toBe('Back')
  })
  it('navegador: event.key padrão', () => {
    const lookup = buildKeyLookup()
    expect(normalizeKey({ key: 'ArrowDown', keyCode: 40 }, lookup)).toBe('ArrowDown')
    expect(normalizeKey({ key: 'Escape', keyCode: 27 }, lookup)).toBe('Back')
  })
  it('nunca trata o Exit da Samsung', () => {
    const lookup = buildKeyLookup({ Back: EXIT_KEY_CODE })
    expect(normalizeKey({ key: '', keyCode: EXIT_KEY_CODE }, lookup)).toBeNull()
  })
  it('não presume teclas de mídia ausentes', () => {
    expect(normalizeKey({ key: '', keyCode: 415 }, buildKeyLookup())).toBeNull()
  })
})
