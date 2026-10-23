import { describe, expect, it, vi } from 'vitest'
import { createDiscoveryAccess, createTmdbAccess } from './tmdbAccess.ts'
import { routeAuthorizedTmdb } from './tmdb/authorizedRouter.ts'
import type { TmdbService } from './tmdb/service.ts'
const query = new URLSearchParams({ sourceId: 's1', itemId: 'i1' })
const item = { kind: 'movie' as const, title: 'Authorized title', year: 2020 }
describe('TMDB authorization', () => {
  it('requires credential and an actual catalog reference before calling Player', async () => {
    const call = vi.fn(async () => item), access = createTmdbAccess(call)
    expect(await access(undefined, query)).toMatchObject({ status: 401 })
    expect(await access('Bearer x', new URLSearchParams())).toMatchObject({ status: 403 })
    expect(call).not.toHaveBeenCalled()
    expect(await access('Bearer x', query)).toEqual({ ok: true, item })
    expect(call).toHaveBeenCalledWith('x', 's1', 'i1')
  })
  it.each(['device-revoked', 'subscription-required', 'session-expired', 'profile-disabled', 'permission-denied', 'not-found', 'rate-limited', 'network'])('fails closed on %s', async code => {
    const access = createTmdbAccess(async () => { throw new Error(code) })
    expect((await access('Bearer x', query)).ok).toBe(false)
  })
  it('rechecks permissions on every request; never caches authorization', async () => {
    let revoked = false
    const access = createTmdbAccess(async () => { if (revoked) throw new Error('device-revoked'); return item })
    expect((await access('Bearer x', query)).ok).toBe(true)
    revoked = true
    expect((await access('Bearer x', query)).ok).toBe(false)
  })
  it('cannot substitute a TMDB id using an authorized catalog reference', async () => {
    const movie = vi.fn(), match = vi.fn(async () => ({ status: 'matched', summary: { tmdbId: 12 } }))
    const service = { match, movie } as unknown as TmdbService
    expect((await routeAuthorizedTmdb(service, '/api/tmdb/movie/99', query, item)).status).toBe(403)
    expect(movie).not.toHaveBeenCalled()
    await routeAuthorizedTmdb(service, '/api/tmdb/movie/12', query, item)
    expect(movie).toHaveBeenCalledWith(12)
    expect(match).toHaveBeenCalledWith('movie', 'Authorized title', 2020)
  })
  it('TV: pessoa só quando creditada no título autorizado', async () => {
    const match = vi.fn(async () => ({ status: 'matched', summary: { tmdbId: 12 } }))
    const movie = vi.fn(async () => ({ cast: [{ id: 6384, name: 'Keanu Reeves' }], crew: [{ id: 7, name: 'Lana' }] }))
    const person = vi.fn(async () => ({ tmdbId: 6384 }))
    const service = { match, movie, person } as unknown as TmdbService
    expect((await routeAuthorizedTmdb(service, '/api/tmdb/person/6384', query, item)).status).toBe(200)
    expect((await routeAuthorizedTmdb(service, '/api/tmdb/person/7', query, item)).status).toBe(200)
    expect((await routeAuthorizedTmdb(service, '/api/tmdb/person/999', query, item)).status).toBe(403)
    expect(person).toHaveBeenCalledTimes(2)
    const unmatched = { match: vi.fn(async () => ({ status: 'not_found', summary: null })), movie, person } as unknown as TmdbService
    expect((await routeAuthorizedTmdb(unmatched, '/api/tmdb/person/6384', query, item)).status).toBe(403)
    expect(person).toHaveBeenCalledTimes(2)
  })
  it('iPlex Control: App Check token routes to the manager (with the family context); never to the Player', async () => {
    const player = vi.fn(async () => item), control = vi.fn(async () => item)
    const access = createTmdbAccess(player, control)
    expect(await access('Bearer person', new URLSearchParams({ sourceId: 's1', itemId: 'i1', contextFamilyId: 'fam1' }), 'appcheck')).toEqual({ ok: true, item })
    expect(control).toHaveBeenCalledWith('person', 'appcheck', 's1', 'i1', 'fam1')
    expect(player).not.toHaveBeenCalled()
    await access('Bearer person', new URLSearchParams({ sourceId: 's1', itemId: 'i1', contextFamilyId: 'null' }), 'appcheck')
    expect(control).toHaveBeenLastCalledWith('person', 'appcheck', 's1', 'i1', null)
    expect(await access('Bearer person', new URLSearchParams({ sourceId: 's1', itemId: 'i1', contextFamilyId: '../x' }), 'appcheck')).toMatchObject({ status: 403 })
  })
  it('iPlex Control: App Check rejected by the manager fails closed (401)', async () => {
    const access = createTmdbAccess(async () => item, async () => { throw new Error('Unauthenticated') })
    expect(await access('Bearer person', query, 'bad')).toMatchObject({ ok: false, status: 401 })
  })
  it('without a Control caller configured, an App Check request is refused', async () => {
    const access = createTmdbAccess(async () => item)
    expect((await access('Bearer person', query, 'appcheck')).ok).toBe(false)
  })
})

describe('editorial discovery authorization (Control only)', () => {
  it('requires a person token AND App Check; a TV token (no App Check) never reaches the manager', async () => {
    const call = vi.fn(async () => ({ ok: true })), access = createDiscoveryAccess(call)
    expect(await access('Bearer tv', new URLSearchParams())).toMatchObject({ ok: false, status: 401 })
    expect(await access(undefined, new URLSearchParams(), 'ac')).toMatchObject({ ok: false, status: 401 })
    expect(call).not.toHaveBeenCalled()
    expect(await access('Bearer x', new URLSearchParams({ contextFamilyId: 'f1' }), 'ac')).toEqual({ ok: true })
    expect(call).toHaveBeenCalledWith('x', 'ac', 'f1')
    expect(await access('Bearer x', new URLSearchParams({ contextFamilyId: '../x' }), 'ac')).toMatchObject({ ok: false, status: 403 })
  })
  it.each([['content-unavailable', 403], ['rate-limited', 429], ['permission-denied', 403], ['network', 503]])('fails closed on %s', async (code, status) => {
    const access = createDiscoveryAccess(async () => { throw new Error(code as string) })
    expect(await access('Bearer x', new URLSearchParams(), 'ac')).toMatchObject({ ok: false, status })
  })
})
