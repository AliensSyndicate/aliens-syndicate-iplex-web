import { useSearchParams } from 'react-router-dom'
import { CatalogScreen } from './CatalogScreen'
import { parseCollection, parseKinds, SCOPE_KINDS, type CollectionId, type PersonalCollection } from './collections'

const PERSONAL: PersonalCollection[] = ['continue', 'favorites', 'wishlist', 'watched', 'releases']

/**
 * /catalogo?c=<coleção>&k=<tipos>. Coleções do Meu iPlex ("Ver tudo") abrem a tela Catálogo daquela fileira,
 * separada por tipo (Tudo, Filmes, Séries, Ao vivo); as demais mantêm o menu de categorias de Filmes e Séries.
 */
export default function CatalogRoute() {
  const [params] = useSearchParams()
  const collection = parseCollection(params.get('c'))
  const scope = PERSONAL.find((c) => c === collection)
  // Ver tudo: o menu lateral sempre traz todos os tipos da seção; `k` só escolhe onde abrir.
  const kinds = scope ? SCOPE_KINDS[scope] : parseKinds(params.get('k'), ['movie', 'series'])
  const initialKind = parseKinds(params.get('k'), [])
  const title = scope ? 'Catálogo' : kinds.length === 1 ? (kinds[0] === 'movie' ? 'Filmes' : 'Séries') : 'Catálogo'
  // Ver tudo: com um único tipo na URL, o menu lateral já abre nele.
  const initial: CollectionId = scope ? (initialKind.length === 1 ? `type:${initialKind[0]!}` : `type:${kinds[0]!}`) : collection
  return <CatalogScreen kinds={kinds} title={title} initial={initial} scope={scope} />
}
