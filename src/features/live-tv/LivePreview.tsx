/**
 * Camada 2 da tela Ao Vivo: o canal selecionado tocando ao fundo, com som, em tela cheia (atrás do menu e da grade).
 * Segue o canal em foco na grade (depois de uma pausa curta, para não abrir um vídeo a cada seta) ou o escolhido
 * com OK; ao abrir a tela, o primeiro canal da lista. "Assistir" leva o mesmo player à tela cheia (livePlayback).
 *
 * Adulto e fonte fora do ar: sem prévia.
 */
import { useEffect, useRef, useState } from 'react'
import { useBackend } from '../../app/providers/BackendProvider'
import { usePlatform } from '../../app/providers/PlatformProvider'
import { useReadySession } from '../../app/providers/SessionProvider'
import { diag } from '../../platform/diagnostics'
import { createPlaybackAdapter } from '../../platform/playback/createAdapter'
import type { CatalogItem } from '../../services/api/types'
import { isAdultItem } from '../../services/catalog/adult'
import { liveKey, livePlayback } from './livePlayback'

/** Pausa no foco antes de trocar o canal da prévia (cada troca pede o stream ao backend). */
export const PREVIEW_FOCUS_MS = 900

export function LivePreview({ fallback, chosenId, onActive }: { fallback: CatalogItem | null; chosenId: string | null; onActive: (active: boolean) => void }) {
  const platform = usePlatform()
  const { backend } = useBackend()
  const session = useReadySession()
  const container = useRef<HTMLDivElement>(null)
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const activeRef = useRef(onActive)
  useEffect(() => {
    activeRef.current = onActive
  }, [onActive])

  // Canal em foco na grade (cartões `card-<id>`), com uma pausa antes de trocar.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const onFocus = (event: FocusEvent) => {
      const el = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>('[data-nav-id^="card-"]') : null
      const id = el?.dataset.navId?.slice(5)
      if (!id) return
      clearTimeout(timer)
      timer = setTimeout(() => setFocusedId(id), PREVIEW_FOCUS_MS)
    }
    document.addEventListener('focusin', onFocus)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('focusin', onFocus)
    }
  }, [])

  const targetId = chosenId ?? focusedId ?? fallback?.id ?? null
  const target = targetId ? (targetId === fallback?.id ? fallback : session.catalog.findLoaded(targetId)) : null
  const allowed = !!target && target.kind === 'channel' && !isAdultItem(target) && !session.unavailable && platform.visible

  // Abre (ou reaproveita) o player e troca o canal; nunca com som.
  useEffect(() => {
    if (!allowed || !target) return
    let alive = true
    const key = liveKey(target.sourceId, target.id)
    ;(async () => {
      try {
        const same = livePlayback.claim(key)
        if (same) {
          same.attach(container.current)
          if (alive) setPlaying(true)
          return
        }
        const reuse = livePlayback.claimAny()
        const adapter = reuse?.adapter ?? createPlaybackAdapter(platform)
        const grant = await backend.resolveStream(session.profile.id, { sourceId: target.sourceId, itemId: target.id })
        if (!alive) return
        livePlayback.adopt(key, adapter)
        await adapter.load({ url: grant.url, live: true, autoplay: true }, container.current)
        if (alive) setPlaying(true)
        diag('live', `prévia ${target.title.slice(0, 24)}`)
      } catch (raw) {
        diag('live', `prévia falhou: ${String((raw as Error)?.message ?? raw).slice(0, 80)}`)
      }
    })()
    return () => {
      alive = false
    }
  }, [allowed, target?.sourceId, target?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Saiu da tela: o player fica um instante esperando a tela cheia reclamá-lo ("Assistir"); senão encerra.
  useEffect(() => () => livePlayback.release(), [])
  useEffect(() => {
    if (!platform.visible) setPlaying(false)
  }, [platform.visible])

  const active = playing && allowed
  useEffect(() => {
    activeRef.current(active)
  }, [active])

  return <div ref={container} className="iplex-live-preview" aria-hidden="true" />
}
