import { describe, expect, it } from 'vitest'
import { pickTrailer } from './service'

const video = (over: Record<string, unknown>) => ({ site: 'YouTube', type: 'Trailer', official: true, iso_639_1: 'en', key: 'aaaaaaaaaaa', ...over })

describe('pickTrailer', () => {
  it('prefere trailer oficial em português', () => {
    const list = [video({ type: 'Teaser', key: 'teaser00000' }), video({ key: 'english0000' }), video({ iso_639_1: 'pt', key: 'portugues00' })]
    expect(pickTrailer(list)).toBe('portugues00')
  })

  it('usa teaser quando não há trailer', () => {
    expect(pickTrailer([video({ type: 'Clip', key: 'clip0000000' }), video({ type: 'Teaser', key: 'teaser00000' })])).toBe('teaser00000')
  })

  it('ignora outros sites e chaves inválidas', () => {
    expect(pickTrailer([video({ site: 'Vimeo' }), video({ key: 'a/b' })])).toBeNull()
    expect(pickTrailer(undefined)).toBeNull()
  })
})
