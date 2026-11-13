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
type Command = { func?: string; args?: unknown[] }
const commands = (post: { mock: { calls: unknown[][] } }): Command[] =>
  post.mock.calls.map((call) => JSON.parse(String(call[0])) as Command).filter((m) => m.func)

beforeEach(() => void vi.useFakeTimers())
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('trailer em tela cheia (aberto pelo botão)', () => {
  it('carregando: tela escurecida com spinner; tocando: o vídeo cobre a tela', () => {
    render(<DetailsTrailer videoKey="abc123" onClose={() => undefined} />)
    expect(stage()?.classList.contains('is-loading')).toBe(true)
    expect(document.querySelector('[aria-label="Carregando trailer"]')).not.toBeNull()
    fromPlayer({ event: 'onStateChange', info: 1 })
    expect(stage()?.classList.contains('is-playing')).toBe(true)
    expect(document.querySelector('[aria-label="Carregando trailer"]')).toBeNull()
  })

  it('toca com som no volume máximo, reenviado quando o vídeo começa', () => {
    // O jsdom não carrega o iframe: a própria janela faz o papel do player (mensagens só registradas).
    vi.spyOn(HTMLIFrameElement.prototype, 'contentWindow', 'get').mockReturnValue(window)
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined)
    render(<DetailsTrailer videoKey="abc123" onClose={() => undefined} />)
    fromPlayer({ event: 'onReady' })
    fromPlayer({ event: 'onStateChange', info: 1 })
    const sent = commands(post)
    expect(sent.filter((m) => m.func === 'unMute')).toHaveLength(2)
    expect(sent.filter((m) => m.func === 'setVolume').every((m) => m.args?.[0] === TRAILER.volume)).toBe(true)
    expect(sent.some((m) => m.func === 'mute')).toBe(false)
    // Nunca cai para mudo sozinho, por mais que demore.
    wait(TRAILER.giveUpMs - 1)
    expect(commands(post).some((m) => m.func === 'mute')).toBe(false)
  })

  it('a tecla fecha sem chegar à tela', () => {
    const onClose = vi.fn()
    const screenKeys = vi.fn()
    window.addEventListener('keydown', screenKeys)
    render(<DetailsTrailer videoKey="abc123" onClose={onClose} />)
    wait(0)
    fromPlayer({ event: 'onStateChange', info: 1 })
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(stage()?.classList.contains('is-playing')).toBe(false)
    expect(screenKeys).not.toHaveBeenCalled()
    wait(TRAILER.fadeOutMs)
    expect(onClose).toHaveBeenCalledWith(false)
    window.removeEventListener('keydown', screenKeys)
  })

  it('no fim do vídeo fecha (não fica em loop)', () => {
    const onClose = vi.fn()
    render(<DetailsTrailer videoKey="abc123" onClose={onClose} />)
    fromPlayer({ event: 'onStateChange', info: 1 })
    fromPlayer({ event: 'onStateChange', info: 0 })
    wait(TRAILER.fadeOutMs)
    expect(onClose).toHaveBeenCalledWith(false)
  })

  it('vídeo que não pode tocar: fecha avisando a falha', () => {
    const onClose = vi.fn()
    render(<DetailsTrailer videoKey="abc123" onClose={onClose} />)
    fromPlayer({ event: 'onError', info: 150 })
    expect(onClose).toHaveBeenCalledWith(true)
  })

  it('sem começar a tocar no prazo: desiste avisando a falha', () => {
    const onClose = vi.fn()
    render(<DetailsTrailer videoKey="abc123" onClose={onClose} />)
    wait(TRAILER.giveUpMs)
    expect(onClose).toHaveBeenCalledWith(true)
  })
})
