/**
 * Cache local dos seis conjuntos do catálogo (IndexedDB), por família+perfil e fonte.
 *
 * - Escopo (`família:perfil`) separa as permissões: o que um perfil pode ver nunca
 *   alimenta outro. O backend envia o `viewerKey`; se mudar, o cache é refeito.
 * - Cada escrita (completa ou incremental) é UMA transação: ou aplica tudo ou nada.
 * - Integridade: as contagens por conjunto ficam no meta; divergência = cache
 *   corrompido (o chamador descarta e baixa de novo).
 * - Sem IndexedDB (ou com erro de armazenamento) cai num cache em memória: o app
 *   funciona, só não persiste entre aberturas.
 * Compatível com Chromium M56: IDBObjectStore.getAll e intervalos de chave.
 */
import type { CatalogRecord, CatalogSetName } from '../api/types'

export const CACHE_SCHEMA = 1
export const SET_ORDER: CatalogSetName[] = ['live_categories', 'live', 'vod_categories', 'vod', 'series_categories', 'series']
export type SourceSets = Record<CatalogSetName, CatalogRecord[]>
export type SetOps = Partial<Record<CatalogSetName, { upserts: CatalogRecord[]; deletes: string[] }>>
export interface SourceMeta {
  schema: number
  version: string
  viewerKey: string
  counts: Record<CatalogSetName, number>
  updatedAt: number
}

export interface CatalogCache {
  readonly persistent: boolean
  /** null quando não há cache, ele é de outro esquema ou está corrompido (contagens divergentes). */
  load(scope: string, sourceId: string): Promise<{ meta: SourceMeta; sets: SourceSets } | null>
  replace(scope: string, sourceId: string, meta: SourceMeta, sets: SourceSets): Promise<void>
  /** Aplica upserts/exclusões e grava o novo meta numa única transação. */
  patch(scope: string, sourceId: string, meta: SourceMeta, ops: SetOps): Promise<void>
  clearScope(scope: string): Promise<void>
  clearAll(): Promise<void>
}

export const emptySets = (): SourceSets => ({ live_categories: [], live: [], vod_categories: [], vod: [], series_categories: [], series: [] })
export const countsOf = (sets: SourceSets): Record<CatalogSetName, number> => {
  const out = {} as Record<CatalogSetName, number>
  for (const name of SET_ORDER) out[name] = sets[name].length
  return out
}
const sameCounts = (a: Record<CatalogSetName, number>, b: Record<CatalogSetName, number>) => SET_ORDER.every((n) => a[n] === b[n])

/** Aplica upserts e exclusões a uma lista (mesma regra do backend: por `id`). */
export function applyOps(sets: SourceSets, ops: SetOps): SourceSets {
  const out = {} as SourceSets
  for (const name of SET_ORDER) {
    const op = ops[name]
    if (!op || (!op.upserts.length && !op.deletes.length)) {
      out[name] = sets[name]
      continue
    }
    const map = new Map<string, CatalogRecord>()
    for (const record of sets[name]) map.set(record.id, record)
    for (const id of op.deletes) map.delete(id)
    for (const record of op.upserts) map.set(record.id, record)
    out[name] = Array.from(map.values())
  }
  return out
}

/** Cache em memória: testes e dispositivos sem IndexedDB. Mesma semântica (atomicidade incluída). */
export function createMemoryCache(): CatalogCache {
  const data = new Map<string, { meta: SourceMeta; sets: SourceSets }>()
  const key = (scope: string, sourceId: string) => `${scope}|${sourceId}`
  const clone = (sets: SourceSets): SourceSets => {
    const out = {} as SourceSets
    for (const name of SET_ORDER) out[name] = sets[name].slice()
    return out
  }
  return {
    persistent: false,
    async load(scope, sourceId) {
      const row = data.get(key(scope, sourceId))
      if (!row || row.meta.schema !== CACHE_SCHEMA || !sameCounts(row.meta.counts, countsOf(row.sets))) return null
      return { meta: row.meta, sets: clone(row.sets) }
    },
    async replace(scope, sourceId, meta, sets) {
      data.set(key(scope, sourceId), { meta, sets: clone(sets) })
    },
    async patch(scope, sourceId, meta, ops) {
      const row = data.get(key(scope, sourceId))
      if (!row) throw new Error('cache-missing')
      data.set(key(scope, sourceId), { meta, sets: applyOps(row.sets, ops) })
    },
    async clearScope(scope) {
      for (const k of Array.from(data.keys())) if (k.startsWith(`${scope}|`)) data.delete(k)
    },
    async clearAll() {
      data.clear()
    },
  }
}

const DB_NAME = 'iplex-catalog'
const DB_VERSION = 1
const prefixOf = (scope: string, sourceId: string) => `${scope}|${sourceId}|`
const rangeOf = (prefix: string) => IDBKeyRange.bound(prefix, `${prefix}￿`)
const metaKey = (scope: string, sourceId: string) => `${scope}|${sourceId}`

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('idb-request-failed'))
  })
}
function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('idb-transaction-failed'))
    tx.onabort = () => reject(tx.error ?? new Error('idb-transaction-aborted'))
  })
}

export function createIndexedDbCache(factory: IDBFactory = indexedDB): CatalogCache {
  let opening: Promise<IDBDatabase> | null = null
  const open = () => {
    opening ??= new Promise<IDBDatabase>((resolve, reject) => {
      const req = factory.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta')
        if (!db.objectStoreNames.contains('records')) db.createObjectStore('records')
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error ?? new Error('idb-open-failed'))
      req.onblocked = () => reject(new Error('idb-open-blocked'))
    }).catch((error) => {
      opening = null
      throw error
    })
    return opening
  }
  const recordKey = (scope: string, sourceId: string, set: CatalogSetName, id: string) => `${prefixOf(scope, sourceId)}${set}|${id}`

  return {
    persistent: true,
    async load(scope, sourceId) {
      const db = await open()
      const tx = db.transaction(['meta', 'records'], 'readonly')
      const meta = (await request(tx.objectStore('meta').get(metaKey(scope, sourceId)))) as SourceMeta | undefined
      if (!meta || meta.schema !== CACHE_SCHEMA) return null
      const sets = emptySets()
      for (const name of SET_ORDER) sets[name] = (await request(tx.objectStore('records').getAll(rangeOf(`${prefixOf(scope, sourceId)}${name}|`)))) as CatalogRecord[]
      return sameCounts(meta.counts, countsOf(sets)) ? { meta, sets } : null
    },
    async replace(scope, sourceId, meta, sets) {
      const db = await open()
      const tx = db.transaction(['meta', 'records'], 'readwrite')
      const records = tx.objectStore('records')
      records.delete(rangeOf(prefixOf(scope, sourceId)))
      for (const name of SET_ORDER) for (const record of sets[name]) records.put(record, recordKey(scope, sourceId, name, record.id))
      tx.objectStore('meta').put(meta, metaKey(scope, sourceId))
      await done(tx)
    },
    async patch(scope, sourceId, meta, ops) {
      const db = await open()
      const tx = db.transaction(['meta', 'records'], 'readwrite')
      const records = tx.objectStore('records')
      for (const name of SET_ORDER) {
        const op = ops[name]
        if (!op) continue
        for (const id of op.deletes) records.delete(recordKey(scope, sourceId, name, id))
        for (const record of op.upserts) records.put(record, recordKey(scope, sourceId, name, record.id))
      }
      tx.objectStore('meta').put(meta, metaKey(scope, sourceId))
      await done(tx)
    },
    async clearScope(scope) {
      const db = await open()
      const tx = db.transaction(['meta', 'records'], 'readwrite')
      tx.objectStore('records').delete(rangeOf(`${scope}|`))
      tx.objectStore('meta').delete(rangeOf(`${scope}|`))
      await done(tx)
    },
    async clearAll() {
      const db = await open()
      const tx = db.transaction(['meta', 'records'], 'readwrite')
      tx.objectStore('records').clear()
      tx.objectStore('meta').clear()
      await done(tx)
    },
  }
}

let shared: CatalogCache | null = null
/** Cache do app: IndexedDB quando existir; senão memória. */
export function getCatalogCache(): CatalogCache {
  if (!shared) {
    try {
      shared = typeof indexedDB !== 'undefined' && indexedDB ? createIndexedDbCache() : createMemoryCache()
    } catch {
      shared = createMemoryCache()
    }
  }
  return shared
}
