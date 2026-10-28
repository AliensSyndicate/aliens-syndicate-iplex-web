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
import { diag } from '../../platform/diagnostics'

/** 3: cada conjunto é gravado em blocos de texto JSON (um registro por entrada era lento demais na TV). */
export const CACHE_SCHEMA = 3
/** Esquema anterior (um registro por entrada): lido uma vez e regravado no formato novo, sem perder o catálogo. */
const LEGACY_SCHEMA = 2
export const SET_ORDER: CatalogSetName[] = ['live_categories', 'live', 'vod_categories', 'vod', 'series_categories', 'series', 'adult_categories', 'adult']
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
  /** Só o meta (barato). null quando não há cache ou ele não está no esquema atual (o `load` migra o antigo). */
  loadMeta(scope: string, sourceId: string): Promise<SourceMeta | null>
  /**
   * Leitor dos conjuntos pedidos: as leituras do banco saem todas de uma vez (em paralelo com o trabalho da interface)
   * e cada conjunto é interpretado só quando pedido, aos poucos: `pause` roda entre blocos para a interface responder.
   */
  reader(scope: string, sourceId: string, sets: CatalogSetName[]): (set: CatalogSetName, pause?: () => Promise<void>) => Promise<CatalogRecord[]>
  replace(scope: string, sourceId: string, meta: SourceMeta, sets: SourceSets): Promise<void>
  /** Aplica upserts/exclusões e grava o novo meta numa única transação. `next`: conjuntos já resultantes (evita reler). */
  patch(scope: string, sourceId: string, meta: SourceMeta, ops: SetOps, next?: SourceSets): Promise<void>
  clearScope(scope: string): Promise<void>
  clearAll(): Promise<void>
}

export const emptySets = (): SourceSets => ({ live_categories: [], live: [], vod_categories: [], vod: [], series_categories: [], series: [], adult_categories: [], adult: [] })
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
    async loadMeta(scope, sourceId) {
      const row = data.get(key(scope, sourceId))
      return row && row.meta.schema === CACHE_SCHEMA ? row.meta : null
    },
    reader(scope, sourceId) {
      return async (set) => data.get(key(scope, sourceId))?.sets[set].slice() ?? []
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
/** Registros por bloco: poucas entradas grandes desserializam muito mais rápido que milhares de pequenas. */
const CHUNK_RECORDS = 1000
const prefixOf = (scope: string, sourceId: string) => `${scope}|${sourceId}|`
const setPrefix = (scope: string, sourceId: string, set: CatalogSetName) => `${prefixOf(scope, sourceId)}${set}|`
const rangeOf = (prefix: string) => IDBKeyRange.bound(prefix, `${prefix}\uffff`)
const metaKey = (scope: string, sourceId: string) => `${scope}|${sourceId}`
const chunkKey = (prefix: string, index: number) => `${prefix}${String(index).padStart(5, '0')}`

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
const parseChunks = (chunks: unknown[]): CatalogRecord[] => {
  const out: CatalogRecord[] = []
  for (const chunk of chunks) for (const record of JSON.parse(String(chunk)) as CatalogRecord[]) out.push(record)
  return out
}
/** Substitui os blocos de um conjunto (apaga os antigos e grava os novos). */
function writeSet(records: IDBObjectStore, scope: string, sourceId: string, set: CatalogSetName, list: CatalogRecord[]) {
  const prefix = setPrefix(scope, sourceId, set)
  records.delete(rangeOf(prefix))
  for (let i = 0, n = 0; i < list.length; i += CHUNK_RECORDS, n += 1) records.put(JSON.stringify(list.slice(i, i + CHUNK_RECORDS)), chunkKey(prefix, n))
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

  const cache: CatalogCache = {
    persistent: true,
    async load(scope, sourceId) {
      const t0 = performance.now()
      const db = await open()
      const tx = db.transaction(['meta', 'records'], 'readonly')
      const meta = (await request(tx.objectStore('meta').get(metaKey(scope, sourceId)))) as SourceMeta | undefined
      if (meta?.schema === LEGACY_SCHEMA) {
        const old = emptySets()
        const store = tx.objectStore('records')
        const rows = await Promise.all(SET_ORDER.map((name) => request(store.getAll(rangeOf(setPrefix(scope, sourceId, name))))))
        SET_ORDER.forEach((name, i) => {
          old[name] = rows[i] as CatalogRecord[]
        })
        if (!sameCounts(meta.counts, countsOf(old))) return null
        const upgraded = { ...meta, schema: CACHE_SCHEMA }
        await cache.replace(scope, sourceId, upgraded, old)
        diag('cache', `migrado do esquema ${LEGACY_SCHEMA} em ${Math.round(performance.now() - t0)}ms`)
        return { meta: upgraded, sets: old }
      }
      if (!meta || meta.schema !== CACHE_SCHEMA) return null
      // Os oito pedidos saem juntos; a leitura é de poucos blocos de texto.
      const store = tx.objectStore('records')
      const raw = await Promise.all(SET_ORDER.map((name) => request(store.getAll(rangeOf(setPrefix(scope, sourceId, name))))))
      const t1 = performance.now()
      const sets = emptySets()
      SET_ORDER.forEach((name, i) => {
        sets[name] = parseChunks(raw[i]!)
      })
      diag('cache', `leitura=${Math.round(t1 - t0)}ms parse=${Math.round(performance.now() - t1)}ms registros=${SET_ORDER.reduce((n, name) => n + sets[name].length, 0)}`)
      return sameCounts(meta.counts, countsOf(sets)) ? { meta, sets } : null
    },
    async loadMeta(scope, sourceId) {
      const db = await open()
      const tx = db.transaction('meta', 'readonly')
      const meta = (await request(tx.objectStore('meta').get(metaKey(scope, sourceId)))) as SourceMeta | undefined
      return meta && meta.schema === CACHE_SCHEMA ? meta : null
    },
    reader(scope, sourceId, sets) {
      const raw = new Map<CatalogSetName, Promise<unknown[]>>()
      const started = performance.now()
      const tx = open().then((db) => db.transaction('records', 'readonly'))
      // Se o navegador encerrar a transação compartilhada antes de um pedido, esse conjunto é lido numa transação própria.
      const alone = (set: CatalogSetName) => open().then((db) => request(db.transaction('records', 'readonly').objectStore('records').getAll(rangeOf(setPrefix(scope, sourceId, set)))) as Promise<unknown[]>)
      for (const set of sets) raw.set(set, tx.then((t) => request(t.objectStore('records').getAll(rangeOf(setPrefix(scope, sourceId, set)))) as Promise<unknown[]>).catch(() => alone(set)))
      for (const promise of raw.values()) promise.catch(() => undefined)
      return async (set, pause) => {
        const asked = performance.now()
        const chunks = await (raw.get(set) ?? Promise.resolve([]))
        const got = performance.now()
        const out: CatalogRecord[] = []
        for (const chunk of chunks) {
          for (const record of JSON.parse(String(chunk)) as CatalogRecord[]) out.push(record)
          if (pause) await pause()
        }
        diag('cache', `${set} n=${out.length} espera=${Math.round(got - asked)}ms (leitura desde o início ${Math.round(got - started)}ms) parse=${Math.round(performance.now() - got)}ms`)
        return out
      }
    },
    async replace(scope, sourceId, meta, sets) {
      const db = await open()
      const tx = db.transaction(['meta', 'records'], 'readwrite')
      const records = tx.objectStore('records')
      records.delete(rangeOf(prefixOf(scope, sourceId)))
      for (const name of SET_ORDER) writeSet(records, scope, sourceId, name, sets[name])
      tx.objectStore('meta').put(meta, metaKey(scope, sourceId))
      await done(tx)
    },
    async patch(scope, sourceId, meta, ops, next) {
      const db = await open()
      const tx = db.transaction(['meta', 'records'], 'readwrite')
      const records = tx.objectStore('records')
      for (const name of SET_ORDER) {
        const op = ops[name]
        if (!op) continue
        let list = next?.[name]
        if (!list) {
          const current = parseChunks((await request(records.getAll(rangeOf(setPrefix(scope, sourceId, name))))) as unknown[])
          list = applyOps({ ...emptySets(), [name]: current }, { [name]: op })[name]
        }
        writeSet(records, scope, sourceId, name, list)
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
  return cache
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
