/**
 * Normalização dos dados de séries vindos do backend
 * (functions/src/iptv_adapters.ts → normalizeSeriesDetail no Gestor):
 * { seasons: [{ id, name, seasonNumber, episodeCount }], episodes: { [season]: [...] } }
 */
import type { SeriesDetails, SeriesEpisode, SeriesSeason } from '../api/types'

const toInt = (value: unknown): number | null => {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number.parseInt(value, 10) : NaN
  return Number.isFinite(n) ? n : null
}

export function normalizeSeriesDetails(seriesId: string, raw: unknown): SeriesDetails | null {
  if (!raw || typeof raw !== 'object') return null
  const data = raw as { seasons?: unknown; episodes?: unknown }
  const names = new Map<number, string>()
  if (Array.isArray(data.seasons)) {
    for (const s of data.seasons as Array<Record<string, unknown>>) {
      const n = toInt(s.seasonNumber)
      if (n !== null) names.set(n, typeof s.name === 'string' ? s.name : '')
    }
  }
  const bySeason = new Map<number, SeriesEpisode[]>()
  if (data.episodes && typeof data.episodes === 'object') {
    for (const [key, rows] of Object.entries(data.episodes as Record<string, unknown>)) {
      if (!Array.isArray(rows)) continue
      for (const row of rows as Array<Record<string, unknown>>) {
        if (typeof row.id !== 'string' && typeof row.id !== 'number') continue
        const season = toInt(row.season) ?? toInt(key) ?? 0
        const episode: SeriesEpisode = {
          id: String(row.id),
          title: typeof row.title === 'string' ? row.title : '',
          season,
          episodeNum: toInt(row.episodeNum),
          ...(typeof row.duration === 'string' && row.duration ? { duration: row.duration } : {}),
          ...(typeof row.plot === 'string' && row.plot ? { plot: row.plot } : {}),
        }
        const list = bySeason.get(season) ?? []
        list.push(episode)
        bySeason.set(season, list)
      }
    }
  }
  const seasons: SeriesSeason[] = Array.from(bySeason.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([seasonNumber, episodes]) => ({
      seasonNumber,
      name: names.get(seasonNumber) || (seasonNumber === 0 ? 'Especiais' : `Temporada ${seasonNumber}`),
      episodes: episodes.sort((a, b) => (a.episodeNum ?? 9999) - (b.episodeNum ?? 9999)),
    }))
  return { seriesId, seasons }
}

/** contentId de episódio para progresso: <id da série>_e<id do episódio> (cabe em idSchema). */
export function episodeContentId(seriesItemId: string, episodeId: string): string {
  return `${seriesItemId}_e${episodeId.replace(/[^A-Za-z0-9_-]/g, '')}`.slice(0, 128)
}

export function parseEpisodeContentId(contentId: string): { seriesItemId: string; episodeId: string } | null {
  const m = /^([A-Za-z0-9-]+)_e([A-Za-z0-9_-]+)$/.exec(contentId)
  return m ? { seriesItemId: m[1]!, episodeId: m[2]! } : null
}

/** Ano numérico a partir do campo livre da fonte. */
export function itemYear(year: unknown): number | null {
  const n = toInt(year)
  return n !== null && n > 1800 && n < 2200 ? n : null
}
