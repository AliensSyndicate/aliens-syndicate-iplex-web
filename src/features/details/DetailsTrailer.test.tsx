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
const commands = (spy: ReturnType<typeof vi.fn>) => spy.mock.calls.map(([m]) => (JSON.parse(String(m)) as { func?: string }).func).filter(Boolean)

beforeEach(() => void vi.useFakeTimers())
afterEach(() => void vi.useRealTimers())

describe('trailer em tela cheia (botão)', () => {
  it('abre na hora com spinner e cobre a tela com o vídeo só quando toca', () => {
    render(<DetailsTrailer videoKey="abc123" onClose={vi.fn()} />)
    expect(frame()).not.toBeNull()
    expect(stage()?.classList.contains('is-loading')).toBe(true)
    expect(document.querySelector('.iplex-trailer__loading [role="status"]')).not.toBeNull()
    fromPlayer({ event: 'onStateChange', info: 1 })
    expect(stage()?.classList.contains('is-playing')).toBe(true)
    expect(document.querySelector('.iplex-trailer__loading')).toBeNull()
  })

  it('pronto: tira o mudo e manda o volume cheio antes de tocar', () => {
    render(<DetailsTrailer videoKey="abc123" onClose={vi.fn()} />)
    // jsdom não carrega o iframe: uma janela falsa recebe os comandos e é a origem das mensagens.
    const fake = { postMessage: vi.fn() }
    Object.defineProperty(frame()!, 'contentWindow', { value: fake })
    const ready = new MessageEvent('message', { data: JSON.stringify({ event: 'onReady' }), origin: YOUTUBE_ORIGIN })
    Object.defineProperty(ready, 'source', { value: fake })
    act(() => void window.dispatchEvent(ready))
    const spy = fake.postMessage
    expect(commands(spy).slice(0, 3)).toEqual(['unMute', 'setVolume', 'playVideo'])
    expect(spy.mock.calls.some(([m]) => String(m).includes(`"args":[${TRAILER.volume}]`))).toBe(true)
  })

  it('tocando, a tecla fecha com fade sem chegar à tela', () => {
    const screenKeys = vi.fn()
    const onClose = vi.fn()
    window.addEventListener('keydown', screenKeys)
    render(<DetailsTrailer videoKey="abc123" onClose={onClose} />)
    fromPlayer({ event: 'onStateChange', info: 1 })
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(stage()?.classList.contains('is-playing')).toBe(false)
    expect(screenKeys).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    wait(TRAILER.fadeOutMs)
    expect(onClose).toHaveBeenCalledWith(false)
    window.removeEventListener('keydown', screenKeys)
  })

  it('carregando, a tecla cancela na hora', () => {
    const onClose = vi.fn()
    render(<DetailsTrailer videoKey="abc123" onClose={onClose} />)
    fireEvent.keyDown(window, { key: 'Backspace' })
    expect(onClose).toHaveBeenCalledWith(false)
  })

  it('no fim do vídeo recomeça, sem fechar', () => {
    const onClose = vi.fn()
    render(<DetailsTrailer videoKey="abc123" onClose={onClose} />)
    fromPlayer({ event: 'onStateChange', info: 1 })
    fromPlayer({ event: 'onStateChange', info: 0 })
    expect(stage()?.classList.contains('is-playing')).toBe(true)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('vídeo que não pode tocar: fecha avisando a falha', () => {
    const onClose = vi.fn()
    render(<DetailsTrailer videoKey="abc123" onClose={onClose} />)
    fromPlayer({ event: 'onError', info: 150 })
    expect(onClose).toHaveBeenCalledWith(true)
  })
})
