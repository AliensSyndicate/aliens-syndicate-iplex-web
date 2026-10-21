/**
 * Reprodução em tela cheia (o menu principal some).
 *
 * 1. O item é relido do catálogo autorizado (perfil do lease).
 * 2. O backend resolve a URL autorizada (resolveSourceStream), revalidando
 *    assinatura, lease, permissões e a fonte. Credenciais IPTV não chegam aqui.
 * 3. Um único adaptador toca: AVPlay (shell Samsung) ou <video> + hls.js (navegador).
 * 4. Progresso: só perfis com biblioteca, só VOD, com frequência controlada.
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
import { PlaybackControls } from '../../components/player/PlaybackControls'
import { TIMING } from '../../config/features'
import { useBackHandler, useKeyHandler } from '../../navigation/FocusProvider'
import { focusElement, initialTarget } from '../../navigation/spatial'
import { createPlaybackAdapter } from '../../platform/playback/createAdapter'
import type { PlaybackAdapter, PlaybackTrack } from '../../platform/playback/types'
import { AppError, toAppError } from '../../services/api/errors'
import type { CatalogItem, ContentKind, SeriesEpisode } from '../../services/api/types'
import { episodeContentId } from '../../services/catalog/normalize'
import { indexFromItem } from '../../services/library/libraryStore'
import { hasPersonalLibrary } from '../profiles/profileRules'
import { createProgressTracker } from './progressTracker'
import { playRequestErrorCode, reportPlayRequest, setPlaybackActive } from '../remote/playRequestReport'

type Phase = { status: 'preparing' } | { status: 'playing' } | { status: 'error'; error: AppError }

export default function PlayerScreen() {
  const location = useLocation()
  const navigate = useNavigate()
  const platform = usePlatform()
  const { backend } = useBackend()
  const session = useReadySession()
  const sessionApi = useSession()
  const q = new URLSearchParams(location.search)
  const sourceId = q.get('s') ?? ''
  const itemId = q.get('i') ?? ''
  const kind = (q.get('k') ?? 'movie') as ContentKind
  const title = q.get('t') ?? ''
  const episodeId = q.get('e')
  const wantsResume = q.get('r') === '1'
  /** Pedido do iPlex Control que abriu esta reprodução (o resultado volta ao celular). */
  const playRequestId = q.get('pr')
  const live = kind === 'channel'
  const personal = hasPersonalLibrary(session.profile)

  const containerRef = useRef<HTMLDivElement>(null)
  const adapterRef = useRef<PlaybackAdapter | null>(null)
  const [phase, setPhase] = useState<Phase>({ status: 'preparing' })
  const [attempt, setAttempt] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [buffering, setBuffering] = useState(true)
  const [time, setTime] = useState({ positionMs: 0, durationMs: 0 })
  const [tracks, setTracks] = useState<PlaybackTrack[]>([])
  const [canSeek, setCanSeek] = useState(false)
  const [trackMenu, setTrackMenu] = useState<'audio' | 'text' | null>(null)
  const [controls, setControls] = useState(true)
  const [cue, setCue] = useState<string | null>(null)
  const [item, setItem] = useState<CatalogItem | null>(null)
  const [episode, setEpisode] = useState<SeriesEpisode | null>(null)
  const timeRef = useRef(time)
  useEffect(() => {
    timeRef.current = time
  }, [time])
  const tracker = useMemo(() => createProgressTracker({ intervalMs: TIMING.progressSaveIntervalMs, minDeltaMs: TIMING.progressMinDeltaMs }), [])
  const contentId = kind === 'series' && episodeId ? episodeContentId(itemId, episodeId) : itemId
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showControls = useCallback(() => {
    setControls(true)
    if (hideTimer.current) clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => setControls(false), TIMING.playerControlsHideMs)
  }, [])

  const saveProgress = useCallback(
    (force: boolean) => {
      if (!personal || live || !item) return
      const { positionMs, durationMs } = timeRef.current
      if (!tracker.shouldSave(positionMs, durationMs, force)) return
      tracker.markSaved(positionMs)
      const label = episode ? `T${episode.season} E${episode.episodeNum ?? '?'}${episode.title ? ` · ${episode.title}` : ''}` : ''
      const meta = indexFromItem(item, episode ? { id: episode.id, label, contentId } : undefined)
      void session.library.saveProgress(contentId, positionMs / 1000, durationMs / 1000, meta).catch(() => undefined)
    },
    [personal, live, item, episode, contentId, session.library, tracker],
  )
  const saveRef = useRef(saveProgress)
  useEffect(() => {
    saveRef.current = saveProgress
  }, [saveProgress])

  // Prepara e inicia a reprodução.
  useEffect(() => {
    let alive = true
    let adapter: PlaybackAdapter | null = null
    const offs: Array<() => void> = []
    const root = document.documentElement
    setPhase({ status: 'preparing' })
    setBuffering(true)
    ;(async () => {
      try {
        const found = await session.catalog.findItem(sourceId, itemId, title)
        if (!alive) return
        if (!found || found.kind !== kind) throw new AppError('content-unavailable')
        setItem(found)
        if (found.kind === 'series' && episodeId) {
          const details = await backend.readSeries(session.profile.id, found.sourceId, found.providerRef).catch(() => null)
          const ep = details?.seasons.flatMap((s) => s.episodes).find((e) => e.id === episodeId) ?? null
          if (alive) setEpisode(ep)
        }
        const grant = await backend.resolveStream(session.profile.id, { sourceId: found.sourceId, itemId: found.id, ...(episodeId ? { episodeId } : {}) })
        if (!alive) return
        adapter = createPlaybackAdapter(platform)
        adapterRef.current = adapter
        setCanSeek(adapter.capabilities.seek && !live)
        if (adapter.kind === 'native-bridge') root.classList.add('is-native-playback')
        offs.push(
          adapter.on('state', ({ state }) => {
            setPlaying(state === 'playing')
            if (state === 'playing') reportPlayRequest(backend, playRequestId, 'started')
            if (state === 'playing' || state === 'paused') setBuffering(false)
            if (state === 'paused') saveRef.current(true)
          }),
          adapter.on('time', (t) => {
            setTime(t)
            timeRef.current = t
            saveRef.current(false)
          }),
          adapter.on('buffering', ({ active }) => setBuffering(active)),
          adapter.on('error', (info) => {
            setPhase({ status: 'error', error: new AppError(info.unsupported ? 'format-unsupported' : 'playback-error', info.code) })
          }),
          adapter.on('ended', () => {
            saveRef.current(true)
            setPlaying(false)
          }),
          adapter.on('subtitle', ({ text, durationMs }) => {
            setCue(text)
            setTimeout(() => setCue((c) => (c === text ? null : c)), durationMs || 3000)
          }),
        )
        const resumeFrom = wantsResume && personal && !live ? session.library.progressFor(contentId) : null
        await adapter.load(
          { url: grant.url, live, autoplay: true, ...(resumeFrom ? { startPositionMs: resumeFrom.position * 1000 } : {}) },
          containerRef.current,
        )
        if (!alive) return
        setPhase((p) => (p.status === 'error' ? p : { status: 'playing' }))
        adapter.getTracks().then((t) => alive && setTracks(t), () => undefined)
        showControls()
      } catch (raw) {
        if (alive) setPhase({ status: 'error', error: toAppError(raw) })
      }
    })()
    return () => {
      alive = false
      saveRef.current(true)
      offs.forEach((off) => off())
      root.classList.remove('is-native-playback')
      if (adapter) void adapter.destroy()
      adapterRef.current = null
      if (hideTimer.current) clearTimeout(hideTimer.current)
    }
    // A reprodução reinicia ao mudar o conteúdo ou ao tentar novamente.
  }, [sourceId, itemId, episodeId, kind, attempt]) // eslint-disable-line react-hooks/exhaustive-deps

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

  useEffect(() => {
    if (controls && phase.status === 'playing') {
      const id = setTimeout(() => {
        const target = initialTarget(document.querySelector('.iplex-player__controls') ?? document)
        if (target && !document.activeElement?.closest('.iplex-player__controls')) focusElement(target)
      }, 0)
      return () => clearTimeout(id)
    }
  }, [controls, phase.status])

  const toggle = () => {
    const a = adapterRef.current
    if (!a) return
    void (playing ? a.pause() : a.play())
    showControls()
  }
  const seekBy = (delta: number) => {
    const a = adapterRef.current
    if (!a?.seek || live) return
    void a.seek(Math.max(0, Math.min(time.durationMs || Infinity, time.positionMs + delta)))
    showControls()
  }
  const zapChannel = (direction: 1 | -1) => {
    if (!live) return
    const channels = session.catalog.items('channel')
    const index = channels.findIndex((c) => c.id === itemId)
    const next = channels[(index + direction + channels.length) % channels.length]
    if (next && next.id !== itemId) navigate(PATHS.watch({ sourceId: next.sourceId, itemId: next.id, kind: 'channel', title: next.title }), { replace: true })
  }

  useKeyHandler((key) => {
    if (trackMenu) return false
    switch (key) {
      case 'MediaPlayPause':
        toggle()
        return true
      case 'MediaPlay':
        void adapterRef.current?.play()
        showControls()
        return true
      case 'MediaPause':
        void adapterRef.current?.pause()
        showControls()
        return true
      case 'MediaStop':
        navigate(-1)
        return true
      case 'MediaFastForward':
        seekBy(30_000)
        return true
      case 'MediaRewind':
        seekBy(-30_000)
        return true
      case 'ChannelUp':
        zapChannel(1)
        return true
      case 'ChannelDown':
        zapChannel(-1)
        return true
      default:
        if (!controls) {
          showControls()
          return true // a primeira tecla só revela os controles
        }
        showControls()
        return false
    }
  })

  useBackHandler(() => {
    if (trackMenu) {
      setTrackMenu(null)
      return true
    }
    navigate(-1)
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

  const episodeLabel = episode ? `T${episode.season} · E${episode.episodeNum ?? '?'}${episode.title ? ` · ${episode.title}` : ''}` : undefined

  return (
    <main className="iplex-player" aria-label={`Reproduzindo ${title}`} onMouseMove={showControls}>
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
            secondary={{ label: 'Voltar', onClick: () => navigate(-1) }}
          />
        </div>
      ) : (
        <div className={controls ? 'iplex-player__overlay is-visible' : 'iplex-player__overlay'} aria-hidden={!controls}>
          <PlaybackControls
            title={item?.title ?? title}
            subtitle={episodeLabel}
            live={live}
            playing={playing}
            positionMs={time.positionMs}
            durationMs={time.durationMs}
            canSeek={canSeek}
            tracks={tracks}
            onToggle={toggle}
            onSeekBy={seekBy}
            onOpenTracks={setTrackMenu}
          />
        </div>
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
