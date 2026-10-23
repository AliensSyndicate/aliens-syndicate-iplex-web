/**
 * Carregadores das telas (code splitting). A inicialização os pré-busca para
 * que, liberada a navegação, nenhuma tela espere código pela primeira vez.
 */
export const screenLoaders = {
  myIplex: () => import('../features/my-iplex/MyIplexScreen'),
  search: () => import('../features/search/SearchScreen'),
  live: () => import('../features/live-tv/LiveTvScreen'),
  movies: () => import('../features/movies/MoviesScreen'),
  series: () => import('../features/series/SeriesScreen'),
  catalog: () => import('../features/catalog/CatalogRoute'),
  details: () => import('../features/details/DetailsScreen'),
  player: () => import('../features/playback/PlayerScreen'),
  person: () => import('../features/details/PersonScreen'),
  settings: () => import('../features/settings/SettingsScreen'),
}

export const prefetchScreens = () => Promise.all(Object.values(screenLoaders).map((load) => load().catch(() => undefined)))
