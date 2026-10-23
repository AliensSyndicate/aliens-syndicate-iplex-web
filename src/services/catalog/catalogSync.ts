/**
 * Preparação do catálogo da TV a partir dos seis conjuntos do Control.
 *
 *  1. Manifesto (versão atual + impressão digital das permissões do perfil).
 *  2. Cache local da mesma família/perfil/fonte:
 *       - mesma versão          → usa o cache, sem baixar nada;
 *       - versão antiga         → pede ao backend só as diferenças (inclusões, alterações
 *                                 e exclusões) e aplica numa transação; sem histórico
 *                                 confiável ou qualquer falha → baixa tudo;
 *       - permissões mudaram, cache de outro esquema, corrompido ou ausente → baixa tudo.
 *  3. Baixa completa por grupo (filmes → séries → canais), com o texto de progresso real.
 *
 * Nenhum estado parcial vai à interface: o chamador só recebe conjuntos completos e
 * consistentes (ou um erro). Falha ao gravar o cache nunca impede o uso dos dados.
 */
import type { Backend } from '../api/backend'
import { toAppError } from '../api/errors'
import type { CatalogManifest, CatalogRecord, CatalogSetName } from '../api/types'
import { CACHE_SCHEMA, SET_ORDER, applyOps, countsOf, emptySets, type CatalogCache, type SetOps, type SourceMeta, type SourceSets } from './catalogCache'

export type SyncGroup = 'movies' | 'series' | 'channels'
export type SyncMode = 'cache' | 'delta' | 'full'
export const GROUPS: SyncGroup[] = ['movies', 'series', 'channels']
const GROUP_SETS: Record<SyncGroup, CatalogSetName[]> = {
  movies: ['vod_categories', 'vod'],
  series: ['series_categories', 'series'],
  channels: ['live_categories', 'live'],
}
const CHUNK_PARALLEL = 3

export interface SourceSync {
  sourceId: string
  mode: SyncMode
  version: string
  sets: SourceSets
  ms: number
}
export interface SyncDeps {
  backend: Pick<Backend, 'readCatalogManifest' | 'readCatalogChunk' | 'readCatalogDelta'>
  cache: CatalogCache
  diag?: (event: string, detail?: string) => void
}

type Plan = { sourceId: string; started: number; manifest: CatalogManifest } & ({ ready: SourceSync } | { ready: null; fresh: SourceSets })

/** Junta os passos de um delta numa única operação equivalente (aplicada em ordem). */
export function mergeSteps(steps: Array<{ sets: Partial<Record<CatalogSetName, { upserts: CatalogRecord[]; deletes: string[] }>> }>): SetOps {
  const ops: SetOps = {}
  for (const name of SET_ORDER) {
    const upserts = new Map<string, CatalogRecord>()
    const deletes = new Set<string>()
    let touched = false
    for (const step of steps) {
      const op = step.sets[name]
      if (!op) continue
      touched = true
      for (const id of op.deletes) {
        upserts.delete(id)
        deletes.add(id)
      }
      for (const record of op.upserts) {
        deletes.delete(record.id)
        upserts.set(record.id, record)
      }
    }
    if (touched) ops[name] = { upserts: Array.from(upserts.values()), deletes: Array.from(deletes) }
  }
  return ops
}

const metaFor = (manifest: CatalogManifest, sets: SourceSets): SourceMeta => ({ schema: CACHE_SCHEMA, version: manifest.version, viewerKey: manifest.viewerKey, counts: countsOf(sets), updatedAt: Date.now() })
const isConflict = (error: unknown) => toAppError(error).code === 'source-conflict' || (error as { code?: unknown })?.code === 'source-conflict'

async function persist(deps: SyncDeps, scope: string, sourceId: string, write: () => Promise<void>) {
  try {
    await write()
  } catch (error) {
    // O cache é só otimização: some dado não gravado e o próximo início baixa de novo.
    deps.diag?.('sync:cache-write-failed', `${sourceId} ${(error as Error)?.message ?? String(error)}`.slice(0, 160))
    try {
      await deps.cache.clearScope(scope)
    } catch {
      /* sem cache utilizável */
    }
  }
}

async function plan(deps: SyncDeps, scope: string, profileId: string, sourceId: string): Promise<Plan> {
  const started = Date.now()
  const manifest = await deps.backend.readCatalogManifest(profileId, sourceId)
  let cached: Awaited<ReturnType<CatalogCache['load']>> = null
  try {
    cached = await deps.cache.load(scope, sourceId)
  } catch (error) {
    deps.diag?.('sync:cache-read-failed', `${sourceId} ${(error as Error)?.message ?? String(error)}`.slice(0, 160))
    try {
      await deps.cache.clearScope(scope)
    } catch {
      /* ignorado */
    }
  }
  // Permissões do perfil mudaram (ou esquema antigo): o que foi guardado não vale mais.
  if (cached && cached.meta.viewerKey !== manifest.viewerKey) cached = null
  if (cached && cached.meta.version === manifest.version) {
    return { sourceId, started, manifest, ready: { sourceId, mode: 'cache', version: manifest.version, sets: cached.sets, ms: Date.now() - started } }
  }
  if (cached && manifest.deltaAvailable) {
    try {
      const delta = await deps.backend.readCatalogDelta(profileId, sourceId, cached.meta.version)
      if (!delta.full && delta.to === manifest.version && delta.steps.length) {
        const ops = mergeSteps(delta.steps)
        const sets = applyOps(cached.sets, ops)
        await persist(deps, scope, sourceId, () => deps.cache.patch(scope, sourceId, metaFor(manifest, sets), ops))
        return { sourceId, started, manifest, ready: { sourceId, mode: 'delta', version: manifest.version, sets, ms: Date.now() - started } }
      }
      deps.diag?.('sync:delta-rebuild', `${sourceId} full=${delta.full} ${delta.reason ?? ''}`.trim())
    } catch (error) {
      if (isConflict(error)) throw error
      deps.diag?.('sync:delta-failed', `${sourceId} ${(error as Error)?.message ?? String(error)}`.slice(0, 160))
    }
  }
  return { sourceId, started, manifest, ready: null, fresh: emptySets() }
}

async function fetchSet(deps: SyncDeps, profileId: string, plan: Extract<Plan, { ready: null }>, set: CatalogSetName) {
  const total = plan.manifest.sets[set].chunks
  const parts: CatalogRecord[][] = new Array(total)
  let next = 0
  const worker = async () => {
    while (next < total) {
      const n = next
      next += 1
      const chunk = await deps.backend.readCatalogChunk(profileId, plan.sourceId, set, n, plan.manifest.version)
      if (chunk.version !== plan.manifest.version) throw Object.assign(new Error('source-conflict'), { code: 'source-conflict' })
      parts[n] = chunk.records
    }
  }
  await Promise.all(Array.from({ length: Math.min(CHUNK_PARALLEL, total) }, worker))
  plan.fresh[set] = parts.flat()
}

async function runOnce(deps: SyncDeps, scope: string, profileId: string, sourceIds: string[], onStage: (group: SyncGroup) => void): Promise<SourceSync[]> {
  const plans = await Promise.all(sourceIds.map((id) => plan(deps, scope, profileId, id)))
  const downloads = plans.filter((p): p is Extract<Plan, { ready: null }> => p.ready === null)
  for (const group of GROUPS) {
    onStage(group)
    for (const download of downloads) for (const set of GROUP_SETS[group]) await fetchSet(deps, profileId, download, set)
  }
  const out: SourceSync[] = []
  for (const p of plans) {
    if (p.ready) {
      out.push(p.ready)
      continue
    }
    const meta = metaFor(p.manifest, p.fresh)
    await persist(deps, scope, p.sourceId, () => deps.cache.replace(scope, p.sourceId, meta, p.fresh))
    out.push({ sourceId: p.sourceId, mode: 'full', version: p.manifest.version, sets: p.fresh, ms: Date.now() - p.started })
  }
  return out
}

/**
 * Prepara os conjuntos de todas as fontes do perfil. `onStage` é chamado quando cada grupo
 * realmente começa. Se a fonte for republicada durante a leitura, recomeça uma vez.
 */
export async function syncSources(deps: SyncDeps, scope: string, profileId: string, sourceIds: string[], onStage: (group: SyncGroup) => void = () => undefined): Promise<SourceSync[]> {
  try {
    return await runOnce(deps, scope, profileId, sourceIds, onStage)
  } catch (error) {
    if (!isConflict(error)) throw error
    deps.diag?.('sync:restart', 'fonte republicada durante a leitura')
    return runOnce(deps, scope, profileId, sourceIds, onStage)
  }
}
