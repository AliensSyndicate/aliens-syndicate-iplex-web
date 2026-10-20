/**
 * Cloud Functions do iPlex Web — codebase "iplex-web".
 *
 * Separado do codebase "iplex-gestor" (repositório do Gestor): implantar com
 * `firebase deploy --only functions:iplex-web` nunca toca as Functions do Gestor.
 *
 * iplexWebTmdb: endpoints internos /api/tmdb/* (via rewrite do Hosting).
 * - Credencial TMDB só aqui, como segredo (TMDB_READ_ACCESS_TOKEN).
 * - Só atende TVs/navegadores PAREADOS: ID token do Firebase Auth com as
 *   claims deviceId/familyId emitidas pelo backend no pareamento.
 * - App Check verificado quando o cabeçalho é obrigatório (ENFORCE_APP_CHECK).
 */
import { initializeApp } from 'firebase-admin/app'
import { getAppCheck } from 'firebase-admin/app-check'
import { getAuth } from 'firebase-admin/auth'
import { defineSecret } from 'firebase-functions/params'
import { onRequest } from 'firebase-functions/v2/https'
import { routeTmdb } from './tmdb/router.ts'
import { createTmdbService, type TmdbService } from './tmdb/service.ts'

initializeApp()
const tmdbToken = defineSecret('TMDB_READ_ACCESS_TOKEN')
const enforceAppCheck = process.env.FUNCTIONS_EMULATOR !== 'true' && process.env.ENFORCE_APP_CHECK !== 'false'
let service: TmdbService | undefined

export const iplexWebTmdb = onRequest(
  { region: 'us-central1', secrets: [tmdbToken], memory: '256MiB', maxInstances: 5, concurrency: 40, timeoutSeconds: 20 },
  async (req, res) => {
    res.set('Cache-Control', 'no-store')
    if (req.method !== 'GET') {
      res.status(405).json({ error: 'method_not_allowed' })
      return
    }
    const bearer = /^Bearer (.+)$/.exec(req.get('authorization') ?? '')?.[1]
    if (!bearer) {
      res.status(401).json({ error: 'unauthenticated' })
      return
    }
    try {
      const token = await getAuth().verifyIdToken(bearer, true)
      if (typeof token.deviceId !== 'string' || typeof token.familyId !== 'string' || token.uid !== `tv_${token.deviceId}`) {
        res.status(403).json({ error: 'device_required' })
        return
      }
      if (enforceAppCheck) {
        const appCheck = req.get('x-firebase-appcheck')
        if (!appCheck) throw new Error('app-check')
        await getAppCheck().verifyToken(appCheck)
      }
    } catch {
      res.status(401).json({ error: 'unauthenticated' })
      return
    }
    service ??= createTmdbService({ readAccessToken: tmdbToken.value() })
    const url = new URL(req.originalUrl, 'https://local')
    const result = await routeTmdb(service, url.pathname, url.searchParams)
    if (result.maxAge > 0) res.set('Cache-Control', `private, max-age=${result.maxAge}`)
    res.status(result.status).json(result.body)
  },
)
