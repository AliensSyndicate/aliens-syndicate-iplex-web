import { describe, expect, it } from 'vitest'
import { kindForDomainCode, toAppError } from './errors'

const fn = (message: string, code = 'functions/failed-precondition') => ({ code, message })

describe('errors', () => {
  it('distingue assinatura inativa de fonte IPTV indisponível', () => {
    expect(toAppError(fn('subscription-required')).kind).toBe('subscription-inactive')
    expect(toAppError(fn('provider-unavailable')).kind).toBe('iptv-unavailable')
    expect(toAppError(fn('invalid-credentials')).kind).toBe('iptv-unavailable')
  })
  it('mapeia limites de sessão e perfil em uso', () => {
    expect(toAppError(fn('session-limit')).kind).toBe('session-limit')
    expect(toAppError(fn('profile-in-use')).kind).toBe('profile-in-use')
  })
  it('dispositivo revogado e credencial inválida', () => {
    expect(toAppError(fn('device-revoked', 'functions/permission-denied')).kind).toBe('device-unpaired')
    expect(toAppError(fn('unauthenticated', 'functions/unauthenticated')).kind).toBe('device-unpaired')
  })
  it('sem credencial, unauthenticated é App Check', () => {
    expect(toAppError(fn('unauthenticated', 'functions/unauthenticated'), { authenticated: false }).kind).toBe('app-check')
  })
  it('pareamento pendente/expirado', () => {
    expect(kindForDomainCode('invalid-token')).toBe('pairing-pending')
    expect(kindForDomainCode('pairing-expired')).toBe('pairing-expired')
  })
  it('falha de servidor é recuperável', () => {
    const e = toAppError({ code: 'functions/unavailable', message: 'x' })
    expect(e.kind).toBe('server-unavailable')
    expect(e.retryable).toBe(true)
  })
})

it('ação inexistente no backend = servidor desatualizado (não erro genérico)', () => {
  expect(toAppError(fn('invalid-action')).kind).toBe('backend-outdated')
})
