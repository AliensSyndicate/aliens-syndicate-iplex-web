/**
 * Reprodução em tela cheia (o menu principal some).
 *
 * 1. O item é relido do catálogo autorizado (perfil do lease).
 * 2. O backend resolve a URL autorizada (resolveSourceStream), revalidando
 *    assinatura, lease, permissões e a fonte. Credenciais IPTV não chegam aqui.
 *    A mídia só é resolvida/carregada aqui: a tela de detalhes nunca pré-carrega.
 * 3. Um único adaptador toca: AVPlay (shell Samsung) ou <video> + hls.js (navegador).
 * 4. Progresso: só perfis com biblioteca, só VOD, com frequência controlada
 *    (progressSession/progressTracker; o backend impõe as mesmas regras).
 * 5. Overlay 1 (PlayerOverlay): aparece ao iniciar e some após 5 s sem interação;
 *    OK abre o modo interativo. Setas só agem com o overlay interativo aberto.
 * 6. Séries: "Próximo episódio" nos últimos 30 s, contados pelo tempo real da mídia.
 * 7. Saída: Voltar → detalhes do conteúdo; término natural → tela de origem.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useBackend } from '../../app/providers/BackendProvider'
import { usePlatform } from '../../app/providers/PlatformProvider'
import { useReadySession, useSession } from '../../app/providers/SessionProvider'
import { PATHS } from '../../app/routes/paths'
import { Dialog } from '../../components/dialogs/Dialog'
import { ErrorState } from '../../components/feedback/ErrorState'
import { Spinner } from '../../components/feedback/LoadingState'
import { NextEpisodeCard } from '../../components/player/NextEpisodeCard'
import { PlayerOverlay } from '../../components/player/PlayerOverlay'
import { PLAYER, TIMING } from '../../config/features'
import { useMatch } from '../../hooks/useMetadata'
import { useBackHandler, useKeyHandler } from '../../navigation/FocusProvider'
import { focusElement } from '../../navigation/spatial'
import { createPlaybackAdapter } from '../../platform/playback/createAdapter'
import type { PlaybackAdapter, PlaybackTrack } from '../../platform/playback/types'
import { AppError, toAppError } from '../../services/api/errors'
import type { CatalogItem, ContentKind, SeriesDetails, SeriesEpisode } from '../../services/api/types'
import { episodeContentId } from '../../services/catalog/normalize'
import { indexFromItem } from '../../services/library/libraryStore'
import { hasPersonalLibrary } from '../profiles/profileRules'
import { createProgressTracker } from './progressTracker'
import { createStatusReporter, type PlaybackStatusPayload } from './playbackStatus'
import { createProgressSession, resolveResumeMs, type ProgressSession } from './progressSession'
import { SEEK_CONFIRM_TIMEOUT_MS, clampSeek, createSeekGate, endedEarly, episodeCode, findNextEpisode, nextEpisodeCountdown, qualityLabel, scrubStepMs, subtitledFromSource } from './playerRules'
import { useOverlayTimer } from './useOverlayTimer'
import { playRequestErrorCode, reportPlayRequest, setPlaybackActive } from '../remote/playRequestReport'

type Phase = { status: 'preparing' } | { status: 'playing' } | { status: 'error'; error: AppError }

/** Estado de navegação levado pela tela de detalhes (Voltar retorna a ela pelo histórico). */
export interface PlayerNavState {
  from?: 'details'
}

export default function PlayerScreen() {
  const location = useLocation()
  const navigate = useNavigate()
  const platform = usePlatform()
  const { backend, tmdb } = useBackend()
  const session = useReadySession()
  const sessionApi = useSession()
  const q = new URLSearchParams(location.search)
  const sourceId = q.get('s') ?? ''
  const itemId = q.get('i') ?? ''
  const kind = (q.get('k') ?? 'movie') as ContentKind
  const title = q.get('t') ?? ''
  const episodeId = q.get('e')
  const wantsResume = q.get('r') === '1'
  /** Posição de retomada (s) entregue pelo backend junto do pedido do Control. */
  const resumeAtParam = Number(q.get('ra'))
  const resumeAtSec = Number.isFinite(resumeAtParam) && resumeAtParam > 0 ? resumeAtParam : null
  /** Pedido do iPlex Control que abriu esta reprodução (o resultado volta ao celular). */
  const playRequestId = q.get('pr')
  const live = kind === 'channel'
  const personal = hasPersonalLibrary(session.profile)
  const navState = (location.state ?? null) as PlayerNavState | null
  const fromDetails = navState?.from === 'details'

  const rootRef = useRef<HTMLElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const adapterRef = useRef<PlaybackAdapter | null>(null)
  const [phase, setPhase] = useState<Phase>({ status: 'preparing' })
  const [attempt, setAttempt] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [buffering, setBuffering] = useState(true)
  /** Tempo real do player, marcado com o conteúdo que o produziu (eventos de outra mídia nunca contam). */
  const [time, setTime] = useState({ positionMs: 0, durationMs: 0, key: '' })
  const [tracks, setTracks] = useState<PlaybackTrack[]>([])
  const [canSeek, setCanSeek] = useState(false)
  const [trackMenu, setTrackMenu] = useState<'audio' | 'text' | null>(null)
  const [cue, setCue] = useState<string | null>(null)
  const [item, setItem] = useState<CatalogItem | null>(null)
  const [series, setSeries] = useState<SeriesDetails | null>(null)
  const [episode, setEpisode] = useState<SeriesEpisode | null>(null)
  const [episodeMeta, setEpisodeMeta] = useState<{ id: string; name: string } | null>(null)
  const [videoSize, setVideoSize] = useState<{ width: number; height: number } | null>(null)
  const [previewMs, setPreviewMs] = useState<number | null>(null)
  const [pendingMs, setPendingMs] = useState<number | null>(null)
  const overlay = useOverlayTimer(TIMING.playerControlsHideMs)
  const timeRef = useRef(time)
  useEffect(() => {
    timeRef.current = time
  }, [time])
  const progressSession = useRef<ProgressSession | null>(null)
  const statusRef = useRef<((payload: PlaybackStatusPayload) => void) | null>(null)
  const saveInFlight = useRef<Promise<void> | null>(null)
  const saveQueued = useRef(false)
  /** Conteúdo concluído (fim natural ou troca de episódio): nenhuma gravação depois disso. */
  const finished = useRef(false)
  const tracker = useMemo(() => createProgressTracker({ intervalMs: TIMING.progressSaveIntervalMs, minDeltaMs: TIMING.progressMinDeltaMs }), [])
  const seekGate = useMemo(() => createSeekGate(), [])
  const overlayRef = useRef(overlay)
  useEffect(() => {
    overlayRef.current = overlay
  }, [overlay])
  /** Fim da mídia (definido abaixo, depende do próximo episódio). */
  const endedRef = useRef<() => void>(() => undefined)
  const contentId = kind === 'series' && episodeId ? episodeContentId(itemId, episodeId) : itemId
  const contentKey = `${sourceId}|${itemId}|${episodeId ?? ''}|${attempt}`

  const progressMeta = useCallback(() => {
    if (!item) return null
    const label = episode ? `T${episode.season} E${episode.episodeNum ?? '?'}${episode.title ? ` · ${episode.title}` : ''}` : ''
    return indexFromItem(item, episode ? { id: episode.id, label, contentId } : undefined)
  }, [item, episode, contentId])

  const saveRef = useRef<(force: boolean) => void>(() => undefined)
  const saveProgress = useCallback(
    (force: boolean) => {
      const sessionState = progressSession.current
      const meta = progressMeta()
      if (!personal || live || !meta || !sessionState || finished.current) return
      const { positionMs, durationMs } = timeRef.current
      // Inicialização, retomada ainda não confirmada e stream sem seek nunca gravam (apagariam o progresso).
      if (!sessionState.canSave(positionMs, durationMs)) return
      if (!tracker.shouldSave(positionMs, durationMs, force)) return
      // Uma gravação por vez: a posição mais recente segue na próxima (pausa/saída forçam).
      if (saveInFlight.current) {
        if (force) saveQueued.current = true
        return
      }
      tracker.markSaved(positionMs)
      saveInFlight.current = session.library
        .saveProgress(contentId, positionMs / 1000, durationMs / 1000, meta, sessionState.next())
        .catch(() => tracker.markFailed())
        .finally(() => {
          saveInFlight.current = null
          if (saveQueued.current) {
            saveQueued.current = false
            saveRef.current(true)
          }
        })
    },
    [personal, live, progressMeta, contentId, session.library, tracker],
  )
  useEffect(() => {
    saveRef.current = saveProgress
  }, [saveProgress])

  /**
   * Conclusão: grava posição = duração na MESMA sessão (seq maior que qualquer
   * gravação anterior). O backend marca "Assistidos" a partir de 90% (regra dele,
   * não duplicada aqui) e a retomada deixa de ser oferecida (≥ 95%).
   */
  const completeProgress = useCallback(() => {
    if (finished.current) return
    finished.current = true
    saveQueued.current = false
    const sessionState = progressSession.current
    const meta = progressMeta()
    const { durationMs } = timeRef.current
    if (!personal || live || !meta || !sessionState || !(durationMs > 0)) return
    const durationSec = durationMs / 1000
    const before = saveInFlight.current ?? Promise.resolve()
    void before
      .catch(() => undefined)
      .then(() => session.library.saveProgress(contentId, durationSec, durationSec, meta, sessionState.next()))
      .catch(() => undefined)
  }, [personal, live, progressMeta, contentId, session.library])

  /** Voltar → detalhes; término natural → origem (detalhes, Meu iPlex, tela anterior ao pedido do Control). */
  const exit = useCallback(
    (target: 'details' | 'origin') => {
      if (live || fromDetails) {
        navigate(-1)
        return
      }
      const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0
      if (target === 'origin' && idx > 0) navigate(-1)
      else navigate(PATHS.details(sourceId, itemId, item?.title ?? title), { replace: true })
    },
    [live, fromDetails, navigate, sourceId, itemId, item, title],
  )

  // Prepara e inicia a reprodução.
  useEffect(() => {
    let alive = true
    let adapter: PlaybackAdapter | null = null
    let firstPlay = true
    const offs: Array<() => void> = []
    const root = document.documentElement
    setPhase({ status: 'preparing' })
    setBuffering(true)
    setTime({ positionMs: 0, durationMs: 0, key: contentKey })
    timeRef.current = { positionMs: 0, durationMs: 0, key: contentKey }
    setVideoSize(null)
    setPreviewMs(null)
    setPendingMs(null)
    seekGate.cancel()
    progressSession.current = null
    finished.current = false
    // Status para o Control ("Reproduzindo"): só informa, nunca recebe comando.
    const reporter = createStatusReporter((payload) =>
      backend.reportPlayback({ sessionId: session.lease.id, sourceId, itemId, ...(episodeId ? { episodeId } : {}), ...payload }),
    )
    statusRef.current = (payload) => reporter.report(payload)
    saveInFlight.current = null
    saveQueued.current = false
    ;(async () => {
      try {
        const found = await session.catalog.findItem(sourceId, itemId, title)
        if (!alive) return
        if (!found || found.kind !== kind) throw new AppError('content-unavailable')
        setItem(found)
        if (found.kind === 'series' && episodeId) {
          const details = await backend.readSeries(session.profile.id, found.sourceId, found.providerRef).catch(() => null)
          const ep = details?.seasons.flatMap((s) => s.episodes).find((e) => e.id === episodeId) ?? null
          if (!alive) return
          setSeries(details)
          setEpisode(ep)
        }
        const grant = await backend.resolveStream(session.profile.id, { sourceId: found.sourceId, itemId: found.id, ...(episodeId ? { episodeId } : {}) })
        if (!alive) return
        adapter = createPlaybackAdapter(platform)
        adapterRef.current = adapter
        setCanSeek(!!adapter.capabilities.seek && !!adapter.seek && !live)
        if (adapter.kind === 'native-bridge') root.classList.add('is-native-playback')
        offs.push(
          adapter.on('state', ({ state }) => {
            progressSession.current?.onState(state === 'playing' ? 'playing' : state === 'paused' ? 'paused' : 'other')
            if (state === 'playing' || state === 'paused') {
              const { positionMs, durationMs } = timeRef.current
              statusRef.current?.({ state, ...(!live && durationMs > 0 ? { positionSec: positionMs / 1000, durationSec: durationMs / 1000 } : {}) })
            }
            setPlaying(state === 'playing')
            if (state === 'playing') {
              reportPlayRequest(backend, playRequestId, 'started')
              // Overlay 1 aparece ao iniciar cada conteúdo e some sozinho após 5 s.
              if (firstPlay) {
                firstPlay = false
                overlayRef.current.reveal('info')
              }
            }
            if (state === 'playing' || state === 'paused') setBuffering(false)
            if (state === 'paused') saveRef.current(true)
          }),
          adapter.on('time', (raw) => {
            const t = { positionMs: raw.positionMs, durationMs: raw.durationMs, key: contentKey }
            setTime(t)
            timeRef.current = t
            if (adapterRef.current && !live && t.durationMs > 0) statusRef.current?.({ state: 'playing', positionSec: t.positionMs / 1000, durationSec: t.durationMs / 1000 })
            else if (live) statusRef.current?.({ state: 'playing' })
            // Retomada: confirma que o player chegou ao ponto salvo e reaplica o seek se ainda não.
            const again = progressSession.current?.onTime(t.positionMs)
            if (again && adapter) void Promise.resolve(adapter.seek?.(again.seek)).catch(() => undefined)
            // Seek do usuário: a posição só é aplicada na interface quando o player confirma.
            const confirmed = seekGate.onTime(t.positionMs)
            setPendingMs(seekGate.pending)
            saveRef.current(confirmed)
          }),
          adapter.on('buffering', ({ active }) => setBuffering(active)),
          adapter.on('media', (size) => setVideoSize(size)),
          adapter.on('error', (info) => {
            setPhase({ status: 'error', error: new AppError(info.unsupported ? 'format-unsupported' : 'playback-error', info.code) })
          }),
          adapter.on('ended', () => {
            setPlaying(false)
            endedRef.current()
          }),
          adapter.on('subtitle', ({ text, durationMs }) => {
            setCue(text)
            setTimeout(() => setCue((c) => (c === text ? null : c)), durationMs || 3000)
          }),
        )
        // Posição de retomada: a do backend (pedido do Control) ou, na TV, a da biblioteca já carregada.
        let resumeMs: number | null = null
        if (wantsResume && personal && !live) {
          if (resumeAtSec === null) await session.library.whenLoaded(4000)
          if (!alive) return
          resumeMs = resolveResumeMs(resumeAtSec, resumeAtSec === null ? session.library.progressFor(contentId) : null)
        }
        const playId = `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
        progressSession.current = createProgressSession({
          playId,
          startedAt: Date.now(),
          // Sem posição a restaurar, o início é intencional (reinício ou título sem progresso).
          origin: resumeMs !== null ? 'resume' : wantsResume && resumeAtSec === null && !session.library.loaded ? 'resume' : 'restart',
          ...(resumeMs !== null ? { targetMs: resumeMs } : {}),
        })
        await adapter.load(
          { url: grant.url, live, autoplay: true, ...(resumeMs !== null ? { startPositionMs: resumeMs } : {}) },
          containerRef.current,
        )
        if (!alive) return
        setPhase((p) => (p.status === 'error' ? p : { status: 'playing' }))
        adapter.getTracks().then((t) => alive && setTracks(t), () => undefined)
      } catch (raw) {
        if (alive) setPhase({ status: 'error', error: toAppError(raw) })
      }
    })()
    return () => {
      alive = false
      saveRef.current(true)
      statusRef.current?.({ state: 'stopped' })
      statusRef.current = null
      offs.forEach((off) => off())
      root.classList.remove('is-native-playback')
      if (adapter) void adapter.destroy()
      adapterRef.current = null
    }
    // A reprodução reinicia ao mudar o conteúdo ou ao tentar novamente.
  }, [sourceId, itemId, episodeId, kind, attempt]) // eslint-disable-line react-hooks/exhaustive-deps

  // Nome do episódio (TMDB, só metadados); sem correspondência, o nome da fonte.
  const match = useMatch(kind === 'series' ? item : null)
  const tmdbId = match.status === 'ready' ? match.summary.tmdbId : null
  useEffect(() => {
    if (!item || !episode || !tmdbId) return
    let alive = true
    tmdb.season(tmdbId, episode.season, item).then(
      (s) => alive && setEpisodeMeta({ id: episode.id, name: s.episodes.find((e) => e.episodeNumber === episode.episodeNum)?.name ?? '' }),
      () => undefined,
    )
    return () => {
      alive = false
    }
  }, [tmdb, tmdbId, item, episode])

  // Só há "reprodução em andamento" com mídia carregada (nunca em erro ou preparando).
  useEffect(() => {
    setPlaybackActive(phase.status === 'playing')
    return () => setPlaybackActive(false)
  }, [phase.status])

  // Pedido do celular que não chegou a tocar: o Control recebe o motivo.
  useEffect(() => {
    if (phase.status === 'error') reportPlayRequest(backend, playRequestId, 'failed', playRequestErrorCode(phase.error))
  }, [phase, backend, playRequestId])

  // App ocultado: o shell para o player. Ao voltar, o Web reabre a mídia.
  const wasHidden = useRef(false)
  useEffect(() => {
    if (!platform.visible) {
      wasHidden.current = true
      saveRef.current(true)
    } else if (wasHidden.current) {
      wasHidden.current = false
      setAttempt((a) => a + 1)
    }
  }, [platform.visible])

  const seekable = canSeek && !live && time.durationMs > 0 && time.key === contentKey && phase.status === 'playing'

  // ---- Próximo episódio (somente séries; disponibilidade = lista da fonte IPTV) ----
  const nextEpisode = useMemo(() => (kind === 'series' ? findNextEpisode(series, episodeId) : null), [kind, series, episodeId])
  const countdown = nextEpisode && phase.status === 'playing' && time.key === contentKey ? nextEpisodeCountdown(time.positionMs, time.durationMs) : null
  const nextVisible = countdown !== null

  const playNext = useCallback(() => {
    if (!nextEpisode || finished.current) return
    completeProgress()
    // Do zero (sem retomada); substitui a entrada do player, então Voltar continua indo aos detalhes.
    navigate(PATHS.watch({ sourceId, itemId, kind: 'series', title, episodeId: nextEpisode.id }), { replace: true, state: navState })
  }, [nextEpisode, completeProgress, navigate, sourceId, itemId, title, navState])

  // Contagem chegou a zero (a mídia chegou ao fim real).
  useEffect(() => {
    if (countdown === 0) playNext()
  }, [countdown, playNext])

  useEffect(() => {
    endedRef.current = () => {
      if (live || finished.current) return
      const { positionMs, durationMs } = timeRef.current
      // Fim muito antes da duração: conexão/stream interrompidos, não conclusão.
      if (endedEarly(positionMs, durationMs)) {
        saveRef.current(true)
        setPhase({ status: 'error', error: new AppError('playback-error', 'ended-early') })
        return
      }
      if (nextEpisode) {
        playNext()
        return
      }
      completeProgress()
      exit('origin')
    }
  }, [live, nextEpisode, playNext, completeProgress, exit])

  // ---- Seek (botões ±10 s e barra): sempre confirmado pelo player ----
  const requestSeek = (targetMs: number) => {
    const a = adapterRef.current
    if (!a?.seek || !seekable) return
    const target = clampSeek(targetMs, time.durationMs)
    if (target === null) return
    progressSession.current?.onUserSeek()
    seekGate.request(target)
    setPendingMs(target)
    void Promise.resolve(a.seek(target)).catch(() => {
      seekGate.cancel()
      setPendingMs(null)
    })
  }
  // Sem confirmação no prazo (stream sem seek preciso), o marcador some e fica só a posição real.
  useEffect(() => {
    if (pendingMs === null) return
    const id = setTimeout(() => setPendingMs(seekGate.pending), SEEK_CONFIRM_TIMEOUT_MS + 100)
    return () => clearTimeout(id)
  }, [pendingMs, seekGate])
  const skip = (deltaMs: number) => requestSeek((seekGate.pending ?? time.positionMs) + deltaMs)
  const scrub = (direction: 1 | -1) => {
    if (!seekable) return
    const base = previewMs ?? seekGate.pending ?? time.positionMs
    setPreviewMs(clampSeek(base + direction * scrubStepMs(time.durationMs), time.durationMs))
  }
  const commitScrub = () => {
    if (previewMs === null) return
    requestSeek(previewMs)
    setPreviewMs(null)
  }

  const toggle = () => {
    const a = adapterRef.current
    if (!a) return
    void (playing ? a.pause() : a.play())
  }

  const zapChannel = (direction: 1 | -1) => {
    if (!live) return
    const channels = session.catalog.items('channel')
    const index = channels.findIndex((c) => c.id === itemId)
    const next = channels[(index + direction + channels.length) % channels.length]
    if (next && next.id !== itemId) navigate(PATHS.watch({ sourceId: next.sourceId, itemId: next.id, kind: 'channel', title: next.title }), { replace: true })
  }

  // ---- Foco: controles ao abrir o modo interativo; cartão do próximo episódio fora dele ----
  const { mode } = overlay
  useEffect(() => {
    const active = document.activeElement
    const inOverlay = active instanceof HTMLElement && !!active.closest('.iplex-player__overlay')
    if (mode === 'interactive') {
      if (!inOverlay) {
        const target = document.querySelector<HTMLElement>('[data-nav-id="pc-toggle"]')
        if (target) focusElement(target)
      }
    } else if (inOverlay) {
      // Controles ocultos nunca guardam o foco: OK não pode acionar um botão invisível
      // (o blur da barra também descarta uma prévia de posição não confirmada).
      rootRef.current?.focus()
    }
  }, [mode, phase.status])
  useEffect(() => {
    if (!nextVisible || mode === 'interactive') return
    const target = document.querySelector<HTMLElement>('[data-nav-id="pc-next"]')
    if (target && document.activeElement !== target) focusElement(target)
  }, [nextVisible, mode])

  useKeyHandler((key) => {
    if (trackMenu) return false
    const active = document.activeElement
    const focusedId = active instanceof HTMLElement ? active.dataset.navId : undefined
    const interactive = mode === 'interactive'
    switch (key) {
      case 'MediaPlayPause':
        toggle()
        overlay.reveal('info')
        return true
      case 'MediaPlay':
        void adapterRef.current?.play()
        overlay.reveal('info')
        return true
      case 'MediaPause':
        void adapterRef.current?.pause()
        overlay.reveal('info')
        return true
      case 'MediaStop':
        saveRef.current(true)
        exit('details')
        return true
      case 'MediaFastForward':
        skip(30_000)
        overlay.reveal('info')
        return true
      case 'MediaRewind':
        skip(-30_000)
        overlay.reveal('info')
        return true
      case 'ChannelUp':
        zapChannel(1)
        return true
      case 'ChannelDown':
        zapChannel(-1)
        return true
      case 'Enter':
        if (!interactive) {
          // Cartão do próximo episódio focado: OK o aciona (clique nativo).
          if (focusedId === 'pc-next' && nextVisible) return false
          overlay.reveal('interactive')
          return true
        }
        overlay.touch()
        if (focusedId === 'pc-timeline') {
          commitScrub()
          return true
        }
        return false
      case 'ArrowLeft':
      case 'ArrowRight':
      case 'ArrowUp':
      case 'ArrowDown':
        if (!interactive) {
          // Overlay fechado: setas nunca fazem seek. Canais mantêm o comportamento anterior (revelam os controles);
          // com o cartão do próximo episódio focado (OK o aciona), Cima abre os controles.
          if (live || (key === 'ArrowUp' && focusedId === 'pc-next')) overlay.reveal('interactive')
          return true
        }
        overlay.touch()
        if (focusedId === 'pc-timeline' && (key === 'ArrowLeft' || key === 'ArrowRight')) {
          scrub(key === 'ArrowRight' ? 1 : -1)
          return true
        }
        return false
      default:
        return false
    }
  })

  useBackHandler(() => {
    if (trackMenu) {
      setTrackMenu(null)
      return true
    }
    if (previewMs !== null) {
      setPreviewMs(null)
      overlay.touch()
      return true
    }
    saveRef.current(true)
    exit('details')
    return true
  })

  const selectTrack = async (track: PlaybackTrack | null) => {
    const a = adapterRef.current
    setTrackMenu(null)
    if (!a) return
    if (trackMenu === 'text' && !track) await a.setSubtitlesVisible(false).catch(() => undefined)
    else if (track) {
      await a.selectTrack(track.kind, track.index).catch(() => undefined)
      if (track.kind === 'text') await a.setSubtitlesVisible(true).catch(() => undefined)
    }
    a.getTracks().then(setTracks, () => undefined)
  }

  const quality = videoSize ? qualityLabel(videoSize.width, videoSize.height) : null
  const badges = live ? [] : [quality, subtitledFromSource(item?.title ?? title, item?.category) ? 'Legendado' : null].filter((b): b is string => !!b)
  const episodeTitle = (episodeMeta && episodeMeta.id === episode?.id ? episodeMeta.name : '') || episode?.title || undefined
  const nextLabel = nextEpisode ? `${episodeCode(nextEpisode)}${nextEpisode.title ? ` · ${nextEpisode.title}` : ''}` : ''

  return (
    <main ref={rootRef} className="iplex-player" aria-label={`Reproduzindo ${title}`} tabIndex={-1} onMouseMove={() => overlay.reveal('interactive')}>
      <div ref={containerRef} className="iplex-player__surface" />
      {phase.status === 'preparing' || (buffering && phase.status === 'playing') ? (
        <div className="iplex-player__buffering">
          <Spinner label={phase.status === 'preparing' ? 'Preparando reprodução' : 'Carregando'} />
        </div>
      ) : null}
      {cue && <div className="iplex-player__cue">{cue}</div>}
      {phase.status === 'error' ? (
        <div className="iplex-player__error">
          <ErrorState
            error={phase.error}
            onRetry={
              phase.error.retryable
                ? () => {
                    const again = () => setAttempt((a) => a + 1)
                    if (phase.error.kind === 'session-expired') void sessionApi.recoverSession().then(again, () => undefined)
                    else again()
                  }
                : undefined
            }
            secondary={{ label: 'Voltar', onClick: () => exit('details') }}
          />
        </div>
      ) : (
        <>
          <PlayerOverlay
            mode={mode}
            title={item?.title ?? title}
            episodeCode={episode ? episodeCode(episode) : undefined}
            episodeTitle={episodeTitle}
            live={live}
            playing={playing}
            positionMs={time.positionMs}
            durationMs={time.durationMs}
            seekable={seekable}
            previewMs={previewMs}
            pendingMs={pendingMs}
            badges={badges}
            tracks={tracks}
            reserveNext={nextVisible}
            onToggle={() => {
              toggle()
              overlay.touch()
            }}
            onSkip={(direction) => {
              skip(direction * PLAYER.skipMs)
              overlay.touch()
            }}
            onOpenTracks={setTrackMenu}
            onTimelineBlur={() => setPreviewMs(null)}
          />
          {nextVisible && <NextEpisodeCard label={nextLabel} seconds={countdown} onPlay={playNext} />}
        </>
      )}
      {trackMenu && (
        <Dialog title={trackMenu === 'audio' ? 'Áudio' : 'Legendas'} onClose={() => setTrackMenu(null)}>
          <div className="iplex-tracklist">
            {trackMenu === 'text' && (
              <button type="button" className="iplex-chip iplex-focusable" onClick={() => void selectTrack(null)} data-nav="" data-nav-id="track-off" data-nav-autofocus="">
                Desativadas
              </button>
            )}
            {tracks
              .filter((t) => t.kind === trackMenu)
              .map((t) => (
                <button
                  key={`${t.kind}-${t.index}`}
                  type="button"
                  className={t.selected ? 'iplex-chip iplex-focusable is-active' : 'iplex-chip iplex-focusable'}
                  onClick={() => void selectTrack(t)}
                  aria-pressed={t.selected}
                  data-nav=""
                  data-nav-id={`track-${t.kind}-${t.index}`}
                  {...(trackMenu === 'audio' && t.selected ? { 'data-nav-autofocus': '' } : {})}
                >
                  {t.label}
                </button>
              ))}
          </div>
        </Dialog>
      )}
    </main>
  )
}
