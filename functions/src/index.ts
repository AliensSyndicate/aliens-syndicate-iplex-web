/** TMDB secret stays here. Player supplies all device/catalog authorization. */
import { initializeApp } from 'firebase-admin/app'
import { defineSecret } from 'firebase-functions/params'
import { onRequest } from 'firebase-functions/v2/https'
import { callPlayerMetadata, createTmdbAccess } from './tmdbAccess.ts'
import { routeAuthorizedTmdb } from './tmdb/authorizedRouter.ts'
import { createTmdbService, type TmdbService } from './tmdb/service.ts'
initializeApp()
const tmdbToken = defineSecret('TMDB_READ_ACCESS_TOKEN')
let service: TmdbService | undefined
const authorize = createTmdbAccess(callPlayerMetadata)
export const iplexWebTmdb = onRequest(
  { region: 'us-central1', secrets: [tmdbToken], memory: '256MiB', maxInstances: 5, concurrency: 40, timeoutSeconds: 20 },
  async (req, res) => {
    res.set('Cache-Control', 'no-store')
    if (req.method !== 'GET') { res.status(405).json({ error: 'method_not_allowed' }); return }
    const url = new URL(req.originalUrl, 'https://local')
    const access = await authorize(req.get('authorization'), url.searchParams)
    if (!access.ok) { res.status(access.status).json({ error: access.error }); return }
    try {
      service ??= createTmdbService({ readAccessToken: tmdbToken.value() })
      const result = await routeAuthorizedTmdb(service, url.pathname, url.searchParams, access.item)
      // Never let a browser cache bypass revocation or a profile change.
      res.status(result.status).json(result.body)
    } catch { res.status(502).json({ error: 'metadata_unavailable' }) }
  },
)
