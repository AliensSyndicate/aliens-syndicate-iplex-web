/**
 * Desenvolvimento: atende /api/tmdb/* no servidor do Vite com o mesmo
 * roteador da Cloud Function. O token TMDB vem de .env.local (sem prefixo
 * VITE_), fica no processo do Node e nunca entra no bundle.
 *
 * Só em `vite dev` (apply: 'serve'). Em produção a rota é atendida pela
 * Function iplexWebTmdb, que exige um dispositivo pareado.
 */
import type { Plugin } from 'vite'
import { routeTmdb } from '../functions/src/tmdb/router.ts'
import { createTmdbService, type TmdbService } from '../functions/src/tmdb/service.ts'

export function tmdbDevServer({ readAccessToken }: { readAccessToken?: string; apiKey?: string }): Plugin {
  let service: TmdbService | undefined
  return {
    name: 'iplex-tmdb-dev',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/tmdb', (req, res) => {
        const send = (status: number, body: unknown, maxAge = 0) => {
          res.statusCode = status
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.setHeader('Cache-Control', maxAge > 0 ? `private, max-age=${maxAge}` : 'no-store')
          res.end(JSON.stringify(body))
        }
        if (req.method !== 'GET') return send(405, { error: 'method_not_allowed' })
        if (!readAccessToken) return send(503, { error: 'metadata_not_configured' })
        service ??= createTmdbService({ readAccessToken })
        // Dentro do middleware montado em /api/tmdb, req.url é relativo à montagem.
        const url = new URL(`/api/tmdb${req.url ?? ''}`, 'http://localhost')
        routeTmdb(service, url.pathname, url.searchParams).then(
          (result) => send(result.status, result.body, result.maxAge),
          () => send(502, { error: 'metadata_unavailable' }),
        )
      })
    },
  }
}
