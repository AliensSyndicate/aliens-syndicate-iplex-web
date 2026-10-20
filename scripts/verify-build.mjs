/**
 * Verificações do build de produção (dist/). Falha com código 1 se algo
 * violar as regras do iPlex Web:
 *  1. CSP: todo <script> inline do index.html tem hash na CSP do firebase.json;
 *     sem 'unsafe-inline'/'unsafe-eval', sem X-Frame-Options/frame-ancestors.
 *  2. Nada de <style> inline nem atributos style= no HTML.
 *  3. Nenhum segredo TMDB no bundle (valores do ambiente local e padrões).
 *  4. Nenhum dado de demonstração (src/dev/mock) no bundle.
 *  5. Tokens oficiais exatos no CSS empacotado.
 *  6. Manifesto /iplex-web.json coerente (versão do package, bridgeVersion 1).
 *  7. Bundle legado (SystemJS/nomodule) presente para Chromium M56.
 */
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const dist = join(root, 'dist')
const failures = []
const fail = (msg) => failures.push(msg)

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? walk(path) : [path]
  })
}

function readEnvSecrets() {
  const values = []
  for (const file of ['.env', '.env.local', '.env.production', '.env.production.local']) {
    const path = join(root, file)
    if (!existsSync(path)) continue
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const m = /^\s*(TMDB_[A-Z_]+)\s*=\s*(.+?)\s*$/.exec(line)
      if (m && m[2].length >= 16) values.push({ name: m[1], value: m[2] })
    }
  }
  return values
}

if (!existsSync(dist)) {
  console.error('dist/ não existe: rode o build primeiro')
  process.exit(1)
}

const html = readFileSync(join(dist, 'index.html'), 'utf8')
const firebase = JSON.parse(readFileSync(join(root, 'firebase.json'), 'utf8'))
const headers = firebase.hosting.headers.flatMap((h) => h.headers)
const csp = headers.find((h) => h.key === 'Content-Security-Policy')?.value ?? ''

// 1. CSP
if (!csp) fail('firebase.json sem Content-Security-Policy')
if (/unsafe-inline|unsafe-eval/.test(csp)) fail("CSP contém 'unsafe-inline' ou 'unsafe-eval'")
if (/frame-ancestors/.test(csp)) fail('CSP contém frame-ancestors (bloqueia o shell Tizen)')
if (headers.some((h) => h.key.toLowerCase() === 'x-frame-options')) fail('X-Frame-Options presente (bloqueia o shell Tizen)')
const inline = [...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).filter((body) => body.length > 0)
for (const body of inline) {
  const hash = createHash('sha256').update(body).digest('base64')
  if (!csp.includes(`'sha256-${hash}'`)) fail(`script inline sem hash na CSP: sha256-${hash}`)
}

// 2. Estilos inline no HTML
if (/<style[\s>]/i.test(html)) fail('index.html contém <style> inline')
if (/\sstyle=/i.test(html)) fail('index.html contém atributo style=')

// 3/4. Segredos e mocks no bundle
const files = walk(dist).filter((f) => /\.(js|css|html|json|map)$/.test(f))
const secrets = readEnvSecrets()
const banned = [
  { label: 'token JWT (TMDB)', re: /eyJhbGciOiJIUzI1NiJ9\.[A-Za-z0-9_-]{20,}/ },
  { label: 'chamada direta à API TMDB', re: /api\.themoviedb\.org/ },
  { label: 'variável VITE_TMDB_*', re: /VITE_TMDB_/ },
  { label: "import de URL data: (bloqueado pela CSP)", re: /import\s*["'`]data:text\/javascript/ },
  { label: 'dados de demonstração', re: /createMockBackend|test-streams\.mux\.dev|Fonte de demonstração|iplex\.mock\.scenario/ },
]
for (const file of files) {
  const text = readFileSync(file, 'utf8')
  const rel = file.slice(dist.length + 1)
  for (const { label, re } of banned) if (re.test(text)) fail(`${rel}: ${label}`)
  for (const { name, value } of secrets) if (text.includes(value)) fail(`${rel}: valor de ${name} no bundle`)
}

// 5. Tokens oficiais
const css = files.filter((f) => f.endsWith('.css')).map((f) => readFileSync(f, 'utf8')).join('\n')
const tokens = {
  '--iplex-bg': '#0F0F0F',
  '--iplex-text-primary': '#F1F1F1',
  '--iplex-text-secondary': '#B7B7B7',
  '--iplex-card-bg': 'rgba(241, 243, 244, 0.0509803922)',
  '--iplex-button-primary-bg': '#FFFFFF',
  '--iplex-button-primary-text': '#0F0F0F',
  '--iplex-button-secondary-bg': 'transparent',
  '--iplex-button-secondary-text': '#F1F1F1',
  '--iplex-button-secondary-border': '#F1F1F1',
  '--iplex-radius': '48px',
  '--iplex-radius-full': '9999px',
}
for (const [name, value] of Object.entries(tokens)) {
  if (!css.includes(`${name}: ${value};`)) fail(`token ${name} ausente ou alterado (esperado ${value})`)
}

// 6. Manifesto
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const manifestPath = join(dist, 'iplex-web.json')
if (!existsSync(manifestPath)) fail('dist/iplex-web.json ausente')
else {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  if (manifest.app !== 'iplex-web') fail('manifesto: app != iplex-web')
  if (manifest.version !== pkg.version) fail(`manifesto: version ${manifest.version} != package ${pkg.version}`)
  if (manifest.bridgeVersion !== 1) fail('manifesto: bridgeVersion != 1')
}

// 7. Bundle legado
if (!/nomodule/.test(html) || !/legacy/.test(html)) fail('index.html sem o bundle legado (nomodule)')

if (failures.length) {
  console.error(`verify-build: ${failures.length} problema(s)`)
  for (const f of failures) console.error(` - ${f}`)
  process.exit(1)
}
console.log(`verify-build: ok (${files.length} arquivos, ${inline.length} scripts inline com hash na CSP)`)
