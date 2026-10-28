/**
 * DADOS DE DEMONSTRAÇÃO — somente `vite dev` com VITE_IPLEX_USE_MOCKS=true.
 * Nunca entra no build de produção (scripts/verify-build.mjs confere).
 *
 * - Não contém credenciais nem simula autorizações reais: tudo é memória local.
 * - Filmes: curtas abertos da Blender Foundation (licença Creative Commons),
 *   com streams públicos de teste. Canais e séries são fictícios e rotulados.
 * - Cenários pela URL: ?mock=unpaired | subscription | no-iptv | iptv-down |
 *   single | kids-last | session-limit | guest-only
 */
import type { Backend, CatalogQuery } from '../../services/api/backend'
import { AppError } from '../../services/api/errors'
import type { CatalogItem, Lease, Library, Profile, SeriesDetails, Space } from '../../services/api/types'
import { delay } from '../../utils/async'

type Scenario = 'default' | 'unpaired' | 'subscription' | 'no-iptv' | 'iptv-down' | 'single' | 'kids-last' | 'session-limit' | 'guest-only' | 'remote' | 'many'

const SCENARIO_KEY = 'iplex.mock.scenario'
function scenario(): Scenario {
  const fromUrl = new URLSearchParams(window.location.search).get('mock') as Scenario | null
  if (fromUrl) {
    sessionStorage.setItem(SCENARIO_KEY, fromUrl)
    return fromUrl
  }
  return (sessionStorage.getItem(SCENARIO_KEY) as Scenario | null) ?? 'default'
}

const SOURCE = 'demo-source'
const VERSION = 'demo-v1'
const STREAMS = {
  bbb: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
  sintel: 'https://bitdash-a.akamaihd.net/content/sintel/hls/playlist.m3u8',
  tears: 'https://demo.unified-streaming.com/k8s/features/stable/video/tears-of-steel/tears-of-steel.ism/.m3u8',
  bipbop: 'https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/master.m3u8',
}

const item = (id: string, kind: CatalogItem['kind'], title: string, category: string, extra: Partial<CatalogItem> = {}): CatalogItem => ({
  id,
  sourceId: SOURCE,
  kind,
  title,
  category,
  categoryId: category.toLowerCase().replace(/\W+/g, '-'),
  providerRef: id,
  version: VERSION,
  ...extra,
})

const ITEMS: CatalogItem[] = [
  item('m-bbb', 'movie', 'Big Buck Bunny (2008)', 'Animação', { year: 2008, ageRating: 'L' }),
  item('m-sintel', 'movie', 'Sintel (2010)', 'Animação', { year: 2010 }),
  item('m-tears', 'movie', 'Tears of Steel (2012)', 'Ficção científica', { year: 2012 }),
  item('m-elephants', 'movie', 'Elephants Dream (2006)', 'Ficção científica', { year: 2006 }),
  item('m-spring', 'movie', 'Spring (2019)', 'Animação', { year: 2019, ageRating: 'L' }),
  item('m-cosmos', 'movie', 'Cosmos Laundromat (2015)', 'Curtas', { year: 2015 }),
  item('m-agent', 'movie', 'Agent 327: Operation Barbershop (2017)', 'Curtas', { year: 2017 }),
  item('s-demo', 'series', '[Demo] Série de Demonstração', 'Séries demo', { plot: 'Série fictícia usada apenas para testar temporadas e episódios.' }),
  item('s-kids', 'series', '[Demo] Desenhos de Demonstração', 'Infantil', { ageRating: 'L' }),
  item('c-1', 'channel', '[Demo] Canal Notícias', 'Notícias', { epgId: 'demo.news' }),
  item('c-2', 'channel', '[Demo] Canal Esportes', 'Esportes', { epgId: 'demo.sports' }),
  item('c-3', 'channel', '[Demo] Canal Filmes', 'Filmes', { epgId: 'demo.movies' }),
  item('c-4', 'channel', '[Demo] Canal Infantil', 'Infantil', { epgId: 'demo.kids', ageRating: 'L' }),
  item('c-5', 'channel', '[Demo] Canal Documentários', 'Documentários'),
]
const STREAM_OF: Record<string, string> = {
  'm-bbb': STREAMS.bbb,
  'm-sintel': STREAMS.sintel,
  'm-tears': STREAMS.tears,
  'c-1': STREAMS.bipbop,
  'c-2': STREAMS.bbb,
  'c-3': STREAMS.sintel,
  'c-4': STREAMS.bbb,
}

const SERIES: Record<string, SeriesDetails> = {
  's-demo': {
    seriesId: 's-demo',
    seasons: [1, 2].map((season) => ({
      seasonNumber: season,
      name: `Temporada ${season}`,
      episodes: [1, 2, 3].map((n) => ({ id: `${season}0${n}`, title: `Episódio de demonstração ${n}`, season, episodeNum: n, duration: '00:10:00', plot: 'Episódio fictício (dados de demonstração).' })),
    })),
  },
  's-kids': {
    seriesId: 's-kids',
    seasons: [{ seasonNumber: 1, name: 'Temporada 1', episodes: [{ id: '901', title: 'Primeiro desenho', season: 1, episodeNum: 1 }] }],
  },
}

/** Cenário 'many': catálogo extenso (teste de desempenho e de categorias do fornecedor). */
const CATEGORIES = ['Ação', 'Comédia', 'Drama', 'Terror', 'Romance', 'Documentário', 'Aventura', 'Fantasia', 'Guerra', 'Suspense', 'Animação', 'Adulto +18']
const MANY: CatalogItem[] = Array.from({ length: 900 }, (_, n) =>
  item(`m-many-${n}`, n % 4 === 3 ? 'series' : 'movie', `Título ${String(n).padStart(3, '0')} ${CATEGORIES[n % CATEGORIES.length]}`, CATEGORIES[n % CATEGORIES.length]!, { year: 1990 + (n % 35), ageRating: n % CATEGORIES.length === 11 ? '18' : 'L' }),
)

const kidsVisible = (i: CatalogItem) => i.ageRating === 'L' || /infantil/i.test(i.category)

// SHA-256 do PIN de demonstração "1234" (nunca em texto puro).
const DEMO_PIN_SHA256 = '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4'
async function sha256(text: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

export function createMockBackend(): Backend {
  const mode = scenario()
  let paired = mode !== 'unpaired' && sessionStorage.getItem('iplex.mock.unpaired') !== '1'
  let pairingStarted = 0
  let lease: Lease | null = null
  const library: Library = { favorites: [], wishlist: [], watched: [], progress: [] }
  const generations = { favorites: 0, watched: 0, progress: 0 }
  const profiles: Profile[] =
    mode === 'single'
      ? [{ id: 'admin', name: 'Demonstração', type: 'admin', generations, permissionsVersion: 0 }]
      : mode === 'guest-only'
        ? [{ id: 'guest', name: 'Visitante', type: 'guest', generations, permissionsVersion: 0 }]
        : [
            { id: 'admin', name: 'Demonstração', type: 'admin', generations, permissionsVersion: 0 },
            { id: 'p-kids', name: 'Infantil Demo', type: 'kids', generations, permissionsVersion: 0 },
            { id: 'guest', name: 'Visitante', type: 'guest', generations, permissionsVersion: 0 },
          ]
  if (mode === 'kids-last') localStorage.setItem('iplex.lastProfile.v1', JSON.stringify({ familyId: 'demo-family', profileId: 'p-kids' }))

  const viewer = () => profiles.find((p) => p.id === lease?.profileId) ?? null
  const requireLease = () => {
    if (!lease) throw new AppError('session-expired')
  }
  const visible = () => (mode === 'many' ? [...ITEMS, ...MANY] : ITEMS).filter((i) => (viewer()?.type === 'kids' ? kidsVisible(i) : true))

  return {
    label: 'mock',
    async restoreDevice() {
      await delay(300)
      return paired ? { deviceId: 'demo-device', familyId: 'demo-family' } : null
    },
    async beginPairing() {
      await delay(400)
      pairingStarted = Date.now()
      return { token: 'a'.repeat(64), code: '123456', formattedCode: '123-456', deviceId: 'demo-device', expiresAt: Date.now() + 5 * 60_000 }
    },
    async pollPairing() {
      await delay(200)
      // Demonstração: confirma sozinho após ~8 s (simula o Gestor).
      if (Date.now() - pairingStarted > 8000) {
        paired = true
        sessionStorage.removeItem('iplex.mock.unpaired')
        return { status: 'linked', identity: { deviceId: 'demo-device', familyId: 'demo-family' } }
      }
      return { status: 'pending' }
    },
    async forgetDevice() {
      paired = false
      sessionStorage.setItem('iplex.mock.unpaired', '1')
    },
    async getIdToken() {
      return null
    },
    async getAppCheckToken() {
      return null
    },
    async listProfiles() {
      await delay(250)
      return profiles
    },
    accountIdentity() {
      // Conta de demonstração, sem foto (avatar padrão).
      return { name: 'Conta Demonstração', photoUrl: null }
    },
    async verifyAdultPin(_profileId, pin) {
      await delay(300)
      return { verified: (await sha256(pin)) === DEMO_PIN_SHA256, required: true }
    },
    async verifyProfilePin(_profileId, pin) {
      await delay(300)
      return { verified: (await sha256(pin)) === DEMO_PIN_SHA256, required: true }
    },
    async acquireSession(profileId) {
      await delay(250)
      if (mode === 'subscription') throw new AppError('subscription-inactive', 'subscription-required')
      if (mode === 'session-limit') throw new AppError('session-limit', 'session-limit', { devices: ['TV da sala', 'TV do quarto', 'Celular'] })
      lease = { id: `lease-${Date.now()}`, profileId, expiresAt: Date.now() + 90_000 }
      return lease
    },
    async reportPlayback() {},

    async heartbeat() {
      requireLease()
      return { playRequest: null }
    },
    // ?mock=remote: um pedido de reprodução fictício do Control 8 s depois de abrir.
    watchPlayRequests(_identity, onPending) {
      if (mode !== 'remote') return () => undefined
      const id = setTimeout(() => onPending({ id: 'demo-request', expiresAt: Date.now() + 60_000, requesterName: '[Demo] Ana', title: 'Sintel (2010)' }), 8_000)
      return () => clearTimeout(id)
    },
    async claimPlayRequest(id) {
      await delay(200)
      const found = ITEMS.find((i) => i.id === 'm-sintel')!
      return { id, status: 'delivered', request: { sourceId: found.sourceId, itemId: found.id, episodeId: null, episodeLabel: null, kind: found.kind, title: found.title, requesterName: '[Demo] Ana' } }
    },
    async updatePlayRequest(id, status, errorCode) {
      console.info(`[mock] play request ${id}: ${status}${errorCode ? ` (${errorCode})` : ''}`)
    },
    async releaseSession(id) {
      if (lease?.id === id) lease = null
    },
    async listSpaces(): Promise<Space[]> {
      await delay(250)
      if (mode === 'no-iptv') return []
      if (mode === 'iptv-down') throw new AppError('iptv-unavailable', 'provider-unavailable')
      const kinds = (['channel', 'movie', 'series'] as const).filter((k) => visible().some((i) => i.kind === k))
      return [{ sourceId: SOURCE, name: 'Fonte de demonstração', kinds: [...kinds] }]
    },
    // Seis conjuntos: o demonstrativo não os tem (o app cai no formato paginado).
    async readCatalogManifest() {
      throw new AppError('backend-outdated', 'catalog-sets-unavailable')
    },
    async readCatalogChunk() {
      throw new AppError('backend-outdated', 'catalog-sets-unavailable')
    },
    async readCatalogDelta() {
      throw new AppError('backend-outdated', 'catalog-sets-unavailable')
    },

    async readCatalog(_profileId, q: CatalogQuery) {
      requireLease()
      await delay(300)
      const needle = (q.search ?? '').toLowerCase()
      const all = visible()
        .filter((i) => !needle || i.title.toLowerCase().includes(needle))
        .sort((a, b) => a.title.localeCompare(b.title))
      const offset = q.cursor ?? 0
      const categories = Array.from(new Map(all.map((i) => [`${i.kind}:${i.categoryId}`, { id: i.categoryId!, name: i.category, kind: i.kind }])).values())
      return { version: VERSION, items: all.slice(offset, offset + 30), categories, cursor: offset + 30, hasMore: offset + 30 < all.length }
    },
    async readSeries(_p, _s, seriesId) {
      requireLease()
      await delay(250)
      if (!visible().some((i) => i.providerRef === seriesId)) throw new AppError('content-unavailable', 'not-found')
      return SERIES[seriesId] ?? null
    },
    async readEpg(_sourceId, channelId) {
      await delay(200)
      const start = new Date()
      start.setMinutes(0, 0, 0)
      const base = start.getTime()
      return {
        supported: true,
        programmes: [0, 1, 2].map((i) => ({ channelId, title: `[Demo] Programa ${i + 1}`, startAt: base + i * 3600_000, endAt: base + (i + 1) * 3600_000, description: 'Programação fictícia.' })),
      }
    },
    async resolveStream(_p, { itemId }) {
      requireLease()
      await delay(400)
      const found = visible().find((i) => i.id === itemId)
      if (!found) throw new AppError('content-unavailable', 'not-found')
      const url = STREAM_OF[itemId] ?? (found.kind === 'series' ? STREAMS.tears : null)
      if (!url) throw new AppError('iptv-unavailable', 'source-authorization-required')
      return { url, sourceId: SOURCE, validatedAt: Date.now() }
    },
    async readGenerations() {
      return generations
    },
    async readLibrary(_identity, profileId) {
      await delay(200)
      return profiles.find((p) => p.id === profileId)?.type === 'guest' ? { favorites: [], wishlist: [], watched: [], progress: [] } : library
    },
    async setFavorite({ contentId, title, remove }) {
      if (viewer()?.type === 'guest') throw new AppError('not-supported', 'guest-not-persisted')
      library.favorites = library.favorites.filter((f) => f.contentId !== contentId)
      if (!remove) library.favorites.unshift({ contentId, title, generation: 0, updatedAt: Date.now() })
    },
    async setWishlist({ contentId, title, remove }) {
      if (viewer()?.type === 'guest') throw new AppError('not-supported', 'guest-not-persisted')
      library.wishlist = (library.wishlist ?? []).filter((f) => f.contentId !== contentId)
      if (!remove) library.wishlist.unshift({ contentId, title, generation: generations.favorites, updatedAt: Date.now() })
    },
    async saveProgress({ contentId, positionSec, durationSec }) {
      if (viewer()?.type === 'guest') throw new AppError('not-supported', 'guest-not-persisted')
      library.progress = [{ contentId, position: positionSec, duration: durationSec, generation: 0, updatedAt: Date.now() }, ...library.progress.filter((p) => p.contentId !== contentId)]
      if (positionSec / durationSec >= 0.9 && !library.watched.some((w) => w.contentId === contentId)) {
        library.watched.unshift({ contentId, title: null, generation: 0, updatedAt: Date.now() })
      }
    },
    async markWatched({ contentId, title }) {
      library.watched.unshift({ contentId, title, generation: 0, updatedAt: Date.now() })
    },
  }
}
