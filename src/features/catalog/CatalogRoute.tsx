import { useSearchParams } from 'react-router-dom'
import { CatalogScreen } from './CatalogScreen'
import { parseCollection, parseKinds } from './collections'

/** /catalogo?c=<coleção>&k=<tipos>: a mesma tela de Filmes e Séries, com outro contexto de entrada. */
export default function CatalogRoute() {
  const [params] = useSearchParams()
  const kinds = parseKinds(params.get('k'), ['movie', 'series'])
  const title = kinds.length === 1 ? (kinds[0] === 'movie' ? 'Filmes' : 'Séries') : 'Catálogo'
  return <CatalogScreen kinds={kinds} title={title} initial={parseCollection(params.get('c'))} />
}
