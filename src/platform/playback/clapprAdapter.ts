/**
 * Reprodução no navegador com Clappr (http://clappr.io), carregado sob
 * demanda (~1 MB com hls.js): nunca entra no bundle inicial nem é baixado
 * dentro do shell Samsung, onde o vídeo é do AVPlay.
 *
 * - `chromeless`: a interface é a do iPlex (PlaybackControls), não a do Clappr.
 * - hls.js sem worker: a CSP não libera blob: em worker-src.
 * - O CSS que o Clappr injeta em <style> é bloqueado pela CSP (sem
 *   'unsafe-inline'); o posicionamento necessário está em player.css.
 * - Sem promessa de suporte universal: formatos que o navegador não decodifica
 *   (MPEG-TS cru, DRM, alguns codecs) geram erro "unsupported". Streams http://
 *   são bloqueados por conteúdo misto numa página HTTPS.
 */
import { createEmitter, type PlaybackAdapter, type PlaybackSource, type PlaybackTrack } from './types'

type ClapprModule = typeof import('@clappr/player')
type ClapprPlayer = InstanceType<ClapprModule['Player']>

let modulePromise: Promise<ClapprModule> | null = null
export function loadClappr(): Promise<ClapprModule> {
  modulePromise ??= import('@clappr/player').then((m) => ((m as unknown as { default?: ClapprModule }).default ?? m) as ClapprModule)
  return modulePromise
}

/** Heurística conservadora de formato (antes de tentar tocar). */
export function browserFormatSupport(url: string): 'supported' | 'unsupported' | 'unknown' {
  let path: string
  try {
    const parsed = new URL(url)
    if (typeof window !== 'undefined' && window.location.protocol === 'https:' && parsed.protocol === 'http:') return 'unsupported'
    path = parsed.pathname
  } catch {
    return 'unknown'
  }
  if (/\.(m3u8|mp4|m4v|webm|mp3|aac)$/i.test(path)) return 'supported'
  if (/\.(ts|mkv|avi|flv|wmv|mpd)$/i.test(path)) return 'unsupported'
  return 'unknown'
}

export function createClapprAdapter(load: () => Promise<ClapprModule> = loadClappr): PlaybackAdapter {
  const emitter = createEmitter()
  let player: ClapprPlayer | null = null
  let live = false
  let subtitlesOn = false

  const events = (Clappr: ClapprModule) => Clappr.Events ?? {}

  return {
    kind: 'clappr',
    capabilities: { seek: true, audioTracks: true, subtitles: true },
    async load(source: PlaybackSource, container: HTMLElement | null) {
      if (!container) throw new Error('Clappr exige um contêiner')
      if (browserFormatSupport(source.url) === 'unsupported') {
        emitter.emit('error', { code: 'format_unsupported', message: 'Formato não suportado pelo navegador', unsupported: true })
        emitter.emit('state', { state: 'error' })
        return
      }
      live = source.live
      emitter.emit('state', { state: 'loading' })
      const Clappr = await load()
      const E = events(Clappr)
      player?.destroy()
      player = new Clappr.Player({
        source: source.url,
        parent: container,
        width: '100%',
        height: '100%',
        autoPlay: source.autoplay !== false,
        mute: false,
        chromeless: true,
        allowUserInteraction: false,
        disableKeyboardShortcuts: true,
        disableVideoTagContextMenu: true,
        playback: {
          playInline: true,
          hlsjsConfig: { enableWorker: false },
        },
      })
      const p = player
      p.on(E.PLAYER_READY ?? 'ready', () => {
        emitter.emit('state', { state: 'ready' })
        if (source.startPositionMs && !live) p.seek(source.startPositionMs / 1000)
      })
      p.on(E.PLAYER_PLAY ?? 'play', () => emitter.emit('state', { state: 'playing' }))
      p.on(E.PLAYER_PAUSE ?? 'pause', () => emitter.emit('state', { state: 'paused' }))
      p.on(E.PLAYER_ENDED ?? 'ended', () => {
        emitter.emit('state', { state: 'ended' })
        emitter.emit('ended', {})
      })
      p.on(E.PLAYER_TIMEUPDATE ?? 'timeupdate', (progress) => {
        const { current, total } = (progress ?? {}) as { current?: number; total?: number }
        emitter.emit('time', { positionMs: Math.max(0, (current ?? 0) * 1000), durationMs: live || !Number.isFinite(total) ? 0 : (total ?? 0) * 1000 })
      })
      p.on(E.PLAYER_ERROR ?? 'error', (raw) => {
        const err = (raw ?? {}) as { code?: string; description?: string; level?: string }
        const text = `${err.code ?? ''} ${err.description ?? ''}`
        emitter.emit('error', {
          code: err.code ?? 'playback_error',
          message: err.description ?? 'Falha na reprodução',
          unsupported: /not.?supported|codec|MEDIA_ERR_SRC_NOT_SUPPORTED|manifestIncompatible/i.test(text),
        })
        emitter.emit('state', { state: 'error' })
      })
      const container$ = p.core?.activeContainer
      container$?.on(E.CONTAINER_STATE_BUFFERING ?? 'container:state:buffering', () => emitter.emit('buffering', { active: true, percent: 0 }))
      container$?.on(E.CONTAINER_STATE_BUFFERFULL ?? 'container:state:bufferfull', () => emitter.emit('buffering', { active: false, percent: 100 }))
    },
    async play() {
      player?.play()
    },
    async pause() {
      player?.pause()
    },
    async stop() {
      player?.stop()
    },
    async seek(positionMs: number) {
      if (!live) player?.seek(Math.max(0, positionMs / 1000))
    },
    async getTracks(): Promise<PlaybackTrack[]> {
      const c = player?.core?.activeContainer
      if (!c) return []
      const currentAudio = c.currentAudioTrack?.id
      const audio: PlaybackTrack[] = (c.audioTracks ?? []).map((t, index) => ({
        kind: 'audio',
        index,
        language: t.language ?? null,
        label: t.label || t.language || `Áudio ${index + 1}`,
        selected: t.id === currentAudio,
      }))
      const text: PlaybackTrack[] = (c.closedCaptionsTracks ?? []).map((t, index) => ({
        kind: 'text',
        index,
        language: t.track?.language ?? null,
        label: t.name || t.track?.label || t.track?.language || `Legenda ${index + 1}`,
        selected: subtitlesOn && c.closedCaptionsTrackId === t.id,
      }))
      return [...audio, ...text]
    },
    async selectTrack(kind, index) {
      const c = player?.core?.activeContainer
      if (!c) return
      if (kind === 'audio') {
        const track = c.audioTracks?.[index]
        if (track && c.switchAudioTrack) c.switchAudioTrack(track.id)
      } else {
        const track = c.closedCaptionsTracks?.[index]
        if (track) {
          c.closedCaptionsTrackId = track.id
          subtitlesOn = true
        }
      }
    },
    async setSubtitlesVisible(visible) {
      const c = player?.core?.activeContainer
      subtitlesOn = visible
      if (c && !visible) c.closedCaptionsTrackId = -1
    },
    on: emitter.on,
    async destroy() {
      emitter.clear()
      try {
        player?.destroy()
      } finally {
        player = null
      }
    },
  }
}
