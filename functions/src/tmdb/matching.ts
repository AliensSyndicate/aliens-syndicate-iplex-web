/**
 * Correspondência entre títulos das fontes IPTV e registros do TMDB.
 *
 * Regras:
 * - Os nomes das fontes trazem ruído (qualidade, idioma, prefixos de país,
 *   episódio). O nome original é preservado pelo chamador; aqui só se deriva
 *   uma chave de busca.
 * - Semelhança textual sozinha nunca basta quando há empate: com dois ou mais
 *   candidatos fortes e nada que os desempate (ano), o resultado é
 *   "ambiguous" e nenhum registro é escolhido.
 * - Abaixo do limiar de confiança o resultado é "not_found".
 */

export type MatchKind = 'movie' | 'series'

export interface ParsedTitle {
  /** Título limpo, para enviar à busca do TMDB. */
  query: string
  /** Chave normalizada (sem acentos, minúsculas, sem pontuação). */
  key: string
  year: number | null
  season: number | null
  episode: number | null
}

export interface MatchCandidate {
  id: number
  title: string
  originalTitle: string
  year: number | null
  popularity: number
}

export interface MatchDecision {
  status: 'matched' | 'ambiguous' | 'not_found'
  confidence: number
  candidate: MatchCandidate | null
}

/** Limiar mínimo para aceitar automaticamente uma correspondência. */
export const MATCH_THRESHOLD = 0.82
/** Diferença mínima entre o melhor e o segundo candidato. */
export const MATCH_MARGIN = 0.08

const NOISE = [
  '4k', 'uhd', 'fhd', 'hd', 'sd', 'hq', 'hdr', 'hdr10', 'dolby', 'vision', 'atmos',
  '2160p', '1080p', '720p', '480p', 'h264', 'h265', 'x264', 'x265', 'hevc', '60fps',
  'dual', 'dub', 'dublado', 'dubbed', 'leg', 'legendado', 'legendada', 'sub', 'subs',
  'nacional', 'cam', 'ts', 'web', 'webdl', 'web-dl', 'webrip', 'bluray', 'brrip', 'dvdrip',
  'multi', 'audio', 'pt', 'br', 'ptbr', 'pt-br', 'en', 'es', 'lat', 'latino',
]
const NOISE_SET = new Set(NOISE)

export function foldText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' e ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

export function parseSourceTitle(raw: string): ParsedTitle {
  let text = ` ${raw} `
  let year: number | null = null
  let season: number | null = null
  let episode: number | null = null

  // Episódio: S01E02, S01 E02, T01E02, 1x02.
  const ep = /\b[ST](\d{1,2})\s*[-.]?\s*E(\d{1,3})\b/i.exec(text) ?? /\b(\d{1,2})x(\d{2,3})\b/.exec(text)
  if (ep) {
    season = Number(ep[1])
    episode = Number(ep[2])
    text = text.slice(0, ep.index) + ' '
  }

  // Ano entre parênteses/colchetes ou isolado no fim: "Filme (1999)", "Filme - 1999".
  const yearMatch =
    /[([]\s*((?:19|20)\d{2})\s*[)\]]/.exec(text) ?? /(?:^|[\s\-–|])((?:19|20)\d{2})\s*$/.exec(text.trim())
  if (yearMatch) {
    year = Number(yearMatch[1])
    if (text.includes(yearMatch[0])) text = text.replace(yearMatch[0], ' ')
    else text = text.trim().slice(0, -yearMatch[1]!.length)
  }

  text = text
    // Prefixos de país/idioma: "BR:", "PT |", "[BR]".
    .replace(/^\s*(?:\[[A-Z]{2,3}\]|[A-Z]{2,3}\s*[:|])\s*/i, ' ')
    // Etiquetas entre colchetes/parênteses: [L], (Dub), [4K].
    .replace(/[[(][^\])]{0,24}[\])]/g, ' ')
    .replace(/[|_]+/g, ' ')

  const words = text.split(/\s+/).filter(Boolean)
  // Remove ruído só nas pontas, para não estragar títulos como "HD Stories".
  while (words.length > 1 && NOISE_SET.has(words[words.length - 1]!.toLowerCase().replace(/[^a-z0-9-]/g, ''))) words.pop()
  while (words.length > 1 && NOISE_SET.has(words[0]!.toLowerCase().replace(/[^a-z0-9-]/g, ''))) words.shift()

  const query = words.join(' ').replace(/\s*[-–:]\s*$/, '').trim()
  return { query, key: foldText(query), year, season, episode }
}

/** Coeficiente de Dice sobre bigramas de caracteres (0..1). */
export function similarity(a: string, b: string): number {
  if (!a || !b) return 0
  if (a === b) return 1
  const grams = (s: string) => {
    const out = new Map<string, number>()
    const t = s.replace(/\s+/g, ' ')
    for (let i = 0; i < t.length - 1; i += 1) {
      const g = t.slice(i, i + 2)
      out.set(g, (out.get(g) ?? 0) + 1)
    }
    return out
  }
  const ga = grams(a)
  const gb = grams(b)
  let overlap = 0
  let total = 0
  ga.forEach((count, g) => {
    total += count
    overlap += Math.min(count, gb.get(g) ?? 0)
  })
  gb.forEach((count) => {
    total += count
  })
  return total === 0 ? 0 : (2 * overlap) / total
}

export function scoreCandidate(parsed: ParsedTitle, candidate: MatchCandidate): number {
  const base = Math.max(similarity(parsed.key, foldText(candidate.title)), similarity(parsed.key, foldText(candidate.originalTitle)))
  let score = base
  if (parsed.year !== null && candidate.year !== null) {
    const diff = Math.abs(parsed.year - candidate.year)
    if (diff === 0) score += 0.15
    else if (diff === 1) score += 0.04
    else score -= 0.35
  }
  return Math.max(0, Math.min(1, score))
}

export function decideMatch(parsed: ParsedTitle, candidates: MatchCandidate[]): MatchDecision {
  if (!parsed.key || candidates.length === 0) return { status: 'not_found', confidence: 0, candidate: null }
  const ranked = candidates
    .map((candidate) => ({ candidate, score: scoreCandidate(parsed, candidate) }))
    .sort((a, b) => b.score - a.score || b.candidate.popularity - a.candidate.popularity)
  const best = ranked[0]!
  const second = ranked[1]
  if (best.score < MATCH_THRESHOLD) return { status: 'not_found', confidence: round(best.score), candidate: null }
  if (second && best.score - second.score < MATCH_MARGIN) {
    return { status: 'ambiguous', confidence: round(best.score), candidate: null }
  }
  return { status: 'matched', confidence: round(best.score), candidate: best.candidate }
}

const round = (value: number) => Math.round(value * 1000) / 1000
