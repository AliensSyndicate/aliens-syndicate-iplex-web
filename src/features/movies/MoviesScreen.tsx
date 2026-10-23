import { CatalogScreen } from '../catalog/CatalogScreen'

export default function MoviesScreen() {
  return <CatalogScreen kinds={['movie']} title="Filmes" initial="all" />
}
