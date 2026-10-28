import { describe, expect, it } from 'vitest'
import type { Profile } from '../../services/api/types'
import { decideStartupProfile, isPathAllowed, requiresPin, sortProfiles, startSection, visibleSections } from './profileRules'

const p = (id: string, type: Profile['type'], name = id): Profile => ({ id, name, type, generations: { favorites: 0, watched: 0, progress: 0 }, permissionsVersion: 0 })
const admin = p('admin', 'admin')
const regular = p('r', 'regular')
const kids = p('k', 'kids')
const guest = p('guest', 'guest')

describe('abertura inteligente', () => {
  it('um único perfil autorizado entra direto', () => {
    expect(decideStartupProfile([admin], null)).toMatchObject({ type: 'enter', profile: admin })
    expect(decideStartupProfile([guest], null)).toMatchObject({ type: 'enter', profile: guest })
  })
  it('último perfil infantil entra direto', () => {
    expect(decideStartupProfile([admin, kids, guest], 'k')).toMatchObject({ type: 'enter', profile: kids, reason: 'last-kids' })
  })
  it('último perfil adulto (sem infantil na família) entra direto', () => {
    expect(decideStartupProfile([admin, regular], 'admin')).toMatchObject({ type: 'enter', profile: admin, reason: 'last' })
    expect(decideStartupProfile([admin, regular], 'admin')).not.toHaveProperty('tryOnly')
    expect(decideStartupProfile([admin, guest], 'guest')).toMatchObject({ type: 'enter', profile: guest })
  })
  it('último perfil adulto com infantil na família: tenta entrar e o servidor decide o PIN', () => {
    expect(decideStartupProfile([admin, kids], 'admin')).toMatchObject({ type: 'enter', profile: admin, tryOnly: true })
    expect(decideStartupProfile([admin, regular, kids, guest], 'guest')).toMatchObject({ type: 'enter', profile: guest })
    expect(decideStartupProfile([admin, regular, kids, guest], 'guest')).not.toHaveProperty('tryOnly')
  })
  it('dica de perfil que não existe mais → seleção', () => {
    expect(decideStartupProfile([admin, kids], 'removido')).toMatchObject({ type: 'choose' })
  })
  it('nenhum perfil', () => {
    expect(decideStartupProfile([], null)).toEqual({ type: 'none' })
  })
  it('sem último perfil conhecido nunca entra sozinho quando há vários perfis', () => {
    expect(decideStartupProfile([admin, regular, kids], null)).toMatchObject({ type: 'choose' })
  })
  it('adulto com infantil só entra por tentativa (o PIN é conferido pelo servidor, nunca pelo cliente)', () => {
    for (const last of ['admin', 'r']) {
      const d = decideStartupProfile([admin, regular, kids], last)
      expect(d.type === 'enter' && d.tryOnly === true).toBe(true)
    }
  })
})

describe('proteção infantil', () => {
  it('adulto exige PIN quando há perfil infantil', () => {
    expect(requiresPin(admin, [admin, kids])).toBe(true)
    expect(requiresPin(regular, [admin, regular, kids])).toBe(true)
    expect(requiresPin(kids, [admin, kids])).toBe(false)
    expect(requiresPin(guest, [admin, kids, guest])).toBe(false)
  })
  it('sem perfil infantil não exige PIN', () => {
    expect(requiresPin(admin, [admin, regular])).toBe(false)
  })
  it('o backend decide quando informa pinRequired (a regra local é só reserva)', () => {
    expect(requiresPin({ ...admin, pinRequired: false }, [admin, kids])).toBe(false)
    expect(requiresPin({ ...regular, pinRequired: true }, [admin, regular])).toBe(true)
  })
})

describe('visitante', () => {
  it('tem Meu iPlex (só Destaques e Lançamentos) e abre em Ao Vivo', () => {
    expect(visibleSections(guest)).toEqual(['my-iplex', 'search', 'live', 'movies', 'series'])
    expect(startSection(guest)).toBe('live')
    expect(isPathAllowed('/meu-iplex', guest)).toBe(true)
  })
  it('perfil regular tem a ordem oficial completa', () => {
    expect(visibleSections(admin)).toEqual(['my-iplex', 'search', 'live', 'movies', 'series'])
    expect(startSection(admin)).toBe('my-iplex')
    expect(isPathAllowed('/meu-iplex', admin)).toBe(true)
  })
})

it('ordena administrador, regulares, infantis, visitante', () => {
  expect(sortProfiles([guest, kids, regular, admin]).map((x) => x.type)).toEqual(['admin', 'regular', 'kids', 'guest'])
})

describe('menu Adulto', () => {
  it('só aparece para perfil habilitado no Control e nunca para o infantil', () => {
    expect(visibleSections({ type: 'regular' })).not.toContain('adult')
    expect(visibleSections({ type: 'regular' }, true)).toEqual(['my-iplex', 'search', 'live', 'movies', 'series', 'adult'])
    expect(visibleSections({ type: 'guest' }, true)).toEqual(['my-iplex', 'search', 'live', 'movies', 'series', 'adult'])
    expect(visibleSections({ type: 'kids' }, true)).not.toContain('adult')
  })
})
