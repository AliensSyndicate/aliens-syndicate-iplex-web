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
  it('vários perfis e último adulto → seleção', () => {
    expect(decideStartupProfile([admin, regular], 'admin')).toMatchObject({ type: 'choose' })
    expect(decideStartupProfile([admin, kids], 'admin')).toMatchObject({ type: 'choose' })
  })
  it('dica de perfil que não existe mais → seleção', () => {
    expect(decideStartupProfile([admin, kids], 'removido')).toMatchObject({ type: 'choose' })
  })
  it('nenhum perfil', () => {
    expect(decideStartupProfile([], null)).toEqual({ type: 'none' })
  })
  it('nunca entra automaticamente em adulto quando há perfil infantil', () => {
    for (const last of [null, 'admin', 'r', 'guest']) {
      const d = decideStartupProfile([admin, regular, kids], last)
      expect(d.type === 'enter' && d.profile.type !== 'kids').toBe(false)
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
})

describe('visitante', () => {
  it('não tem Meu iPlex e abre em Ao Vivo', () => {
    expect(visibleSections(guest)).toEqual(['search', 'live', 'movies', 'series'])
    expect(startSection(guest)).toBe('live')
    expect(isPathAllowed('/meu-iplex', guest)).toBe(false)
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
