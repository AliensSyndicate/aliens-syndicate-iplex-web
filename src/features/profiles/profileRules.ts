/**
 * Regras de perfil do iPlex Web (puras, sem efeitos colaterais).
 *
 * As permissões reais (espaços visíveis, classificação infantil, guest
 * desabilitado) são aplicadas pelo backend em cada consulta. Estas regras só
 * decidem a apresentação e a ordem de entrada, sempre de forma conservadora.
 */
import { FEATURES } from '../../config/features'
import type { Profile, SectionId } from '../../services/api/types'

export type StartupDecision =
  | { type: 'enter'; profile: Profile; reason: 'single' | 'last-kids' | 'last'; /** Perfil adulto com infantil na família: tenta entrar e o servidor decide (PIN ainda válido ou não). */ tryOnly?: boolean }
  | { type: 'choose'; reason: 'multiple' | 'no-last' }
  | { type: 'none' }

export const isGuest = (p: Pick<Profile, 'type'>) => p.type === 'guest'
export const isKids = (p: Pick<Profile, 'type'>) => p.type === 'kids'
export const isAdult = (p: Pick<Profile, 'type'>) => p.type === 'admin' || p.type === 'regular'

/** Ordem de exibição: administrador, regulares, infantis, visitante. */
export function sortProfiles(profiles: Profile[]): Profile[] {
  const rank = { admin: 0, regular: 1, kids: 2, guest: 3 } as const
  return [...profiles].sort((a, b) => rank[a.type] - rank[b.type] || a.name.localeCompare(b.name, 'pt-BR'))
}

/**
 * Abertura inteligente:
 * - um único perfil autorizado → entra direto;

 * - último perfil usado (e ainda autorizado) → entra direto nele, de qualquer tipo;
 * - perfil adulto com infantil na família: o app TENTA entrar e o backend decide. A liberação por PIN dura enquanto a
 *   sessão estiver ativa (renovada a cada batida; 15 min após sair do app); se já expirou, volta à escolha com o PIN;
 * - sem último perfil conhecido → seleção de perfis.
 * `lastProfileId` é só uma dica local: o backend valida o perfil no lease.
 */
export function decideStartupProfile(profiles: Profile[], lastProfileId: string | null): StartupDecision {
  if (profiles.length === 0) return { type: 'none' }
  if (profiles.length === 1) return { type: 'enter', profile: profiles[0]!, reason: 'single' }
  const last = lastProfileId ? profiles.find((p) => p.id === lastProfileId) : undefined
  if (last && isKids(last)) return { type: 'enter', profile: last, reason: 'last-kids' }
  if (last) return { type: 'enter', profile: last, reason: 'last', ...(requiresPin(last, profiles) ? { tryOnly: true } : {}) }
  return { type: 'choose', reason: profiles.length > 1 ? 'multiple' : 'no-last' }
}

/**
 * Com perfil infantil na família, perfis adultos exigem PIN para entrar.
 * O backend informa `pinRequired` e o aplica no acquireSession; a regra local
 * só vale para respostas antigas sem o campo (sempre conservadora).
 */
export function requiresPin(target: Profile, profiles: Profile[]): boolean {
  if (typeof target.pinRequired === 'boolean') return target.pinRequired
  return isAdult(target) && profiles.some(isKids)
}

/**
 * Abas do menu principal (ordem oficial). O visitante não tem Meu iPlex. "Adulto" só aparece para perfil habilitado
 * ao conteúdo adulto no iPlex Control (nunca no infantil).
 */
export function visibleSections(profile: Pick<Profile, 'type'>, adultEnabled = false): SectionId[] {
  const all: SectionId[] = ['my-iplex', 'search', 'live', 'movies', 'series', ...(adultEnabled && !isKids(profile) ? (['adult'] as SectionId[]) : [])]
  return isGuest(profile) ? all.filter((s) => s !== 'my-iplex') : all
}

export function startSection(profile: Pick<Profile, 'type'>): SectionId {
  return isGuest(profile) ? FEATURES.guestStartSection : FEATURES.regularStartSection
}

/** Recursos de biblioteca pessoal (favoritos, lista, progresso, histórico). */
export function hasPersonalLibrary(profile: Pick<Profile, 'type'>): boolean {
  return !isGuest(profile)
}

export const SECTION_PATHS: Record<SectionId, string> = {
  'my-iplex': '/meu-iplex',
  search: '/busca',
  live: '/ao-vivo',
  movies: '/filmes',
  series: '/series',
  adult: '/adulto',
}

export function sectionForPath(pathname: string): SectionId | null {
  const entry = (Object.entries(SECTION_PATHS) as Array<[SectionId, string]>).find(([, path]) => pathname === path || pathname.startsWith(`${path}/`))
  return entry ? entry[0] : null
}

/** Rota permitida para o perfil? (proteção de URL direta no cliente; o backend é a barreira real). */
export function isPathAllowed(pathname: string, profile: Pick<Profile, 'type'>): boolean {
  const section = sectionForPath(pathname)
  if (section === 'my-iplex') return hasPersonalLibrary(profile)
  return true
}
