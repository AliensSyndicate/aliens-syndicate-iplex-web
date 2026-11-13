/**
 * Trailer em tela cheia nos detalhes, aberto pelo botão "Trailer" (não entra
 * mais sozinho). Enquanto carrega, um spinner cobre a tela; tocando, fica em
 * loop até qualquer tecla ou clique, que só fecha (não aciona nada da tela).
 * O TMDB só entrega vídeos do YouTube, então ele toca no player oficial
 * incorporado, comandado por mensagens (sem script de terceiros na página).
 * Som: sempre com o volume cheio e sem mudo (o YouTube lembra o último estado
 * entre aberturas; por isso a saída pausa em vez de silenciar).
 */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Spinner } from '../../components/feedback/LoadingState'
import { TRAILER } from '../../config/features'
import { diag } from '../../platform/diagnostics'
import { classNames } from '../../utils/classNames'
import { coverSize, readPlayerMessage, trailerUrl, YOUTUBE_ORIGIN } from './trailerPlayer'

type Phase = 'loading' | 'playing' | 'closing'

/** Interações que fecham o trailer (o movimento do mouse não: o clique que abriu viria seguido dele). */
const ACTIVITY = ['keydown', 'mousedown', 'touchstart', 'wheel'] as const

export function DetailsTrailer({ videoKey, onClose }: { videoKey: string; onClose: (failed: boolean) => void }) {
  const [phase, setPhase] = useState<Phase>('loading')
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)
  const frame = useRef<HTMLIFrameElement>(null)
  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  }, [onClose])

  // Qualquer interação fecha: carregando, na hora; tocando, com o fade de saída. A tecla não chega à tela.
  useEffect(() => {
    if (phase === 'closing') {
      frame.current?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func: 'pauseVideo', args: [], id: videoKey, channel: 'widget' }), YOUTUBE_ORIGIN)
      const timer = setTimeout(() => closeRef.current(false), TRAILER.fadeOutMs)
      return () => clearTimeout(timer)
    }
    const onActivity = (event: Event) => {
      if (event.type === 'keydown') {
        event.preventDefault()
        event.stopImmediatePropagation()
      }
      if (phase === 'loading') closeRef.current(false)
      else setPhase('closing')
    }
    ACTIVITY.forEach((type) => window.addEventListener(type, onActivity, true))
    return () => ACTIVITY.forEach((type) => window.removeEventListener(type, onActivity, true))
  }, [phase, videoKey])

  // O quadro acompanha a janela: nunca sobra faixa em volta do vídeo.
  useEffect(() => {
    const fit = () => setSize(coverSize(window.innerWidth, window.innerHeight))
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [])

  useEffect(() => {
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
        command('unMute')
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
        // Reforço: alguns players só aplicam o volume depois que o vídeo começa.
        command('setVolume', TRAILER.volume)
        setPhase((p) => (p === 'loading' ? 'playing' : p))
      }
      if (message.ended) {
        command('seekTo', 0, true)
        command('playVideo')
      }
      if (message.error) {
        diag('trailer', `error ${String(event.data).slice(0, 120)}`)
        closeRef.current(true)
      }
    }
    window.addEventListener('message', onMessage)
    const giveUp = setTimeout(() => {
      if (playing) return
      diag('trailer', 'gave-up')
      closeRef.current(true)
    }, TRAILER.giveUpMs)
    return () => {
      clearInterval(listen)
      clearTimeout(muted)
      clearTimeout(giveUp)
      window.removeEventListener('message', onMessage)
    }
  }, [videoKey])

  return createPortal(
    <div className={classNames('iplex-trailer', phase === 'loading' && 'is-loading', phase === 'playing' && 'is-playing')} aria-hidden="true">
      <iframe ref={frame} className="iplex-trailer__frame" style={size ?? undefined} src={trailerUrl(videoKey, window.location.origin)} title="Trailer" tabIndex={-1} allow="autoplay; encrypted-media" />
      {phase === 'loading' && (
        <div className="iplex-trailer__loading">
          <Spinner label="Carregando trailer" />
        </div>
      )}
    </div>,
    document.body,
  )
}
