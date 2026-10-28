import { useSearchParams } from 'react-router-dom'
import { CatalogScreen } from './CatalogScreen'
import { parseCollection, parseKinds, type PersonalCollection } from './collections'

const PERSONAL: PersonalCollection[] = ['continue', 'favorites', 'wishlist', 'watched', 'releases']

/**
 * /catalogo?c=<coleção>&k=<tipos>. Coleções do Meu iPlex ("Ver tudo") abrem a tela Catálogo daquela fileira,
 * separada por tipo (Tudo, Filmes, Séries, Ao vivo); as demais mantêm o menu de categorias de Filmes e Séries.
 */
export default function CatalogRoute() {
  const [params] = useSearchParams()
  const collection = parseCollection(params.get('c'))
  const scope = PERSONAL.find((c) => c === collection)
  const kinds = parseKinds(params.get('k'), scope ? ['movie', 'series', 'channel'] : ['movie', 'series'])
  const title = scope ? 'Catálogo' : kinds.length === 1 ? (kinds[0] === 'movie' ? 'Filmes' : 'Séries') : 'Catálogo'
  return <CatalogScreen kinds={kinds} title={title} initial={scope ?? collection} scope={scope} />
}
