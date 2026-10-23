/**
 * Regras puras do player de filmes e séries (testáveis, sem React):
 * limites de seek, confirmação de seek pelo player, próximo episódio,
 * contagem regressiva derivada do tempo real e rótulos informativos.
 */
import { PLAYER } from '../../config/features'
import type { SeriesDetails, SeriesEpisode } from '../../services/api/types'

/** Último ponto aceito num seek: o fim exato encerraria a mídia sem querer. */
export const SEEK_END_GUARD_MS = 1_000
/** Prazo para o player confirmar um seek antes de a interface desistir do marcador. */
export const SEEK_CONFIRM_TIMEOUT_MS = 10_000

/** Posição válida para seek, ou null quando a mídia não permite (duração desconhecida). */
export function clampSeek(targetMs: number, durationMs: number): number | null {
  if (!(durationMs > 0) || !Number.isFinite(targetMs)) return null
  return Math.max(0, Math.min(durationMs - SEEK_END_GUARD_MS, Math.round(targetMs)))
}

/** Passo da barra de progresso (PROPOSTA configurável em PLAYER.scrubStep; não é regra definitiva). */
export function scrubStepMs(durationMs: number, step: { fraction: number; minMs: number; maxMs: number } = PLAYER.scrubStep): number {
  const proportional = durationMs > 0 ? durationMs * step.fraction : step.minMs
  return Math.round(Math.max(step.minMs, Math.min(step.maxMs, proportional)))
}

/**
 * Seek pendente: a interface só mostra a posição nova depois que o player a
 * confirma (evento de tempo perto do alvo). Sem confirmação no prazo, desiste
 * (stream sem seek preciso) e volta a mostrar apenas a posição real.
 */
export function createSeekGate({ toleranceMs = 2_500, timeoutMs = SEEK_CONFIRM_TIMEOUT_MS, now = Date.now }: { toleranceMs?: number; timeoutMs?: number; now?: () => number } = {}) {
  let target: number | null = null
  let since = 0
  return {
    request(targetMs: number) {
      target = targetMs
      since = now()
    },
    /** Evento de tempo do player: true quando confirma o seek pendente. */
    onTime(positionMs: number): boolean {
      if (target === null) return false
      if (Math.abs(positionMs - target) <= toleranceMs) {
        target = null
        return true
      }
      if (now() - since > timeoutMs) target = null
      return false
    },
    get pending(): number | null {
      if (target !== null && now() - since > timeoutMs) target = null
      return target
    },
    cancel() {
      target = null
    },
  }
}

/** Ordem de reprodução dos episódios no catálogo IPTV (temporada, número, ordem da fonte). */
export function orderedEpisodes(series: SeriesDetails | null): SeriesEpisode[] {
  if (!series) return []
  return [...series.seasons]
    .sort((a, b) => a.seasonNumber - b.seasonNumber)
    .flatMap((s) =>
      s.episodes
        .map((e, i) => ({ e, i }))
        .sort((a, b) => (a.e.episodeNum ?? Infinity) - (b.e.episodeNum ?? Infinity) || a.i - b.i)
        .map(({ e }) => e),
    )
}

/**
 * Próximo episódio REPRODUZÍVEL: só o que a fonte IPTV lista (readSeries).
 * Metadados do TMDB nunca entram aqui (episódio anunciado ≠ disponível).
 */
export function findNextEpisode(series: SeriesDetails | null, currentEpisodeId: string | null): SeriesEpisode | null {
  if (!currentEpisodeId) return null
  const all = orderedEpisodes(series)
  const index = all.findIndex((e) => e.id === currentEpisodeId)
  return index >= 0 ? (all[index + 1] ?? null) : null
}

/**
 * Segundos restantes para o próximo episódio, derivados do tempo REAL da mídia
 * (pausa congela, seek recalcula). null = fora da janela final.
 */
export function nextEpisodeCountdown(positionMs: number, durationMs: number, windowMs = PLAYER.nextEpisodeWindowMs): number | null {
  if (!(durationMs > windowMs) || positionMs < 0) return null
  const remaining = durationMs - positionMs
  if (remaining > windowMs) return null
  return Math.max(0, Math.ceil(remaining / 1000))
}

/** Término inesperado: o player diz "fim" longe do fim real da mídia. */
export function endedEarly(positionMs: number, durationMs: number): boolean {
  return durationMs > 0 && positionMs / durationMs < 0.9 && durationMs - positionMs > 60_000
}

/** Resolução conhecida do vídeo → selo. Sem dimensões confiáveis, nenhum selo. */
export function qualityLabel(width: number, height: number): 'SD' | 'HD' | 'Full HD' | '4K' | null {
  if (!(width > 0) || !(height > 0)) return null
  if (width >= 3200 || height >= 1800) return '4K'
  if (width >= 1800 || height >= 1000) return 'Full HD'
  if (width >= 1200 || height >= 700) return 'HD'
  return 'SD'
}

/** Marcação explícita de legendado no nome/categoria da fonte IPTV (convenção das listas). */
export function subtitledFromSource(...texts: Array<string | undefined>): boolean {
  return texts.some((t) => !!t && /\blegendad[oa]s?\b|\[\s*leg(endado)?\s*\]|\(\s*leg(endado)?\s*\)|\[L\]|\(L\)/i.test(t))
}

/** "T1:E3" (formato compacto); sem número de episódio, só a temporada. */
export function episodeCode(episode: Pick<SeriesEpisode, 'season' | 'episodeNum'>): string {
  return episode.episodeNum ? `T${episode.season}:E${episode.episodeNum}` : `T${episode.season}`
}

const two = (n: number) => (n < 10 ? `0${n}` : String(n))

/** 00:38:12 (com horas quando a mídia tem 1 h ou mais) ou 38:12. */
export function formatTimecode(ms: number, withHours: boolean): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return withHours || h > 0 ? `${two(h)}:${two(m)}:${two(s)}` : `${two(m)}:${two(s)}`
}
