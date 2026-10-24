/**
 * Busca no catálogo IPTV já carregado no aparelho (os seis conjuntos): instantânea e completa.
 * Sem acentos nem maiúsculas; ordem: começa com o termo, palavra que começa com o termo, contém; A–Z dentro de cada grupo.
 * Conteúdo adulto nunca entra.
 */
import type { CatalogItem } from '../api/types'
import { isAdultItem } from './adult'

export const foldText = (value: string): string => {
  let out = value.toLowerCase()
  try {
    out = out.normalize('NFD').replace(/[̀-ͯ]/g, '')
  } catch {
    /* sem normalize: segue com o texto original */
  }
  return out.replace(/\s+/g, ' ').trim()
}

export function searchItems(items: CatalogItem[], term: string, limit = Infinity): { items: CatalogItem[]; total: number } {
  const q = foldText(term)
  if (!q) return { items: [], total: 0 }
  const hits: Array<{ item: CatalogItem; rank: number; key: string }> = []
  for (const item of items) {
    if (isAdultItem(item)) continue
    const key = foldText(item.title)
    const at = key.indexOf(q)
    if (at < 0) continue
    const rank = at === 0 ? 0 : key.charAt(at - 1) === ' ' || !/[a-z0-9]/.test(key.charAt(at - 1)) ? 1 : 2
    hits.push({ item, rank, key })
  }
  hits.sort((a, b) => a.rank - b.rank || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  return { items: hits.slice(0, limit).map((h) => h.item), total: hits.length }
}
