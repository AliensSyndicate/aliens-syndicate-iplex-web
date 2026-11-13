/**
 * Foto pequena dos lançamentos do Meu iPlex guardada no aparelho (por família e perfil). Na abertura seguinte,
 * destaque e Lançamentos aparecem na hora, sem esperar os milhares de filmes e séries carregarem; quando o catálogo
 * chega, a lista real substitui a foto (e a foto é regravada). Só campos de exibição, nunca URLs de reprodução.
 */
import type { CatalogItem } from '../../services/api/types'
import { readJson, writeJson } from '../../utils/storage'

const FIELDS = ['id', 'sourceId', 'kind', 'title', 'year', 'addedAt', 'imageRef', 'category', 'categoryId', 'providerRef', 'version'] as const
const MAX = 20

export function readHomeSnapshot(key: string): CatalogItem[] {
  const list = readJson<CatalogItem[]>(key)
  if (!Array.isArray(list)) return []
  // Nunca conteúdo adulto nem canais (o destaque e Lançamentos são só filmes e séries).
  return list.filter((item) => item && typeof item.id === 'string' && typeof item.sourceId === 'string' && (item.kind === 'movie' || item.kind === 'series') && !item.isAdult).slice(0, MAX)
}

export function writeHomeSnapshot(key: string, items: CatalogItem[]) {
  const slim = items
    .filter((item) => (item.kind === 'movie' || item.kind === 'series') && !item.isAdult)
    .slice(0, MAX)
    .map((item) => Object.fromEntries(FIELDS.filter((f) => item[f as keyof CatalogItem] !== undefined).map((f) => [f, item[f as keyof CatalogItem]])))
  writeJson(key, slim)
}
