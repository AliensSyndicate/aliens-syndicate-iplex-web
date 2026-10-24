import { CatalogScreen } from '../catalog/CatalogScreen'

/** Ao Vivo: mesma tela do Catálogo (menu lateral de categorias, grid de 6 por linha), com canais 1:1, player de fundo mudo e painel do canal. */
export default function LiveTvScreen() {
  return <CatalogScreen kinds={['channel']} title="Ao Vivo" initial="all" live />
}
