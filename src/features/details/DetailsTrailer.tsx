/**
 * Trailer em tela cheia nos detalhes, como um descanso de tela: depois de alguns
 * segundos sem interação ele cobre tudo e fica em loop; qualquer tecla ou
 * movimento fecha e a tela volta como estava (a tecla só fecha, não aciona nada).
 * O TMDB só entrega vídeos do YouTube, então ele toca no player oficial
 * incorporado, comandado por mensagens (sem script de terceiros na página). Só
 * aparece quando já está tocando; se o vídeo não puder tocar, a tela fica como está.
 */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { TRAILER } from '../../config/features'
import { diag } from '../../platform/diagnostics'
import { classNames } from '../../utils/classNames'
import { coverSize, readPlayerMessage, trailerUrl, YOUTUBE_ORIGIN } from './trailerPlayer'

type Phase = 'waiting' | 'loading' | 'playing' | 'closing' | 'done'

const ACTIVITY = ['keydown', 'mousemove', 'mousedown', 'touchstart', 'wheel'] as const

export function DetailsTrailer({ videoKey }: { videoKey: string }) {
  const [phase, setPhase] = useState<Phase>('waiting')
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)
  const frame = useRef<HTMLIFrameElement>(null)
  const started = phase === 'loading' || phase === 'playing' || phase === 'closing'

  // Sem interação, o trailer entra; com ela, a contagem recomeça e o que estiver aberto fecha.
  useEffect(() => {
    if (phase === 'done') return
    let timer: ReturnType<typeof setTimeout> | undefined
    // Saída: o som corta na hora e o vídeo dissolve de volta para a tela.
    if (phase === 'closing') {
      frame.current?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func: 'mute', args: [], id: videoKey, channel: 'widget' }), YOUTUBE_ORIGIN)
      timer = setTimeout(() => setPhase('waiting'), TRAILER.fadeOutMs)
      return () => clearTimeout(timer)
    }
    const arm = () => {
      clearTimeout(timer)
      timer = setTimeout(() => setPhase('loading'), TRAILER.delayMs)
    }
    if (phase === 'waiting') arm()
    const onActivity = (event: Event) => {
      if (phase === 'waiting') return arm()
      if (phase === 'loading') return setPhase('waiting')
      if (event.type === 'keydown') {
        event.preventDefault()
        event.stopImmediatePropagation()
      }
      setPhase('closing')
    }
    ACTIVITY.forEach((type) => window.addEventListener(type, onActivity, true))
    return () => {
      clearTimeout(timer)
      ACTIVITY.forEach((type) => window.removeEventListener(type, onActivity, true))
    }
  }, [phase, videoKey])

  // O quadro acompanha a janela: nunca sobra faixa em volta do vídeo.
  useEffect(() => {
    if (!started) return
    const fit = () => setSize(coverSize(window.innerWidth, window.innerHeight))
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [started])

  useEffect(() => {
    if (!started) return
    const post = (message: Record<string, unknown>) => frame.current?.contentWindow?.postMessage(JSON.stringify({ ...message, id: videoKey, channel: 'widget' }), YOUTUBE_ORIGIN)
    const command = (func: string, ...args: unknown[]) => post({ event: 'command', func, args })
    let ready = false
    let playing = false
    let muted: ReturnType<typeof setTimeout> | undefined
    const listen = setInterval(() => post({ event: 'listening' }), 500)
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== YOUTUBE_ORIGIN || event.source !== frame.current?.contentWindow) return
      const message = readPlayerMessage(event.data)
      if (message.ready && !ready) {
        ready = true
        clearInterval(listen)
        command('setVolume', TRAILER.volume)
        command('playVideo')
        // Conta do player pronto: a TV demora a carregar, e isso não é autoplay bloqueado.
        muted = setTimeout(() => {
          if (playing) return
          diag('trailer', 'muted-fallback')
          command('mute')
          command('playVideo')
        }, TRAILER.mutedFallbackMs)
      }
      if (message.playing && !playing) {
        playing = true
        diag('trailer', 'playing')
        setPhase('playing')
      }
      if (message.ended) {
        command('seekTo', 0, true)
        command('playVideo')
      }
      if (message.error) {
        diag('trailer', `error ${String(event.data).slice(0, 120)}`)
        setPhase('done')
      }
    }
    window.addEventListener('message', onMessage)
    const giveUp = setTimeout(() => {
      if (playing) return
      diag('trailer', 'gave-up')
      setPhase('done')
    }, TRAILER.giveUpMs)
    return () => {
      clearInterval(listen)
      clearTimeout(muted)
      clearTimeout(giveUp)
      window.removeEventListener('message', onMessage)
    }
  }, [started, videoKey])

  if (!started) return null
  return createPortal(
    <div className={classNames('iplex-trailer', phase === 'playing' && 'is-playing')} aria-hidden="true">
      <iframe ref={frame} className="iplex-trailer__frame" style={size ?? undefined} src={trailerUrl(videoKey, window.location.origin)} title="Trailer" tabIndex={-1} allow="autoplay; encrypted-media" />
    </div>,
    document.body,
  )
}
