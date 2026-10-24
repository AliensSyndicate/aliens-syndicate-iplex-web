import { readJson, writeJson } from '../../utils/storage'

/**
 * Recentes da Busca: o ITEM aberto (canal, filme, série ou ator), não o texto digitado.
 * Um ator guarda o título autorizado usado para abrir a ficha dele.
 */
export type RecentEntry =
  | { type: 'item'; kind: 'channel' | 'movie' | 'series'; sourceId: string; itemId: string }
  | { type: 'person'; personId: number; name: string; photo: string | null; knownFor: string; scope: { sourceId: string; itemId: string; title: string } }

const MAX = 20
const key = (familyId: string, profileId: string) => `iplex.search.recent.v2.${familyId}.${profileId}`
export const recentKey = (e: RecentEntry): string => (e.type === 'item' ? `i:${e.itemId}` : `p:${e.personId}`)

const valid = (e: unknown): e is RecentEntry => {
  const v = e as Partial<RecentEntry> | null
  if (!v || typeof v !== 'object') return false
  if (v.type === 'item') return typeof v.itemId === 'string' && typeof v.sourceId === 'string' && (v.kind === 'channel' || v.kind === 'movie' || v.kind === 'series')
  return v.type === 'person' && typeof v.personId === 'number' && typeof v.name === 'string' && !!v.scope
}

export const readRecents = (familyId: string, profileId: string): RecentEntry[] => {
  const value = readJson<unknown[]>(key(familyId, profileId))
  return Array.isArray(value) ? value.filter(valid).slice(0, MAX) : []
}

/** Guarda o item aberto (mais recente primeiro, sem repetir). */
export function addRecent(familyId: string, profileId: string, entry: RecentEntry): RecentEntry[] {
  const next = [entry, ...readRecents(familyId, profileId).filter((e) => recentKey(e) !== recentKey(entry))].slice(0, MAX)
  writeJson(key(familyId, profileId), next)
  return next
}
