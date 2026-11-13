/**
 * Player do Ao Vivo compartilhado entre a tela Ao Vivo (prévia ao fundo, com som) e o player em tela cheia.
 *
 * Camadas da tela Ao Vivo: fundo → este player → conteúdo (menu, grade, painel) → overlay do player (só em tela
 * cheia). "Assistir" leva o MESMO canal para a tela cheia, sem reabrir o vídeo; Voltar devolve o canal à prévia.
 * O player só é encerrado quando ninguém o reclama logo depois (outra tela, outro conteúdo).
 *
 * Um player por vez na TV (o AVPlay é único): quem vai tocar outra coisa chama `stopNow()` antes.
 */
import type { PlaybackAdapter } from '../../platform/playback/types'

interface LivePlaybackEntry {
  /** `${sourceId}|${itemId}` do canal carregado. */
  key: string
  adapter: PlaybackAdapter
}

/** Tempo para a próxima tela reclamar o player (Ao Vivo ↔ tela cheia) antes de ele ser encerrado. */
export const LIVE_RELEASE_MS = 1500

let current: LivePlaybackEntry | null = null
let releaseTimer: ReturnType<typeof setTimeout> | null = null

const cancelRelease = () => {
  if (releaseTimer) clearTimeout(releaseTimer)
  releaseTimer = null
}

export const liveKey = (sourceId: string, itemId: string) => `${sourceId}|${itemId}`

export const livePlayback = {
  /** Player já tocando este canal (prévia ou tela cheia), retirado da fila de encerramento. */
  claim(key: string): PlaybackAdapter | null {
    if (!current || current.key !== key) return null
    cancelRelease()
    return current.adapter
  },
  /** Player atual, qualquer canal (a prévia troca de canal no mesmo player). */
  claimAny(): LivePlaybackEntry | null {
    if (!current) return null
    cancelRelease()
    return current
  },
  /** Registra o player e o canal que ele está tocando. */
  adopt(key: string, adapter: PlaybackAdapter) {
    cancelRelease()
    if (current && current.adapter !== adapter) void current.adapter.destroy()
    current = { key, adapter }
  },
  /** Ninguém o reclamou depois de `delayMs`: encerra. */
  release(delayMs = LIVE_RELEASE_MS) {
    cancelRelease()
    if (!current) return
    const entry = current
    releaseTimer = setTimeout(() => {
      releaseTimer = null
      if (current !== entry) return
      current = null
      void entry.adapter.destroy()
    }, delayMs)
  },
  /** Encerra já (antes de outro conteúdo usar o player da TV). */
  async stopNow() {
    cancelRelease()
    const entry = current
    current = null
    if (entry) await entry.adapter.destroy().catch(() => undefined)
  },
  /** Só para testes. */
  reset() {
    cancelRelease()
    current = null
  },
}
