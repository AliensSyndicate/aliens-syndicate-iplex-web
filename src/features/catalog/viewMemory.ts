import type { CollectionId, SortId } from './collections'

/** Estado de navegação por rota: ao voltar dos detalhes a tela reaparece como estava. Zerado a cada troca de perfil. */
export const viewMemory = new Map<string, { selected: CollectionId; sort: SortId; scrollTop: number }>()

export const resetViewMemory = () => viewMemory.clear()
