import { CatalogScreen } from '../catalog/CatalogScreen'

export default function SeriesScreen() {
  return <CatalogScreen kinds={['series']} title="Séries" initial="all" />
}
