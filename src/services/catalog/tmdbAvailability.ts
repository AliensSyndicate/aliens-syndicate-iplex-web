/**
 * Título do TMDB (filmografia, recomendações) → item do catálogo IPTV do perfil.
 *
 * A TV só abre o que a fonte IPTV autorizada tem: busca o nome no catálogo
 * (o backend aplica as permissões do perfil) e confirma, pela correspondência
 * TMDB do próprio item, que é o mesmo título (mesmo id), nunca só pelo nome.
 */
import type { CatalogItem } from '../api/types'
import type { TmdbMatchResult } from '../tmdb/tmdbClient'

export interface TmdbTitleRef {
  tmdbId: number
  kind: 'movie' | 'series'
  title: string
  originalTitle?: string
}

/** Candidatos verificados por termo (cada verificação é uma correspondência TMDB). */
export const MAX_CANDIDATES = 6

export async function findCatalogTitle(
  search: (term: string) => Promise<CatalogItem[]>,
  match: (item: CatalogItem) => Promise<TmdbMatchResult>,
  target: TmdbTitleRef,
): Promise<CatalogItem | null> {
  const terms = [target.title, target.originalTitle].filter((t, i, all): t is string => !!t && t.trim().length >= 2 && all.indexOf(t) === i)
  const checked = new Set<string>()
  for (const term of terms) {
    const candidates = (await search(term)).filter((item) => item.kind === target.kind && !checked.has(item.id)).slice(0, MAX_CANDIDATES)
    for (const candidate of candidates) {
      checked.add(candidate.id)
      const result = await match(candidate).catch(() => null)
      if (result?.status === 'matched' && result.summary?.tmdbId === target.tmdbId) return candidate
    }
  }
  return null
}
