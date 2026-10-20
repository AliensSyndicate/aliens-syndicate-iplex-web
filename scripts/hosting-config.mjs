/**
 * Fonte única do firebase.json do iPlex Web (Hosting iplex-2c8fc + Function
 * do codebase "iplex-web"). Regras herdadas do iPlex Player (docs/HOSTING.md
 * do repositório aliens-syndicate-iplex-app), verificadas na TV:
 *  - NUNCA X-Frame-Options nem CSP frame-ancestors (o shell Tizen usa iframe
 *    com pai file://; nenhuma lista o autoriza, nem "*").
 *  - CSP sem 'unsafe-inline'/'unsafe-eval' (exigência Samsung para hosted apps).
 *    Os scripts inline do @vitejs/plugin-legacy entram por hash, calculado a
 *    partir do dist/index.html real (o build reescreve o detector moderno:
 *    server/legacy-guard-plugin.ts).
 *  - Manifesto /iplex-web.json com CORS "*" e no-cache.
 *
 * Uso: node scripts/hosting-config.mjs  (após o build; regrava firebase.json)
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const DIST_HTML = new URL('../dist/index.html', import.meta.url)

/** Hashes sha256 (base64) de cada <script> inline com conteúdo. */
export function inlineScriptHashes(html) {
  return [...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)]
    .map((m) => m[1])
    .filter((body) => body.length > 0)
    .map((body) => createHash('sha256').update(body).digest('base64'))
}

export function distHashes() {
  if (!existsSync(DIST_HTML)) throw new Error('dist/index.html ausente: rode o build antes')
  return inlineScriptHashes(readFileSync(DIST_HTML, 'utf8'))
}

export function buildCsp(hashes) {
  const scripts = ["'self'", ...hashes.map((h) => `'sha256-${h}'`), 'https://www.google.com', 'https://www.gstatic.com']
  return [
    "default-src 'self'",
    `script-src ${scripts.join(' ')}`,
    "style-src 'self'",
    "img-src 'self' data: https:",
    "font-src 'self'",
    // Streams IPTV vêm de hosts arbitrários (Clappr/hls.js usa XHR).
    "media-src 'self' https: blob:",
    "connect-src 'self' https:",
    "worker-src 'self'",
    'frame-src https://www.google.com https://recaptcha.google.com',
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ')
}

export function buildFirebaseConfig(hashes) {
  const noCache = [{ key: 'Cache-Control', value: 'no-cache' }]
  return {
    hosting: {
      site: 'iplex-2c8fc',
      public: 'dist',
      ignore: ['firebase.json', '**/.*', '**/node_modules/**'],
      rewrites: [
        { source: '/api/tmdb/**', function: { functionId: 'iplexWebTmdb', region: 'us-central1' } },
        { source: '**', destination: '/index.html' },
      ],
      headers: [
        {
          source: '**',
          headers: [
            { key: 'X-Content-Type-Options', value: 'nosniff' },
            { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
            { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
            { key: 'Content-Security-Policy', value: buildCsp(hashes) },
          ],
        },
        { source: '/', headers: noCache },
        { source: '**/!(*.*)', headers: noCache },
        { source: '**/*.html', headers: noCache },
        { source: '/assets/**', headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }] },
        {
          source: '/iplex-web.json',
          headers: [
            { key: 'Access-Control-Allow-Origin', value: '*' },
            { key: 'Cache-Control', value: 'no-cache' },
          ],
        },
      ],
    },
    // Codebase próprio: nunca inclui nem remove as Functions do Gestor ("iplex-gestor").
    functions: [{ source: 'functions', codebase: 'iplex-web', runtime: 'nodejs22', predeploy: ['npm --prefix "$RESOURCE_DIR" run build'] }],
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(new URL('../firebase.json', import.meta.url), `${JSON.stringify(buildFirebaseConfig(distHashes()), null, 2)}\n`)
  console.log('firebase.json atualizado')
}
