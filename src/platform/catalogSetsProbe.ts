/**
 * Verificação, na TV, dos seis conjuntos do catálogo servidos pelo Control (somente leitura).
 * Roda dentro do roteiro `?diag=1&selftest=1`: baixa manifesto e blocos de cada fonte do perfil
 * ativo pelas mesmas callables que o app usará, mede tempo e tamanho, confere os vínculos
 * item → categoria (ids originais) e o comportamento do delta. Nada é gravado.
 */
import type { Backend } from '../services/api/backend'
import type { CatalogRecord, CatalogSetName } from '../services/api/types'
import { getCatalogCache } from '../services/catalog/catalogCache'
import { syncSources } from '../services/catalog/catalogSync'
import { readJson } from '../utils/storage'

const SETS: CatalogSetName[] = ['live_categories', 'live', 'vod_categories', 'vod', 'series_categories', 'series']
type Diag = (event: string, detail?: string) => void

export async function probeCatalogSets(backend: Backend | undefined, diag: Diag): Promise<void> {
  if (!backend) return diag('st:sets', 'sem backend (diagnóstico indisponível)')
  try {
    const hint = readJson<{ profileId?: string }>('iplex.lastProfile.v1')
    const profileId = hint?.profileId
    if (!profileId) return diag('st:sets', 'sem perfil lembrado')
    const spaces = await backend.listSpaces(profileId)
    diag('st:sets', `fontes=${spaces.length}`)
    for (const space of spaces) {
      const t0 = Date.now()
      const manifest = await backend.readCatalogManifest(profileId, space.sourceId)
      diag('st:sets:manifest', `versao=${manifest.version.slice(0, 10)} anterior=${manifest.previousVersion ? manifest.previousVersion.slice(0, 10) : 'nenhuma'} delta=${manifest.deltaAvailable} chunks=${SETS.map((s) => `${s}:${manifest.sets[s].chunks}`).join(',')} ${Date.now() - t0}ms`)
      const data = {} as Record<CatalogSetName, CatalogRecord[]>
      for (const set of SETS) {
        const start = Date.now()
        const rows: CatalogRecord[] = []
        let bytes = 0
        for (let n = 0; n < manifest.sets[set].chunks; n += 1) {
          const chunk = await backend.readCatalogChunk(profileId, space.sourceId, set, n, manifest.version)
          rows.push(...chunk.records)
          bytes += JSON.stringify(chunk.records).length
        }
        data[set] = rows
        diag(`st:sets:${set}`, `registros=${rows.length} blocos=${manifest.sets[set].chunks} bytes=${bytes} ${Date.now() - start}ms`)
      }
      // Vínculos: todo item aponta para uma categoria do mesmo tipo pelo id original.
      const link = (items: CatalogRecord[], cats: CatalogRecord[]) => {
        const ids = new Set(cats.map((c) => c.id))
        return `${items.filter((i) => !ids.has(String(i.categoryId))).length} órfãos de ${items.length}`
      }
      diag('st:sets:links', `live=${link(data.live, data.live_categories)} vod=${link(data.vod, data.vod_categories)} series=${link(data.series, data.series_categories)}`)
      const adultNames = [...data.live_categories, ...data.vod_categories, ...data.series_categories].map((c) => String(c.name)).filter((n) => /adult|18|porn|xxx|hentai/i.test(n))
      diag('st:sets:adult', `categorias adultas visíveis a este perfil: ${adultNames.length} ${adultNames.slice(0, 4).join('|')}`)
      const ids = new Set<string>()
      const dup = [...data.live, ...data.vod, ...data.series].filter((i) => (ids.has(i.id) ? true : (ids.add(i.id), false))).length
      diag('st:sets:ids', `ids únicos=${ids.size} duplicados=${dup}`)
      const same = await backend.readCatalogDelta(profileId, space.sourceId, manifest.version)
      diag('st:sets:delta-mesma-versao', `full=${same.full} passos=${same.steps.length}`)
      const unknown = await backend.readCatalogDelta(profileId, space.sourceId, 'a'.repeat(64))
      diag('st:sets:delta-desconhecida', `full=${unknown.full} motivo=${unknown.reason ?? '-'}`)
      if (manifest.previousVersion) {
        const step = await backend.readCatalogDelta(profileId, space.sourceId, manifest.previousVersion)
        const counts = step.steps.map((s) => SETS.map((n) => `${n}:+${s.sets[n]?.upserts.length ?? 0}/-${s.sets[n]?.deletes.length ?? 0}`).join(' '))
        diag('st:sets:delta-anterior', `full=${step.full} ${counts.join(' ; ')}`)
      }
    }
  } catch (error) {
    const e = error as { code?: string; message?: string }
    diag('st:sets:erro', `${e?.code ?? ''} ${e?.message ?? String(error)}`)
  }
}

/**
 * Cache local na TV (IndexedDB real): sincronização completa → segunda abertura pelo cache →
 * diferença aplicada numa transação → integridade → limpeza. Usa um escopo próprio
 * (`selftest:probe`), nunca o cache do app, e apaga tudo no final.
 */
export async function probeCatalogCache(backend: Backend | undefined, diag: Diag): Promise<void> {
  if (!backend) return
  const scope = 'selftest:probe'
  const cache = getCatalogCache()
  try {
    const hint = readJson<{ profileId?: string }>('iplex.lastProfile.v1')
    if (!hint?.profileId) return
    const spaces = await backend.listSpaces(hint.profileId)
    const ids = spaces.map((s) => s.sourceId)
    diag('st:cache', `persistente=${cache.persistent} fontes=${ids.length}`)
    await cache.clearScope(scope)
    const stages: string[] = []
    const first = await syncSources({ backend, cache, diag }, scope, hint.profileId, ids, (g) => stages.push(g))
    diag('st:cache:1a-abertura', `modo=${first.map((r) => r.mode).join(',')} ${first.map((r) => `${r.ms}ms`).join(',')} etapas=${stages.join('>')}`)
    const second = await syncSources({ backend, cache, diag }, scope, hint.profileId, ids)
    diag('st:cache:2a-abertura', `modo=${second.map((r) => r.mode).join(',')} ${second.map((r) => `${r.ms}ms`).join(',')}`)
    const a = first[0]!, b = second[0]!
    const same = (['live', 'vod', 'series'] as CatalogSetName[]).map((n) => `${n}:${a.sets[n].length}=${b.sets[n].length}`).join(' ')
    diag('st:cache:integridade', `${same} iguais=${a.sets.vod.length === b.sets.vod.length && a.sets.live.length === b.sets.live.length && a.sets.series.length === b.sets.series.length}`)
    // Diferença sintética (50 alterados, 40 removidos, 15 novos) numa transação, como um delta real.
    const t0 = Date.now()
    const vod = b.sets.vod
    const ops = {
      vod: {
        upserts: [...vod.slice(200, 250).map((r) => ({ ...r, title: `${String(r.title)} (rev)` })), ...Array.from({ length: 15 }, (_, i) => ({ ...vod[0]!, id: `novo-${i}` }))],
        deletes: vod.slice(100, 140).map((r) => r.id),
      },
    }
    const meta = { ...(await cache.load(scope, ids[0]!))!.meta, version: 'sintetica', counts: { ...(await cache.load(scope, ids[0]!))!.meta.counts, vod: vod.length - 40 + 15 } }
    await cache.patch(scope, ids[0]!, meta, ops)
    const after = await cache.load(scope, ids[0]!)
    diag('st:cache:delta-local', `${Date.now() - t0}ms vod=${vod.length}->${after?.sets.vod.length ?? 'corrompido'} esperado=${vod.length - 25} versao=${after?.meta.version}`)
    // Dado adulterado: contagem divergente deve ser tratada como corrompido (sem exceção).
    await cache.patch(scope, ids[0]!, { ...meta, counts: { ...meta.counts, vod: 1 } }, {})
    diag('st:cache:corrompido', `load=${(await cache.load(scope, ids[0]!)) === null ? 'null (refaz)' : 'aceitou!'}`)
  } catch (error) {
    const e = error as { code?: string; message?: string }
    diag('st:cache:erro', `${e?.code ?? ''} ${e?.message ?? String(error)}`.slice(0, 200))
  } finally {
    try {
      await cache.clearScope(scope)
    } catch {
      /* limpeza best-effort */
    }
  }
}
