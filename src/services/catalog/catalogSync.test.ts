import { describe, expect, it, vi } from 'vitest'
import { AppError } from '../api/errors'
import type { CatalogChunk, CatalogDelta, CatalogManifest, CatalogRecord, CatalogSetName } from '../api/types'
import { applyOps, createMemoryCache, emptySets, SET_ORDER, type SourceSets } from './catalogCache'
import { mergeSteps, syncSources } from './catalogSync'

const rec = (id: string, extra: Record<string, unknown> = {}): CatalogRecord => ({ id, title: id, ...extra })
const world = (movies: string[], categories = ['1']): SourceSets => ({
  ...emptySets(),
  vod_categories: categories.map((c) => rec(c, { name: `Cat ${c}`, kind: 'movie' })),
  vod: movies.map((m) => rec(m, { categoryId: '1', kind: 'movie' })),
  live: [rec('c1', { kind: 'channel', categoryId: '9' })],
  live_categories: [rec('9', { name: 'Notícias', kind: 'channel' })],
})

/** Backend de teste: servidor com versões encadeadas e blocos de 2 registros. */
function fakeServer(initial: SourceSets) {
  const versions = new Map<string, SourceSets>()
  let current = 'v1'
  let previous: string | null = null
  versions.set('v1', initial)
  const deltas = new Map<string, Array<{ version: string; sets: Partial<Record<CatalogSetName, { upserts: CatalogRecord[]; deletes: string[] }>> }>>()
  let viewerKey = 'viewer-A'
  const manifest = (): CatalogManifest => ({
    version: current,
    previousVersion: previous,
    viewerKey,
    deltaAvailable: !!previous && deltas.has(`${previous}>${current}`),
    sets: Object.fromEntries(SET_ORDER.map((n) => [n, { chunks: Math.max(1, Math.ceil(versions.get(current)![n].length / 2)), hash: n }])) as CatalogManifest['sets'],
  })
  const backend = {
    readCatalogManifest: vi.fn(async () => manifest()),
    readCatalogChunk: vi.fn(async (_p: string, _s: string, set: CatalogSetName, n: number, version: string): Promise<CatalogChunk> => {
      if (version !== current) throw new AppError('iptv-unavailable', 'source-conflict')
      const rows = versions.get(current)![set]
      return { version: current, set, n, chunks: Math.ceil(rows.length / 2), records: rows.slice(n * 2, n * 2 + 2) }
    }),
    readCatalogDelta: vi.fn(async (_p: string, _s: string, from: string): Promise<CatalogDelta> => {
      const steps = deltas.get(`${from}>${current}`)
      return steps ? { from, to: current, full: false, steps } : { from, to: current, full: true, reason: 'history-unavailable', steps: [] }
    }),
  }
  return {
    backend,
    publish(next: SourceSets, version: string, steps: Array<{ version: string; sets: Partial<Record<CatalogSetName, { upserts: CatalogRecord[]; deletes: string[] }>> }> | null) {
      previous = current
      current = version
      versions.set(version, next)
      if (steps) deltas.set(`${previous}>${version}`, steps)
    },
    setViewer: (key: string) => {
      viewerKey = key
    },
  }
}
const ids = (rows: CatalogRecord[]) => rows.map((r) => r.id).sort()

describe('syncSources', () => {
  it('primeira abertura baixa os seis conjuntos, na ordem filmes → séries → canais, e grava o cache', async () => {
    const server = fakeServer(world(['a', 'b', 'c']))
    const cache = createMemoryCache()
    const stages: string[] = []
    const [result] = await syncSources({ backend: server.backend, cache }, 'f:p', 'p', ['s1'], (g) => stages.push(g))
    expect(result!.mode).toBe('full')
    expect(ids(result!.sets.vod)).toEqual(['a', 'b', 'c'])
    expect(stages).toEqual(['movies', 'series', 'channels'])
    expect((await cache.load('f:p', 's1'))!.meta.version).toBe('v1')
  })

  it('segunda abertura na mesma versão usa o cache sem baixar blocos', async () => {
    const server = fakeServer(world(['a', 'b', 'c']))
    const cache = createMemoryCache()
    await syncSources({ backend: server.backend, cache }, 'f:p', 'p', ['s1'])
    server.backend.readCatalogChunk.mockClear()
    const [again] = await syncSources({ backend: server.backend, cache }, 'f:p', 'p', ['s1'])
    expect(again!.mode).toBe('cache')
    expect(server.backend.readCatalogChunk).not.toHaveBeenCalled()
    expect(ids(again!.sets.vod)).toEqual(['a', 'b', 'c'])
  })

  it('nova versão: aplica só inclusão, alteração, troca de categoria e exclusão (delta)', async () => {
    const server = fakeServer(world(['a', 'b', 'c']))
    const cache = createMemoryCache()
    await syncSources({ backend: server.backend, cache }, 'f:p', 'p', ['s1'])
    const next = world(['a', 'b2', 'd'], ['1', '2'])
    next.vod[0] = rec('a', { categoryId: '2', kind: 'movie' })
    server.publish(next, 'v2', [
      { version: 'v2', sets: { vod: { upserts: [rec('a', { categoryId: '2', kind: 'movie' }), rec('b2', { categoryId: '1', kind: 'movie' }), rec('d', { categoryId: '1', kind: 'movie' })], deletes: ['b', 'c'] }, vod_categories: { upserts: [rec('2', { name: 'Cat 2', kind: 'movie' })], deletes: [] } } },
    ])
    server.backend.readCatalogChunk.mockClear()
    const [result] = await syncSources({ backend: server.backend, cache }, 'f:p', 'p', ['s1'])
    expect(result!.mode).toBe('delta')
    expect(server.backend.readCatalogChunk).not.toHaveBeenCalled()
    expect(ids(result!.sets.vod)).toEqual(['a', 'b2', 'd'])
    expect(result!.sets.vod.find((r) => r.id === 'a')!.categoryId).toBe('2')
    expect(ids(result!.sets.vod_categories)).toEqual(['1', '2'])
    // O cache persistido reflete exatamente o resultado (próxima abertura é "cache").
    const stored = (await cache.load('f:p', 's1'))!
    expect(stored.meta.version).toBe('v2')
    expect(ids(stored.sets.vod)).toEqual(['a', 'b2', 'd'])
  })

  it('TV desligada por várias versões: os passos são combinados na ordem', () => {
    const ops = mergeSteps([
      { sets: { vod: { upserts: [rec('x', { v: 1 })], deletes: ['old'] } } },
      { sets: { vod: { upserts: [rec('y')], deletes: ['x'] } } },
      { sets: { vod: { upserts: [rec('old', { back: true })], deletes: [] } } },
    ])
    expect(ids(ops.vod!.upserts)).toEqual(['old', 'y'])
    expect(ops.vod!.deletes).toEqual(['x'])
    const applied = applyOps({ ...emptySets(), vod: [rec('old'), rec('keep')] }, ops)
    expect(ids(applied.vod)).toEqual(['keep', 'old', 'y'])
  })

  it('sem histórico confiável: reconstrói tudo (nunca um estado parcial)', async () => {
    const server = fakeServer(world(['a']))
    const cache = createMemoryCache()
    await syncSources({ backend: server.backend, cache }, 'f:p', 'p', ['s1'])
    server.publish(world(['a', 'z']), 'v2', null)
    const [result] = await syncSources({ backend: server.backend, cache }, 'f:p', 'p', ['s1'])
    expect(result!.mode).toBe('full')
    expect(ids(result!.sets.vod)).toEqual(['a', 'z'])
    expect((await cache.load('f:p', 's1'))!.meta.version).toBe('v2')
  })

  it('permissões do perfil mudaram (viewerKey): o cache antigo é descartado', async () => {
    const server = fakeServer(world(['a', 'adulto']))
    const cache = createMemoryCache()
    await syncSources({ backend: server.backend, cache }, 'f:p', 'p', ['s1'])
    server.setViewer('viewer-B')
    const [result] = await syncSources({ backend: server.backend, cache }, 'f:p', 'p', ['s1'])
    expect(result!.mode).toBe('full')
  })

  it('cache ilegível ou corrompido é ignorado e substituído', async () => {
    const server = fakeServer(world(['a']))
    const good = createMemoryCache()
    const broken = { ...good, load: vi.fn(async () => { throw new Error('QuotaExceededError') }) }
    const [result] = await syncSources({ backend: server.backend, cache: broken }, 'f:p', 'p', ['s1'])
    expect(result!.mode).toBe('full')
    expect(ids(result!.sets.vod)).toEqual(['a'])
  })

  it('falha ao gravar o cache não impede o uso dos dados', async () => {
    const server = fakeServer(world(['a']))
    const cache = { ...createMemoryCache(), replace: vi.fn(async () => { throw new Error('disk full') }) }
    const [result] = await syncSources({ backend: server.backend, cache }, 'f:p', 'p', ['s1'])
    expect(ids(result!.sets.vod)).toEqual(['a'])
  })

  it('fonte republicada durante a leitura recomeça uma vez e entrega a versão nova', async () => {
    const server = fakeServer(world(['a', 'b']))
    const cache = createMemoryCache()
    let first = true
    const original = server.backend.readCatalogChunk.getMockImplementation()!
    server.backend.readCatalogChunk.mockImplementation(async (...args) => {
      if (first) {
        first = false
        server.publish(world(['a', 'b', 'c']), 'v2', null)
      }
      return original(...args)
    })
    const [result] = await syncSources({ backend: server.backend, cache }, 'f:p', 'p', ['s1'])
    expect(result!.version).toBe('v2')
    expect(ids(result!.sets.vod)).toEqual(['a', 'b', 'c'])
  })

  it('perfis diferentes não compartilham cache', async () => {
    const server = fakeServer(world(['a']))
    const cache = createMemoryCache()
    await syncSources({ backend: server.backend, cache }, 'f:kids', 'kids', ['s1'])
    const [other] = await syncSources({ backend: server.backend, cache }, 'f:admin', 'admin', ['s1'])
    expect(other!.mode).toBe('full')
    await cache.clearScope('f:kids')
    expect(await cache.load('f:kids', 's1')).toBeNull()
    expect(await cache.load('f:admin', 's1')).not.toBeNull()
  })
})
