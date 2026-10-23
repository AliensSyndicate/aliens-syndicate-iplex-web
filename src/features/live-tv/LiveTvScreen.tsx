import { CatalogScreen } from '../catalog/CatalogScreen'

/** Ao Vivo: mesma tela do Catálogo (menu lateral de categorias, grid de 5 por linha), com canais 1:1. */
export default function LiveTvScreen() {
  return <CatalogScreen kinds={['channel']} title="Ao Vivo" initial="all" />
}
