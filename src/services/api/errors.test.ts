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
  it('credencial ausente ou recusada pela callable player = dispositivo desvinculado', () => {
    expect(toAppError(fn('unauthenticated', 'functions/unauthenticated'), { authenticated: false }).kind).toBe('device-unpaired')
    expect(toAppError(fn('device-required')).kind).toBe('device-unpaired')
  })
  it('callable player ausente no backend = servidor desatualizado', () => {
    expect(toAppError({ code: 'functions/not-found', message: 'NOT_FOUND' }).kind).toBe('backend-outdated')
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

it('ignora o status HTTP que o SDK do Firebase acrescenta à mensagem', () => {
  expect(toAppError(fn('subscription-required [400]')).kind).toBe('subscription-inactive')
  expect(toAppError(fn('invalid-token [400]'), { authenticated: false }).kind).toBe('pairing-pending')
  expect(toAppError(fn('device-revoked [400]')).kind).toBe('device-unpaired')
})
