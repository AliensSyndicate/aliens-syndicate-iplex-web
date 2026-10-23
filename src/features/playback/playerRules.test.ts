import { describe, expect, it } from 'vitest'
import type { SeriesDetails } from '../../services/api/types'
import { clampSeek, createSeekGate, endedEarly, episodeCode, findNextEpisode, formatTimecode, nextEpisodeCountdown, qualityLabel, scrubStepMs, subtitledFromSource } from './playerRules'

const ep = (id: string, season: number, episodeNum: number | null) => ({ id, title: id, season, episodeNum })
const SERIES: SeriesDetails = {
  seriesId: 's',
  seasons: [
    { seasonNumber: 2, name: 'T2', episodes: [ep('b2', 2, 2), ep('b1', 2, 1)] },
    { seasonNumber: 1, name: 'T1', episodes: [ep('a1', 1, 1), ep('a2', 1, 2)] },
  ],
}

describe('playerRules', () => {
  it('seek respeita início, fim e duração desconhecida', () => {
    expect(clampSeek(-5_000, 600_000)).toBe(0)
    expect(clampSeek(700_000, 600_000)).toBe(599_000)
    expect(clampSeek(10_000, 0)).toBeNull()
  })

  it('passo da barra é configurável (fração da duração, com limites)', () => {
    expect(scrubStepMs(7_200_000)).toBe(60_000)
    expect(scrubStepMs(1_000_000)).toBe(10_000)
    expect(scrubStepMs(60_000)).toBe(5_000)
    expect(scrubStepMs(1_000_000, { fraction: 0.05, minMs: 1_000, maxMs: 30_000 })).toBe(30_000)
  })

  it('seek só é confirmado quando o player chega perto do alvo; desiste no prazo', () => {
    let t = 0
    const gate = createSeekGate({ now: () => t, timeoutMs: 10_000 })
    gate.request(130_000)
    expect(gate.onTime(120_500)).toBe(false) // evento atrasado (posição antiga)
    expect(gate.pending).toBe(130_000)
    expect(gate.onTime(129_000)).toBe(true)
    expect(gate.pending).toBeNull()
    gate.request(500_000)
    t = 11_000
    expect(gate.onTime(10_000)).toBe(false)
    expect(gate.pending).toBeNull()
  })

  it('próximo episódio segue a ordem da fonte IPTV, entre temporadas; o último não tem próximo', () => {
    expect(findNextEpisode(SERIES, 'a1')?.id).toBe('a2')
    expect(findNextEpisode(SERIES, 'a2')?.id).toBe('b1')
    expect(findNextEpisode(SERIES, 'b2')).toBeNull()
    expect(findNextEpisode(SERIES, 'zz')).toBeNull()
    expect(findNextEpisode(null, 'a1')).toBeNull()
  })

  it('contagem vem do tempo restante real (pausa congela; fim = 0)', () => {
    expect(nextEpisodeCountdown(500_000, 600_000)).toBeNull()
    expect(nextEpisodeCountdown(570_000, 600_000)).toBe(30)
    expect(nextEpisodeCountdown(580_400, 600_000)).toBe(20)
    expect(nextEpisodeCountdown(600_000, 600_000)).toBe(0)
    expect(nextEpisodeCountdown(10_000, 0)).toBeNull()
    expect(nextEpisodeCountdown(1_000, 20_000)).toBeNull()
  })

  it('término inesperado só longe do fim', () => {
    expect(endedEarly(100_000, 600_000)).toBe(true)
    expect(endedEarly(590_000, 600_000)).toBe(false)
    expect(endedEarly(0, 0)).toBe(false)
  })

  it('selos técnicos só com dados confiáveis', () => {
    expect(qualityLabel(0, 0)).toBeNull()
    expect(qualityLabel(720, 480)).toBe('SD')
    expect(qualityLabel(1280, 720)).toBe('HD')
    expect(qualityLabel(1920, 800)).toBe('Full HD')
    expect(qualityLabel(3840, 2160)).toBe('4K')
    expect(subtitledFromSource('Filme X (2020) [L]')).toBe(true)
    expect(subtitledFromSource('Filmes Legendados')).toBe(true)
    expect(subtitledFromSource('Lego Movie', 'Animação')).toBe(false)
  })

  it('rótulos compactos', () => {
    expect(episodeCode({ season: 1, episodeNum: 3 })).toBe('T1:E3')
    expect(episodeCode({ season: 2, episodeNum: null })).toBe('T2')
    expect(formatTimecode(2_292_000, true)).toBe('00:38:12')
    expect(formatTimecode(8_100_000, true)).toBe('02:15:00')
    expect(formatTimecode(65_000, false)).toBe('01:05')
  })
})
