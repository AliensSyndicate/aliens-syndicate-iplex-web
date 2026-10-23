/**
 * Reprodução nativa (Samsung AVPlay) pela ponte existente do iPlex Player.
 * Usa somente os métodos anunciados em PlatformInfo.bridge.methods.
 */
import type { BridgeClient } from '../bridge/client'
import type { BridgeMethod, PlayerState } from '../bridge/protocol'
import { createEmitter, type PlaybackAdapter, type PlaybackSource, type PlaybackState, type PlaybackTrack } from './types'

const STATE: Record<PlayerState, PlaybackState> = {
  idle: 'idle',
  loading: 'loading',
  ready: 'ready',
  playing: 'playing',
  paused: 'paused',
  ended: 'ended',
  error: 'error',
}

export function createBridgePlaybackAdapter(bridge: BridgeClient, methods: readonly BridgeMethod[]): PlaybackAdapter {
  const emitter = createEmitter()
  const has = (method: BridgeMethod) => methods.includes(method)
  const unsubscribers: Array<() => void> = []
  let live = false
  let destroyed = false

  unsubscribers.push(
    bridge.on('player.state', (status) => emitter.emit('state', { state: STATE[status.state] ?? 'idle' })),
    bridge.on('player.time', ({ positionMs, durationMs }) => emitter.emit('time', { positionMs, durationMs: live ? 0 : durationMs })),
    bridge.on('player.buffering', ({ phase, percent }) => emitter.emit('buffering', { active: phase !== 'complete', percent })),
    bridge.on('player.error', ({ code, message }) =>
      emitter.emit('error', { code, message, unsupported: /unsupported|not_supported|codec|format/i.test(`${code} ${message}`) }),
    ),
    bridge.on('player.ended', () => emitter.emit('ended', {})),
    bridge.on('player.subtitle', (cue) => emitter.emit('subtitle', cue)),
  )

  return {
    kind: 'native-bridge',
    capabilities: {
      seek: has('player.seek'),
      audioTracks: has('player.getTracks') && has('player.selectTrack'),
      subtitles: has('player.getTracks') && has('player.setSubtitlesVisible'),
    },
    async load(source: PlaybackSource) {
      live = source.live
      emitter.emit('state', { state: 'loading' })
      const status = await bridge.call('player.open', {
        url: source.url,
        autoplay: source.autoplay !== false,
        ...(source.startPositionMs && !source.live ? { startPositionMs: Math.max(0, Math.floor(source.startPositionMs)) } : {}),
      })
      emitter.emit('state', { state: STATE[status.state] ?? 'ready' })
    },
    async play() {
      await bridge.call('player.play')
    },
    async pause() {
      await bridge.call('player.pause')
    },
    async stop() {
      await bridge.call('player.stop')
    },
    async seek(positionMs: number) {
      if (live || !has('player.seek')) return
      const status = await bridge.call('player.seek', { positionMs: Math.max(0, Math.floor(positionMs)) })
      // Posição devolvida pelo AVPlay após o seek (confirmação real, inclusive pausado).
      if (status && Number.isFinite(status.positionMs)) emitter.emit('time', { positionMs: status.positionMs, durationMs: live ? 0 : status.durationMs })
    },
    async getTracks(): Promise<PlaybackTrack[]> {
      if (!has('player.getTracks')) return []
      const tracks = await bridge.call('player.getTracks')
      return tracks.map((t) => ({ kind: t.kind, index: t.index, language: t.language, label: t.language ?? `Faixa ${t.index + 1}`, selected: t.selected }))
    },
    async selectTrack(kind, index) {
      if (has('player.selectTrack')) await bridge.call('player.selectTrack', { kind, index })
    },
    async setSubtitlesVisible(visible) {
      if (has('player.setSubtitlesVisible')) await bridge.call('player.setSubtitlesVisible', { visible })
    },
    on: emitter.on,
    async destroy() {
      if (destroyed) return
      destroyed = true
      unsubscribers.forEach((off) => off())
      emitter.clear()
      try {
        await bridge.call('player.stop')
      } catch {
        // O shell pode já ter parado o player (app oculto).
      }
    },
  }
}
