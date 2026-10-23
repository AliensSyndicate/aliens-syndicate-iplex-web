import { useCallback, useEffect, useRef, useState } from 'react'
import type { OverlayMode } from '../../components/player/PlayerOverlay'

/**
 * Temporizador de inatividade do Overlay 1: cada interação válida reinicia a
 * contagem; ao fim, o overlay some (fade-out em CSS). Nunca toca no player.
 */
export function useOverlayTimer(hideMs: number) {
  const [mode, setMode] = useState<OverlayMode>('info')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clear = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }
  const arm = useCallback(() => {
    clear()
    timer.current = setTimeout(() => {
      timer.current = null
      setMode('hidden')
    }, hideMs)
  }, [hideMs])

  /** Mostra (sem rebaixar o modo interativo para informativo) e reinicia a contagem. */
  const reveal = useCallback(
    (next: Exclude<OverlayMode, 'hidden'>) => {
      setMode((m) => (next === 'info' && m === 'interactive' ? m : next))
      arm()
    },
    [arm],
  )

  /** Interação com o overlay aberto: reinicia os cinco segundos. */
  const touch = useCallback(() => {
    if (timer.current) arm()
  }, [arm])

  const hide = useCallback(() => {
    clear()
    setMode('hidden')
  }, [])

  useEffect(() => clear, [])
  return { mode, reveal, touch, hide }
}
