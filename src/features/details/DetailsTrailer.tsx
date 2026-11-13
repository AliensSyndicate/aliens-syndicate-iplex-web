/**
 * Trailer em tela cheia nos detalhes, aberto pelo botão "Assistir trailer" (não entra sozinho).
 * Enquanto carrega, a tela escurece com um spinner; tocando, o vídeo cobre tudo. Qualquer tecla
 * ou movimento fecha (a tecla só fecha, não aciona nada) e o fim do vídeo também fecha.
 * O TMDB só entrega vídeos do YouTube, então ele toca no player oficial incorporado, comandado
 * por mensagens (sem script de terceiros na página).
 *
 * Áudio: aberto por um clique, o trailer toca com som desde o início (sem o recurso de começar
 * mudo). O YouTube lembra mudo/volume da última sessão, então volume máximo e "unMute" são
 * enviados quando o player fica pronto e de novo quando o vídeo começa a tocar.
 */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Spinner } from '../../components/feedback/LoadingState'
import { TRAILER } from '../../config/features'
import { diag } from '../../platform/diagnostics'
import { classNames } from '../../utils/classNames'
import { coverSize, readPlayerMessage, trailerUrl, YOUTUBE_ORIGIN } from './trailerPlayer'

type Phase = 'loading' | 'playing' | 'closing'

const ACTIVITY = ['keydown', 'mousemove', 'mousedown', 'touchstart', 'wheel'] as const

/** `failed`: o vídeo não pôde tocar (a tela mostra o aviso). */
export function DetailsTrailer({ videoKey, onClose }: { videoKey: string; onClose: (failed: boolean) => void }) {
  const [phase, setPhase] = useState<Phase>('loading')
  const [size, setSize] = useState(() => coverSize(window.innerWidth, window.innerHeight))
  const frame = useRef<HTMLIFrameElement>(null)
  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  }, [onClose])

  // O próprio clique/OK que abriu o trailer não pode fechá-lo: a escuta só vale a partir do quadro seguinte.
  const armed = useRef(false)
  useEffect(() => {
    const id = setTimeout(() => {
      armed.current = true
    }, 0)
    return () => clearTimeout(id)
  }, [])

  // Interação fecha: o som corta na hora e o vídeo dissolve de volta para a tela.
  useEffect(() => {
    if (phase === 'closing') {
      frame.current?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func: 'mute', args: [], id: videoKey, channel: 'widget' }), YOUTUBE_ORIGIN)
      const timer = setTimeout(() => closeRef.current(false), TRAILER.fadeOutMs)
      return () => clearTimeout(timer)
    }
    const onActivity = (event: Event) => {
      if (event.type === 'keydown') {
        event.preventDefault()
        event.stopImmediatePropagation()
      }
      if (armed.current) setPhase('closing')
    }
    ACTIVITY.forEach((type) => window.addEventListener(type, onActivity, true))
    return () => ACTIVITY.forEach((type) => window.removeEventListener(type, onActivity, true))
  }, [phase, videoKey])


  // O quadro acompanha a janela: nunca sobra faixa em volta do vídeo.
  useEffect(() => {
    const fit = () => setSize(coverSize(window.innerWidth, window.innerHeight))
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [])

  useEffect(() => {
    const post = (message: Record<string, unknown>) => frame.current?.contentWindow?.postMessage(JSON.stringify({ ...message, id: videoKey, channel: 'widget' }), YOUTUBE_ORIGIN)
    const command = (func: string, ...args: unknown[]) => post({ event: 'command', func, args })
    const fullVolume = () => {
      command('unMute')
      command('setVolume', TRAILER.volume)
    }
    let ready = false
    let playing = false
    const listen = setInterval(() => post({ event: 'listening' }), 500)
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== YOUTUBE_ORIGIN || event.source !== frame.current?.contentWindow) return
      const message = readPlayerMessage(event.data)
      if (message.ready && !ready) {
        ready = true
        clearInterval(listen)
        fullVolume()
        command('playVideo')
      }
      if (message.playing && !playing) {
        playing = true
        fullVolume()
        diag('trailer', 'playing')
        setPhase((p) => (p === 'loading' ? 'playing' : p))
      }
      if (message.ended && playing) setPhase('closing')
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
      clearTimeout(giveUp)
      window.removeEventListener('message', onMessage)
    }
  }, [videoKey])

  return createPortal(
    <div className={classNames('iplex-trailer', phase === 'loading' && 'is-loading', phase === 'playing' && 'is-playing')} aria-hidden="true">
      {phase === 'loading' && (
        <div className="iplex-trailer__loading">
          <Spinner label="Carregando trailer" />
        </div>
      )}
      <iframe ref={frame} className="iplex-trailer__frame" style={size} src={trailerUrl(videoKey, window.location.origin)} title="Trailer" tabIndex={-1} allow="autoplay; encrypted-media" />
    </div>,
    document.body,
  )
}
