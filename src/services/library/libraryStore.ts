/**
 * Biblioteca pessoal do perfil: favoritos ("Minha lista" + canais favoritos),
 * progresso de reprodução e assistidos.
 *
 * - Leitura: Firestore (regras liberam ao Player pareado).
 * - Escrita: callable `manager` (favorite, watchProgress, markWatched) com a
 *   GERAÇÃO atual da categoria. Uma limpeza feita no Gestor incrementa a
 *   geração e o backend recusa escritas antigas (stale-generation).
 * - Visitante: nada é persistido (o backend também recusa: guest-not-persisted).
 *
 * O índice local (contentId → tipo/título/fonte) existe só para desenhar as
 * fileiras sem refazer consultas. Ao abrir um item, o catálogo é consultado de
 * novo e o backend decide se ele ainda é acessível.
 */
import type { Backend } from '../api/backend'
import { toAppError } from '../api/errors'
import type { ProgressWrite } from '../api/backend'
import type { CatalogItem, ContentKind, DeviceIdentity, Generations, Library, Profile, ProgressEntry } from '../api/types'
import { readJson, writeJson } from '../../utils/storage'
import { isAdultItem } from '../catalog/adult'

export interface IndexedItem {
  contentId: string
  itemId: string
  sourceId: string
  kind: ContentKind
  title: string
  year?: string | number
  category?: string
  /** Conteúdo adulto: Continuar e Favoritos dele só aparecem na tela Adulto. */
  isAdult?: boolean
  /** Episódio (progresso de séries). */
  episodeId?: string
  episodeLabel?: string
}

export interface LibrarySnapshot {
  revision: number
  loaded: boolean
  library: Library
}

const EMPTY: Library = { favorites: [], watched: [], progress: [] }
const indexKey = (familyId: string, profileId: string) => `iplex.library.index.v1.${familyId}.${profileId}`

export class LibraryStore {
  private snapshot: LibrarySnapshot = { revision: 0, loaded: false, library: EMPTY }
  private readonly listeners = new Set<() => void>()
  private generations: Generations
  private index: Record<string, IndexedItem>
  readonly persistent: boolean
  private readonly backend: Backend
  private readonly identity: DeviceIdentity
  private readonly profile: Profile

  constructor(backend: Backend, identity: DeviceIdentity, profile: Profile) {
    this.backend = backend
    this.identity = identity
    this.profile = profile
    this.persistent = profile.type !== 'guest'
    this.generations = { ...profile.generations }
    this.index = this.persistent ? (readJson<Record<string, IndexedItem>>(indexKey(identity.familyId, profile.id)) ?? {}) : {}
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  getSnapshot = () => this.snapshot
  get loaded(): boolean {
    return this.snapshot.loaded
  }
  private loading: Promise<void> | null = null

  /** Aguarda a primeira carga da biblioteca (no máximo `timeoutMs`); nunca rejeita. */
  async whenLoaded(timeoutMs: number): Promise<void> {
    if (this.snapshot.loaded || !this.loading) return
    await Promise.race([this.loading.catch(() => undefined), new Promise<void>((resolve) => setTimeout(resolve, timeoutMs))])
  }

  load(): Promise<void> {
    this.loading = this.read()
    return this.loading
  }

  private async read(): Promise<void> {
    if (!this.persistent) {
      this.set(EMPTY, true)
      return
    }
    const [generations, library] = await Promise.all([
      this.backend.readGenerations(this.identity, this.profile.id).catch(() => null),
      this.backend.readLibrary(this.identity, this.profile.id),
    ])
    if (generations) this.generations = generations
    const g = this.generations
    // Entradas de gerações anteriores foram limpas no Gestor e não contam mais.
    this.set(
      {
        favorites: library.favorites.filter((e) => e.generation === g.favorites),
        watched: library.watched.filter((e) => e.generation === g.watched),
        progress: library.progress.filter((e) => e.generation === g.progress),
      },
      true,
    )
  }

  indexed(contentId: string): IndexedItem | null {
    return this.index[contentId] ?? null
  }

  remember(item: IndexedItem) {
    if (!this.persistent) return
    this.index[item.contentId] = item
    writeJson(indexKey(this.identity.familyId, this.profile.id), this.index)
  }

  isFavorite(contentId: string): boolean {
    return this.snapshot.library.favorites.some((f) => f.contentId === contentId)
  }

  progressFor(contentId: string): ProgressEntry | null {
    return this.snapshot.library.progress.find((p) => p.contentId === contentId) ?? null
  }

  isWatched(contentId: string): boolean {
    return this.snapshot.library.watched.some((w) => w.contentId === contentId)
  }

  async setFavorite(item: CatalogItem, favorite: boolean): Promise<void> {
    // Conteúdo adulto nunca é guardado (favoritos, lista, recentes, continuar assistindo).
    if (!this.persistent || (favorite && isAdultItem(item))) return
    const previous = this.snapshot.library
    this.remember(indexFromItem(item))
    const favorites = favorite
      ? [{ contentId: item.id, title: item.title, generation: this.generations.favorites, updatedAt: Date.now() }, ...previous.favorites.filter((f) => f.contentId !== item.id)]
      : previous.favorites.filter((f) => f.contentId !== item.id)
    this.set({ ...previous, favorites }, true)
    try {
      await this.backend.setFavorite({ profileId: this.profile.id, contentId: item.id, title: item.title, generation: this.generations.favorites, remove: !favorite })
    } catch (error) {
      this.set(previous, true)
      const appError = toAppError(error)
      if (appError.code === 'stale-generation') await this.load()
      throw appError
    }
  }

  /** Grava progresso autorizado (o chamador controla a frequência). */
  async saveProgress(contentId: string, positionSec: number, durationSec: number, meta: IndexedItem, playback?: ProgressWrite['session']): Promise<void> {
    if (!this.persistent || !(durationSec > 0) || positionSec < 0 || isAdultItem(meta)) return
    const position = Math.min(positionSec, durationSec)
    this.remember(meta)
    const entry: ProgressEntry = { contentId, position, duration: durationSec, generation: this.generations.progress, updatedAt: Date.now() }
    const library = this.snapshot.library
    this.set({ ...library, progress: [entry, ...library.progress.filter((p) => p.contentId !== contentId)] }, true)
    try {
      const result = await this.backend.saveProgress({
        profileId: this.profile.id,
        contentId,
        positionSec: position,
        durationSec,
        generation: this.generations.progress,
        watchedGeneration: this.generations.watched,
        ...(playback ? { session: playback } : {}),
      })
      // O backend descartou o evento (atrasado/inicialização/retomada não aplicada): o progresso salvo vale.
      if (result && result.ignored) this.set(library, true)
    } catch (error) {
      const appError = toAppError(error)
      if (appError.code === 'stale-generation') await this.load()
      throw appError
    }
  }

  private set(library: Library, loaded: boolean) {
    this.snapshot = { revision: this.snapshot.revision + 1, loaded, library }
    this.listeners.forEach((listener) => listener())
  }
}

export function indexFromItem(item: CatalogItem, episode?: { id: string; label: string; contentId: string }): IndexedItem {
  return {
    contentId: episode?.contentId ?? item.id,
    itemId: item.id,
    sourceId: item.sourceId,
    kind: item.kind,
    title: item.title,
    ...(item.year !== undefined ? { year: item.year } : {}),
    ...(item.category ? { category: item.category } : {}),
    ...(item.isAdult || isAdultItem(item) ? { isAdult: true } : {}),
    ...(episode ? { episodeId: episode.id, episodeLabel: episode.label } : {}),
  }
}
