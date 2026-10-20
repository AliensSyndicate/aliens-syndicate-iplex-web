import { describe, expect, it } from 'vitest'
import { isRevocationMarker, parseHeartbeat, parsePinCheck, parsePlayRequestClaim, parsePlayRequestDoc, parseProfiles } from './validation'

describe('validação na fronteira com o backend', () => {
  it('perfis: mantém pinRequired do backend e descarta entradas inválidas', () => {
    const profiles = parseProfiles({
      profiles: [
        { id: 'admin', name: 'Ana', type: 'admin', generations: { favorites: 1 }, permissionsVersion: 2, pinRequired: true },
        { id: 'k', name: 'Lia', type: 'kids', pinRequired: false },
        { id: 'bad id!', name: 'X' },
        { id: 'legacy', name: 'Rui', type: 'desconhecido' },
      ],
    })
    expect(profiles.map((p) => [p.id, p.type, p.pinRequired])).toEqual([
      ['admin', 'admin', true],
      ['k', 'kids', false],
      ['legacy', 'regular', undefined],
    ])
    expect(() => parseProfiles({})).toThrow(/invalid-profiles/)
  })

  it('PIN: verified obrigatório; tentativas e bloqueio quando presentes', () => {
    expect(parsePinCheck({ verified: false, required: true, attemptsLeft: 3 })).toEqual({ verified: false, required: true, attemptsLeft: 3 })
    expect(parsePinCheck({ verified: true, required: false })).toEqual({ verified: true, required: false })
    expect(() => parsePinCheck({ ok: true })).toThrow(/invalid-pin/)
  })

  it('heartbeat: ponteiro de pedido só com id válido', () => {
    expect(parseHeartbeat({ ok: true, playRequest: { id: 'pr_1', expiresAt: 5 } })).toEqual({ playRequest: { id: 'pr_1', expiresAt: 5 } })
    expect(parseHeartbeat({ ok: true })).toEqual({ playRequest: null })
    expect(parseHeartbeat(undefined)).toEqual({ playRequest: null })
    expect(parseHeartbeat({ playRequest: { id: '../x', expiresAt: 5 } })).toEqual({ playRequest: null })
  })

  it('claim: só identificadores estáveis; nada de URL', () => {
    const claim = parsePlayRequestClaim({
      id: 'pr_1',
      status: 'delivered',
      request: { sourceId: 'src', itemId: 'abc', episodeId: '901', episodeLabel: 'T1 E1', kind: 'series', title: 'Série', requesterName: 'Ana', url: 'http://x' },
    })
    expect(claim).toEqual({ id: 'pr_1', status: 'delivered', request: { sourceId: 'src', itemId: 'abc', episodeId: '901', episodeLabel: 'T1 E1', kind: 'series', title: 'Série', requesterName: 'Ana' } })
    expect(parsePlayRequestClaim({ id: 'pr_1', status: 'failed', errorCode: 'content-not-allowed' })).toEqual({ id: 'pr_1', status: 'failed', errorCode: 'content-not-allowed' })
    expect(() => parsePlayRequestClaim({ id: 'pr_1', status: 'delivered', request: { sourceId: 'src', itemId: 'abc', kind: 'game', title: 'x' } })).toThrow()
  })

  it('documento do Firestore: só pendente, não expirado e da versão 1', () => {
    const now = 1000
    expect(parsePlayRequestDoc('a', { status: 'pending', expiresAt: 2000, requesterName: 'Ana', title: 'Filme', schemaVersion: 1 }, now)).toEqual({ id: 'a', expiresAt: 2000, requesterName: 'Ana', title: 'Filme' })
    expect(parsePlayRequestDoc('a', { status: 'pending', expiresAt: 999 }, now)).toBeNull()
    expect(parsePlayRequestDoc('a', { status: 'delivered', expiresAt: 2000 }, now)).toBeNull()
    expect(parsePlayRequestDoc('a', { status: 'pending', expiresAt: 2000, schemaVersion: 2 }, now)).toBeNull()
  })

  it('marcador de desvinculação: só recente e com status revoked', () => {
    expect(isRevocationMarker({ status: 'revoked', expiresAt: 2000 }, 1000)).toBe(true)
    expect(isRevocationMarker({ status: 'revoked', expiresAt: 500 }, 1000)).toBe(false)
    expect(isRevocationMarker({ status: 'pending', expiresAt: 2000 }, 1000)).toBe(false)
  })
})
