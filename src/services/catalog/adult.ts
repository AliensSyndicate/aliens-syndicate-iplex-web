/**
 * Conteúdo adulto no cliente. O backend (Control) só entrega itens adultos a perfis com
 * "Conteúdo adulto" habilitado; esta regra espelha a dele (content_audience.ts) para que, mesmo
 * habilitado, o conteúdo adulto fique restrito à categoria "Adulto": fora de "Todos", sem detalhes,
 * sem gravação em biblioteca/progresso/status e fora da busca.
 */
import { isAdultName } from './categoryLabels'

const fold = (value: unknown) => String(value ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
const ADULT = /(^|[^a-z0-9])(xxx|adult[oa]?s?|adults?|porn\w*|erotic\w*|erotik\w*|hentai|playboy|sexy|18\s*\+|\+\s*18|for adults)([^a-z0-9]|$)/
const ADULT_RATING = /^(18|18\+|r18|nc-17|nc17|x|xxx|pegi 18|pegi18|fsk 18|fsk18)$/

export interface AdultCandidate {
  title?: string
  category?: string
  ageRating?: string
  isAdult?: boolean
}

export function isAdultItem(item: AdultCandidate): boolean {
  if (item.isAdult === true) return true
  if (ADULT.test(fold(item.title)) || ADULT.test(fold(item.category))) return true
  if (item.category && isAdultName(item.category)) return true
  const rating = fold(item.ageRating).replace(/\s+anos?$|\s+years?$/, '')
  return rating !== '' && ADULT_RATING.test(rating)
}
