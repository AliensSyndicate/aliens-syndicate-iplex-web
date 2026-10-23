/**
 * Reprodução no navegador: <video> nativo + hls.js (carregado sob demanda;
 * nunca baixado dentro do shell Samsung, onde o vídeo é do AVPlay).
 *
 * - Substitui o Clappr: o motor de templates dele compila HTML com Function(),
 *   bloqueado pela CSP do Hosting (sem 'unsafe-eval', exigência Samsung para
 *   hosted apps), e o player nunca chegava a abrir em produção.
 * - hls.js sem worker: a CSP não libera blob: em worker-src. MediaSource usa
 *   blob: em media-src, que a CSP permite.
 * - A interface é a do iPlex (PlaybackControls); o <video> não tem controles.
 * - Sem promessa de suporte universal: formatos que o navegador não decodifica
 *   (MPEG-TS cru, DRM, alguns codecs) geram erro "unsupported". Streams http://
 *   são bloqueados por conteúdo misto numa página HTTPS.
 */
import type Hls from 'hls.js'
import { createEmitter, type PlaybackAdapter, type PlaybackSource, type PlaybackTrack } from './types'

type HlsClass = typeof Hls

let modulePromise: Promise<HlsClass> | null = null
export function loadHls(): Promise<HlsClass> {
  modulePromise ??= import('hls.js').then((m) => m.default)
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

/** Arquivos que o <video> toca direto; o resto (m3u8 e URLs sem extensão de IPTV) vai por HLS. */
const DIRECT_MEDIA = /\.(mp4|m4v|webm|mp3|aac)$/i

export function createHtml5Adapter(load: () => Promise<HlsClass> = loadHls): PlaybackAdapter {
  const emitter = createEmitter()
  let video: HTMLVideoElement | null = null
  let hls: Hls | null = null
  let live = false
  let subtitlesOn = false
  let detach: Array<() => void> = []

  const fail = (code: string, message: string, unsupported = false) => {
    emitter.emit('error', { code, message, unsupported })
    emitter.emit('state', { state: 'error' })
  }

  function teardown() {
    detach.forEach((off) => off())
    detach = []
    hls?.destroy()
    hls = null
    if (video) {
      video.pause()
      video.removeAttribute('src')
      video.load()
      video.remove()
      video = null
    }
  }

  return {
    kind: 'html5',
    capabilities: { seek: true, audioTracks: true, subtitles: true },
    async load(source: PlaybackSource, container: HTMLElement | null) {
      if (!container) throw new Error('O player do navegador exige um contêiner')
      if (browserFormatSupport(source.url) === 'unsupported') {
        fail('format_unsupported', 'Formato não suportado pelo navegador', true)
        return
      }
      teardown()
      live = source.live
      subtitlesOn = false
      emitter.emit('state', { state: 'loading' })
      const v = document.createElement('video')
      v.playsInline = true
      v.controls = false
      const autoplay = source.autoplay !== false
      v.autoplay = autoplay
      container.appendChild(v)
      video = v
      const on = (event: string, listener: () => void) => {
        v.addEventListener(event, listener)
        detach.push(() => v.removeEventListener(event, listener))
      }
      let usingHls = false
      const size = () => {
        if (v.videoWidth > 0 && v.videoHeight > 0) emitter.emit('media', { width: v.videoWidth, height: v.videoHeight })
      }
      on('resize', size)
      on('loadedmetadata', () => {
        size()
        emitter.emit('state', { state: 'ready' })
        if (!usingHls && source.startPositionMs && !live) v.currentTime = source.startPositionMs / 1000
      })
      on('playing', () => emitter.emit('state', { state: 'playing' }))
      on('pause', () => {
        if (!v.ended) emitter.emit('state', { state: 'paused' })
      })
      on('ended', () => {
        emitter.emit('state', { state: 'ended' })
        emitter.emit('ended', {})
      })
      const time = () =>
        emitter.emit('time', { positionMs: Math.max(0, v.currentTime * 1000), durationMs: live || !Number.isFinite(v.duration) ? 0 : v.duration * 1000 })
      on('timeupdate', time)
      // Pausado não há timeupdate: o seek concluído confirma a posição nova.
      on('seeked', time)
      on('waiting', () => emitter.emit('buffering', { active: true, percent: 0 }))
      on('canplay', () => emitter.emit('buffering', { active: false, percent: 100 }))
      on('error', () => {
        // With hls.js the element errors are reported (and recovered) by hls.js itself.
        if (usingHls) return
        const error = v.error
        fail(error ? `media_error_${error.code}` : 'playback_error', error?.message || 'Falha na reprodução', error?.code === 4)
      })

      const path = new URL(source.url).pathname
      const nativeHls = v.canPlayType('application/vnd.apple.mpegurl') !== ''
      if (DIRECT_MEDIA.test(path) || nativeHls) {
        v.src = source.url
      } else {
        const HlsJs = await load()
        if (video !== v) return // replaced or destroyed while hls.js was loading
        if (!HlsJs.isSupported()) {
          fail('hls_unsupported', 'Este navegador não reproduz HLS', true)
          return
        }
        usingHls = true
        const instance = new HlsJs({
          enableWorker: false,
          ...(source.startPositionMs && !live ? { startPosition: source.startPositionMs / 1000 } : {}),
        })
        hls = instance
        let recovered = false
        instance.on(HlsJs.Events.ERROR, (_event, data) => {
          if (!data.fatal) return
          if (data.type === HlsJs.ErrorTypes.MEDIA_ERROR && !recovered) {
            recovered = true
            instance.recoverMediaError()
            return
          }
          const details = String(data.details ?? data.type)
          fail(details, 'Falha na reprodução', /incompatible|codec|not.?supported/i.test(details))
        })
        instance.attachMedia(v)
        instance.loadSource(source.url)
      }
      // Autoplay with sound can be refused by the browser: the iPlex controls stay usable.
      if (autoplay) v.play().catch(() => emitter.emit('state', { state: 'paused' }))
    },
    async play() {
      await video?.play()
    },
    async pause() {
      video?.pause()
    },
    async stop() {
      video?.pause()
      hls?.stopLoad()
    },
    async seek(positionMs: number) {
      if (!live && video) video.currentTime = Math.max(0, positionMs / 1000)
    },
    async getTracks(): Promise<PlaybackTrack[]> {
      if (!hls) return []
      const audio: PlaybackTrack[] = hls.audioTracks.map((t, index) => ({
        kind: 'audio',
        index,
        language: t.lang ?? null,
        label: t.name || t.lang || `Áudio ${index + 1}`,
        selected: index === hls!.audioTrack,
      }))
      const text: PlaybackTrack[] = hls.subtitleTracks.map((t, index) => ({
        kind: 'text',
        index,
        language: t.lang ?? null,
        label: t.name || t.lang || `Legenda ${index + 1}`,
        selected: subtitlesOn && index === hls!.subtitleTrack,
      }))
      return [...audio, ...text]
    },
    async selectTrack(kind, index) {
      if (!hls) return
      if (kind === 'audio') hls.audioTrack = index
      else {
        hls.subtitleTrack = index
        hls.subtitleDisplay = true
        subtitlesOn = true
      }
    },
    async setSubtitlesVisible(visible) {
      subtitlesOn = visible
      if (!hls) return
      hls.subtitleDisplay = visible
      if (!visible) hls.subtitleTrack = -1
    },
    on: emitter.on,
    async destroy() {
      emitter.clear()
      teardown()
    },
  }
}
