import { describe, expect, it } from 'vitest'
import { coverSize, readPlayerMessage, trailerUrl } from './trailerPlayer'

describe('player do trailer', () => {
  it('monta o endereço sem controles e com a origem da página', () => {
    const url = new URL(trailerUrl('abc_123-XY', 'https://iplex-2c8fc.web.app'))
    expect(url.origin).toBe('https://www.youtube-nocookie.com')
    expect(url.pathname).toBe('/embed/abc_123-XY')
    expect(url.searchParams.get('controls')).toBe('0')
    expect(url.searchParams.get('origin')).toBe('https://iplex-2c8fc.web.app')
  })

  it('cobre a área em qualquer proporção, mesmo com tarjas 2,39:1 no vídeo', () => {
    for (const [w, h] of [[1440, 864], [1440, 600], [800, 900], [375, 500]] as const) {
      const frame = coverSize(w, h)
      expect(frame.width).toBeGreaterThanOrEqual(w)
      // Altura da imagem real dentro do quadro 16:9 de um vídeo 2,39:1.
      expect((frame.width / 2.39)).toBeGreaterThanOrEqual(h)
      expect(frame.width / frame.height).toBeCloseTo(16 / 9, 1)
    }
  })

  it('lê pronto, tocando, fim e erro', () => {
    expect(readPlayerMessage(JSON.stringify({ event: 'onReady' })).ready).toBe(true)
    expect(readPlayerMessage(JSON.stringify({ event: 'onStateChange', info: 1 })).playing).toBe(true)
    expect(readPlayerMessage(JSON.stringify({ event: 'infoDelivery', info: { playerState: 1 } })).playing).toBe(true)
    expect(readPlayerMessage(JSON.stringify({ event: 'infoDelivery', info: { playerState: 0 } })).ended).toBe(true)
    expect(readPlayerMessage(JSON.stringify({ event: 'onError', info: 150 })).error).toBe(true)
  })

  it('ignora o que não veio do player', () => {
    expect(readPlayerMessage({ event: 'onReady' })).toEqual({})
    expect(readPlayerMessage('não é json')).toEqual({})
    expect(readPlayerMessage('null')).toEqual({})
  })
})
