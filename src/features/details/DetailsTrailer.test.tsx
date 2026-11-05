import { act, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TRAILER } from '../../config/features'
import { DetailsTrailer } from './DetailsTrailer'
import { YOUTUBE_ORIGIN } from './trailerPlayer'

const frame = () => document.querySelector<HTMLIFrameElement>('.iplex-trailer__frame')
const stage = () => document.querySelector('.iplex-trailer')
const fromPlayer = (data: unknown) =>
  act(() => void window.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(data), origin: YOUTUBE_ORIGIN, source: frame()!.contentWindow })))
const wait = (ms: number) => act(() => void vi.advanceTimersByTime(ms))

beforeEach(() => void vi.useFakeTimers())
afterEach(() => void vi.useRealTimers())

describe('trailer em tela cheia', () => {
  it('só entra depois do tempo sem interação', () => {
    render(<DetailsTrailer videoKey="abc123" />)
    wait(TRAILER.delayMs - 1000)
    fireEvent.keyDown(window, { key: 'ArrowDown' })
    wait(TRAILER.delayMs - 1000)
    expect(frame()).toBeNull()
    wait(1000)
    expect(frame()).not.toBeNull()
  })

  it('cobre a tela só tocando; a tecla fecha sem chegar à tela e a contagem recomeça', () => {
    const screenKeys = vi.fn()
    window.addEventListener('keydown', screenKeys)
    render(<DetailsTrailer videoKey="abc123" />)
    wait(TRAILER.delayMs)
    expect(stage()?.classList.contains('is-playing')).toBe(false)
    fromPlayer({ event: 'onStateChange', info: 1 })
    expect(stage()?.classList.contains('is-playing')).toBe(true)
    fireEvent.keyDown(window, { key: 'Enter' })
    // Fade de saída: continua montado, já sem a classe que o deixa visível.
    expect(stage()?.classList.contains('is-playing')).toBe(false)
    expect(frame()).not.toBeNull()
    expect(screenKeys).not.toHaveBeenCalled()
    wait(TRAILER.fadeOutMs)
    expect(frame()).toBeNull()
    wait(TRAILER.delayMs)
    expect(frame()).not.toBeNull()
    window.removeEventListener('keydown', screenKeys)
  })

  it('no fim do vídeo recomeça, sem fechar', () => {
    render(<DetailsTrailer videoKey="abc123" />)
    wait(TRAILER.delayMs)
    fromPlayer({ event: 'onStateChange', info: 1 })
    fromPlayer({ event: 'onStateChange', info: 0 })
    expect(stage()?.classList.contains('is-playing')).toBe(true)
  })

  it('vídeo que não pode tocar: desiste e não tenta de novo', () => {
    render(<DetailsTrailer videoKey="abc123" />)
    wait(TRAILER.delayMs)
    fromPlayer({ event: 'onError', info: 150 })
    expect(frame()).toBeNull()
    wait(TRAILER.delayMs * 2)
    expect(frame()).toBeNull()
  })
})
