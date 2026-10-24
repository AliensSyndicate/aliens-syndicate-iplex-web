import type { CatalogItem } from '../../services/api/types'
import { isAdultItem } from '../../services/catalog/adult'
import { sortItems } from '../catalog/collections'

/**
 * Lista usada para trocar de canal com as setas: a mesma de "Todos" (A–Z, sem canais adultos).
 * Quem assiste a um canal adulto troca só entre canais adultos (eles nunca entram em "Todos").
 */
export function zapList(channels: CatalogItem[], currentId: string): CatalogItem[] {
  const current = channels.find((c) => c.id === currentId)
  const adult = !!current && isAdultItem(current)
  return sortItems(channels.filter((c) => c.kind === 'channel' && isAdultItem(c) === adult), 'az')
}

/** Canal vizinho na lista (circular); `null` se não houver outro. */
export function neighbourChannel(list: CatalogItem[], currentId: string, direction: 1 | -1): CatalogItem | null {
  if (list.length < 2) return null
  const index = list.findIndex((c) => c.id === currentId)
  const next = list[(index + direction + list.length) % list.length] ?? null
  return next && next.id !== currentId ? next : null
}
