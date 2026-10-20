import { describe, expect, it, vi } from 'vitest'
import { createTmdbAccess } from './tmdbAccess.ts'
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
})
