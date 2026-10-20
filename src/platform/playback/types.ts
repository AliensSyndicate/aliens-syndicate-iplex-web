/**
 * Abstração de reprodução. Uma única implementação ativa por vez:
 * - shell Samsung (AVPlay) pela ponte, quando PlatformInfo anuncia player nativo;
 * - Clappr no navegador.
 * Nunca as duas ao mesmo tempo.
 */

export interface PlaybackSource {
  url: string
  /** Ao vivo: sem linha do tempo, sem avanço/retrocesso. */
  live: boolean
  startPositionMs?: number
  autoplay?: boolean
}

export type PlaybackState = 'idle' | 'loading' | 'ready' | 'playing' | 'paused' | 'ended' | 'error'

export interface PlaybackTrack {
  kind: 'audio' | 'text'
  index: number
  language: string | null
  label: string
  selected: boolean
}

export interface PlaybackErrorInfo {
  code: string
  message: string
  /** Formato/codec não suportado pelo player desta plataforma. */
  unsupported?: boolean
}

export interface PlaybackEventMap {
  state: { state: PlaybackState }
  time: { positionMs: number; durationMs: number }
  buffering: { active: boolean; percent: number }
  error: PlaybackErrorInfo
  ended: Record<string, never>
  subtitle: { text: string; durationMs: number }
}

export type PlaybackEventName = keyof PlaybackEventMap

export interface PlaybackCapabilities {
  seek: boolean
  audioTracks: boolean
  subtitles: boolean
}

export interface PlaybackAdapter {
  readonly kind: 'native-bridge' | 'clappr'
  readonly capabilities: PlaybackCapabilities
  /** `container` é usado pelo Clappr; o AVPlay desenha atrás da camada web. */
  load(source: PlaybackSource, container: HTMLElement | null): Promise<void>
  play(): Promise<void>
  pause(): Promise<void>
  stop(): Promise<void>
  seek?(positionMs: number): Promise<void>
  getTracks(): Promise<PlaybackTrack[]>
  selectTrack(kind: 'audio' | 'text', index: number): Promise<void>
  setSubtitlesVisible(visible: boolean): Promise<void>
  on<E extends PlaybackEventName>(event: E, listener: (data: PlaybackEventMap[E]) => void): () => void
  destroy(): Promise<void>
}

export function createEmitter() {
  const listeners = new Map<PlaybackEventName, Set<(data: never) => void>>()
  return {
    on<E extends PlaybackEventName>(event: E, listener: (data: PlaybackEventMap[E]) => void) {
      const set = listeners.get(event) ?? new Set()
      set.add(listener as (data: never) => void)
      listeners.set(event, set)
      return () => {
        set.delete(listener as (data: never) => void)
      }
    },
    emit<E extends PlaybackEventName>(event: E, data: PlaybackEventMap[E]) {
      listeners.get(event)?.forEach((listener) => (listener as (d: PlaybackEventMap[E]) => void)(data))
    },
    clear() {
      listeners.clear()
    },
  }
}
