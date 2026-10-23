/**
 * De-para das categorias das listas IPTV (filmes, séries e canais ao vivo).
 *
 * As fontes entregam nomes sujos: caixa alta, sem acento ("AÇAO"), em outro
 * idioma ("Action"), com prefixo ("FILMES | Ação") ou com variações de adulto.
 * `categoryLabel` devolve o texto exibido: corrigido, em português, com a
 * primeira letra maiúscula (como "Continuar assistindo" e "Todos"). Nomes
 * diferentes que viram o mesmo texto formam uma única categoria
 * (`categoryKey`). Toda variação adulta vira exatamente "Adulto".
 *
 * Nomes sem regra caem no padrão genérico (acentos de palavras conhecidas,
 * siglas preservadas, resto em caixa de frase). Novas regras entram em
 * CATEGORY_TABLE / WORD_FIXES; os nomes sem regra aparecem no diagnóstico da TV.
 */

export const ADULT_LABEL = 'Adulto'

const ADULT_NAME = /(^|[^a-z0-9])(adult[oa]?s?|xxx|\+\s?18|18\s?\+|er[óo]tic[oa]s?|porn[oô]?s?|sexo|sexy|hentai|playboy)([^a-z0-9]|$)/i

/** Categoria adulta do fornecedor (qualquer variação). */
export const isAdultName = (name: string) => ADULT_NAME.test(name) || name.trim() === ADULT_LABEL

/** Chave de comparação: minúsculas, sem acentos e sem pontuação (mantém "+"). */
export function foldName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' e ')
    .replace(/[^a-z0-9+]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** chave dobrada → texto exibido */
const CATEGORY_TABLE: Record<string, string> = {
  // Gêneros
  acao: 'Ação',
  action: 'Ação',
  accion: 'Ação',
  'acao e aventura': 'Ação e aventura',
  'action adventure': 'Ação e aventura',
  aventura: 'Aventura',
  adventure: 'Aventura',
  animacao: 'Animação',
  animation: 'Animação',
  animacion: 'Animação',
  animes: 'Animes',
  anime: 'Animes',
  desenho: 'Desenhos',
  desenhos: 'Desenhos',
  'desenhos animados': 'Desenhos',
  cartoon: 'Desenhos',
  cartoons: 'Desenhos',
  comedia: 'Comédia',
  comedy: 'Comédia',
  'comedia romantica': 'Comédia romântica',
  crime: 'Crime',
  policial: 'Policial',
  documentario: 'Documentário',
  documentarios: 'Documentários',
  documentary: 'Documentário',
  documentaries: 'Documentários',
  documental: 'Documentário',
  drama: 'Drama',
  dramas: 'Drama',
  familia: 'Família',
  family: 'Família',
  fantasia: 'Fantasia',
  fantasy: 'Fantasia',
  'ficcao cientifica': 'Ficção científica',
  'ficcao e fantasia': 'Ficção e fantasia',
  'ficcao fantasia': 'Ficção e fantasia',
  youtube: 'YouTube',
  'sci fi': 'Ficção científica',
  scifi: 'Ficção científica',
  'science fiction': 'Ficção científica',
  'ciencia ficcao': 'Ficção científica',
  guerra: 'Guerra',
  war: 'Guerra',
  historia: 'História',
  history: 'História',
  historico: 'Histórico',
  infantil: 'Infantil',
  infantis: 'Infantil',
  kids: 'Infantil',
  children: 'Infantil',
  criancas: 'Infantil',
  musical: 'Musical',
  musicais: 'Musical',
  musica: 'Música',
  music: 'Música',
  misterio: 'Mistério',
  mystery: 'Mistério',
  romance: 'Romance',
  romantico: 'Romance',
  suspense: 'Suspense',
  thriller: 'Suspense',
  terror: 'Terror',
  horror: 'Terror',
  faroeste: 'Faroeste',
  western: 'Faroeste',
  biografia: 'Biografia',
  biography: 'Biografia',
  esporte: 'Esportes',
  esportes: 'Esportes',
  sport: 'Esportes',
  sports: 'Esportes',
  religioso: 'Religioso',
  religiosos: 'Religiosos',
  religiao: 'Religião',
  gospel: 'Gospel',
  nacional: 'Nacional',
  nacionais: 'Nacionais',
  brasileiro: 'Brasileiro',
  brasileiros: 'Brasileiros',
  lancamento: 'Lançamentos',
  lancamentos: 'Lançamentos',
  'novos lancamentos': 'Lançamentos',
  'new releases': 'Lançamentos',
  novidades: 'Novidades',
  classicos: 'Clássicos',
  classico: 'Clássicos',
  legendado: 'Legendados',
  legendados: 'Legendados',
  dublado: 'Dublados',
  dublados: 'Dublados',
  novela: 'Novelas',
  novelas: 'Novelas',
  dorama: 'Doramas',
  doramas: 'Doramas',
  serie: 'Séries',
  series: 'Séries',
  'series tv': 'Séries TV',
  filme: 'Filmes',
  filmes: 'Filmes',
  movies: 'Filmes',
  '4k': '4K',
  uhd: 'UHD',
  'uhd 4k': 'UHD 4K',
  '4k uhd': 'UHD 4K',
  fhd: 'FHD',
  hd: 'HD',
  'sem categoria': 'Sem categoria',
  // Canais ao vivo
  abertos: 'Canais abertos',
  'canais abertos': 'Canais abertos',
  'tv aberta': 'Canais abertos',
  noticias: 'Notícias',
  news: 'Notícias',
  jornalismo: 'Notícias',
  variedades: 'Variedades',
  entretenimento: 'Entretenimento',
  reality: 'Reality',
  'filmes e series': 'Filmes e séries',
  'canais de filmes': 'Filmes',
  'canais de esportes': 'Esportes',
  premiere: 'Premiere',
  // Serviços de streaming (nome oficial)
  'amazon prime video': 'Amazon Prime Video',
  'prime video': 'Amazon Prime Video',
  amazon: 'Amazon Prime Video',
  'apple tv+': 'Apple TV+',
  'apple tv': 'Apple TV+',
  'appletv+': 'Apple TV+',
  appletv: 'Apple TV+',
  crunchyroll: 'Crunchyroll',
  'discovery+': 'Discovery+',
  discovery: 'Discovery+',
  'disney+': 'Disney+',
  disney: 'Disney+',
  globoplay: 'Globoplay',
  'hbo max': 'HBO Max',
  max: 'Max',
  hbo: 'HBO',
  netflix: 'Netflix',
  'paramount+': 'Paramount+',
  paramount: 'Paramount+',
  'star+': 'Star+',
  star: 'Star+',
  'brasil paralelo': 'Brasil Paralelo',
  'especial de natal': 'Especial de Natal',
  natal: 'Natal',
}

/** Palavra sem acento → forma correta (usado no padrão genérico). */
const WORD_FIXES: Record<string, string> = {
  acao: 'ação',
  aventura: 'aventura',
  animacao: 'animação',
  comedia: 'comédia',
  documentario: 'documentário',
  documentarios: 'documentários',
  ficcao: 'ficção',
  cientifica: 'científica',
  serie: 'série',
  series: 'séries',
  musica: 'música',
  familia: 'família',
  historia: 'história',
  historico: 'histórico',
  noticias: 'notícias',
  lancamento: 'lançamento',
  lancamentos: 'lançamentos',
  misterio: 'mistério',
  religiao: 'religião',
  classicos: 'clássicos',
  criancas: 'crianças',
  romantico: 'romântico',
  romantica: 'romântica',
  epico: 'épico',
  epicos: 'épicos',
  tematico: 'temático',
  tematicos: 'temáticos',
  atualidades: 'atualidades',
  educacao: 'educação',
  educativo: 'educativo',
  cultura: 'cultura',
  esportes: 'esportes',
  variedade: 'variedade',
  gastronomia: 'gastronomia',
  turismo: 'turismo',
  saude: 'saúde',
  ciencia: 'ciência',
  tecnologia: 'tecnologia',
  pais: 'país',
  paises: 'países',
  juridico: 'jurídico',
  policia: 'polícia',
}

const ACRONYMS = new Set(['tv', 'hd', 'fhd', 'uhd', 'hbo', 'dc', 'sbt', 'cnn', 'bbc', 'vod', 'uk', 'usa', 'eua', 'dj', 'ufc', 'nba', 'nfl', 'wwe', 'mtv', 'gnt', 'rpc'])
/** Marcas escritas de forma própria dentro de nomes sem regra. */
const BRAND_WORDS: Record<string, string> = { youtube: 'YouTube', reelshort: 'ReelShort', hbo: 'HBO', globoplay: 'Globoplay', netflix: 'Netflix', disney: 'Disney' }
const PREFIXES = new Set(['filmes', 'filme', 'series', 'serie', 'canais', 'canal', 'movies', 'vod', 'tv', 'categoria'])

function capitalize(word: string): string {
  return word.charAt(0).toLocaleUpperCase('pt-BR') + word.slice(1)
}

/** Caixa de frase (como "Continuar assistindo"): primeira letra maiúscula, resto minúsculo; siglas e marcas preservadas. */
function sentenceCase(raw: string): string {
  const cleaned = raw
    .replace(/[|_/\\·•:;[\]{}()<>]+/g, ' ')
    .replace(/^[\s\-–—.]+|[\s\-–—.]+$/g, '')
    .replace(/\s+/g, ' ')
  const words = cleaned.split(' ').filter(Boolean)
  // Tudo em caixa alta (comum nas listas): só siglas conhecidas ou com dígito ficam em maiúsculas.
  const allCaps = cleaned === cleaned.toUpperCase()
  return words
    .map((original, index) => {
      const folded = foldName(original)
      const fixed = WORD_FIXES[folded]
      if (fixed) return index === 0 ? capitalize(fixed) : fixed
      if (CATEGORY_TABLE[folded] && /\d|\+/.test(folded)) return CATEGORY_TABLE[folded]!
      // Siglas e marcas curtas (HBO, TV, UHD, 4K): até 3 letras em caixa alta, ou com dígito.
      const isAcronym = /\d/.test(original) ? original === original.toUpperCase() : original.length <= 3 && original === original.toUpperCase() && (!allCaps || ACRONYMS.has(folded))
      if (isAcronym) return original
      if (BRAND_WORDS[folded]) return BRAND_WORDS[folded]!
      const lower = original.toLocaleLowerCase('pt-BR')
      return index === 0 ? capitalize(lower) : lower
    })
    .join(' ')
}

/** Texto exibido da categoria (corrigido, traduzido e padronizado). */
export function categoryLabel(name: string): string {
  const raw = (name ?? '').trim()
  if (!raw) return CATEGORY_TABLE['sem categoria']!
  if (isAdultName(raw)) return ADULT_LABEL
  const folded = foldName(raw)
  const direct = CATEGORY_TABLE[folded]
  if (direct) return direct
  // "FILMES | AÇÃO", "Canais - Esportes": tenta sem os prefixos genéricos.
  const parts = folded.split(' ')
  for (let i = 1; i < parts.length && PREFIXES.has(parts[i - 1]!); i += 1) {
    const rest = parts.slice(i).join(' ')
    if (CATEGORY_TABLE[rest]) return CATEGORY_TABLE[rest]!
  }
  return sentenceCase(raw)
}

/** Identidade da categoria: nomes que viram o mesmo texto são o mesmo grupo. */
export const categoryKey = (name: string) => foldName(categoryLabel(name))
