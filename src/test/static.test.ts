/**
 * Verificações estáticas do repositório: Design System, segurança de
 * credenciais, configuração de Hosting e cópia fiel do contrato da ponte.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
// @ts-expect-error módulo .mjs sem tipos
import { buildCsp, buildFirebaseConfig, inlineScriptHashes } from '../../scripts/hosting-config.mjs'

const root = join(import.meta.dirname, '..', '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')
const css = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, '')
const isTest = (f: string) => /\.test\.tsx?$|src\/test\//.test(f)
const walk = (dir: string): string[] =>
  readdirSync(join(root, dir)).flatMap((name) => {
    const rel = join(dir, name)
    return statSync(join(root, rel)).isDirectory() ? walk(rel) : [rel]
  })

describe('Design System', () => {
  const tokens = read('src/styles/tokens.css')
  it('tokens oficiais exatos', () => {
    for (const line of [
      '--iplex-bg: #0F0F0F;',
      '--iplex-text-primary: #F1F1F1;',
      '--iplex-text-secondary: #B7B7B7;',
      '--iplex-card-bg: rgba(241, 243, 244, 0.0509803922);',
      '--iplex-button-primary-bg: #FFFFFF;',
      '--iplex-button-primary-text: #0F0F0F;',
      '--iplex-button-secondary-bg: transparent;',
      '--iplex-button-secondary-text: #F1F1F1;',
      '--iplex-button-secondary-border: #F1F1F1;',
      '--iplex-radius: 48px;',
      '--iplex-radius-full: 9999px;',
    ])
      expect(tokens).toContain(line)
  })
  it('nenhuma cor fora da paleta oficial nos estilos', () => {
    const allowed = new Set(['#0f0f0f', '#f1f1f1', '#b7b7b7', '#ffffff'])
    for (const file of walk('src/styles')) {
      const text = css(file)
      for (const hex of text.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []) expect(allowed.has(hex.toLowerCase()), `${file}: ${hex}`).toBe(true)
      for (const rgba of text.match(/rgba?\([^)]*\)/g) ?? []) {
        const ok = /^rgba\(241, 243, 244, 0\.0509803922\)$/.test(rgba) || /^rgba\(15, 15, 15, [\d.]+\)$/.test(rgba)
        expect(ok, `${file}: ${rgba}`).toBe(true)
      }
    }
  })
  it('fundo global sólido (sem gradiente em html/body)', () => {
    const base = css('src/styles/base.css')
    expect(base).toMatch(/background-color: var\(--iplex-bg\)/)
    expect(base).not.toMatch(/gradient/)
  })
  it('logo branco sólido sem efeitos', () => {
    const text = css('src/styles/components.css')
    const logo = text.slice(text.indexOf('.iplex-logo-text {'), text.indexOf('}', text.indexOf('.iplex-logo-text {')))
    expect(logo).toContain('text-shadow: none')
    expect(logo).toContain('-webkit-text-stroke: 0')
    expect(read('src/styles/tokens.css')).toContain('--iplex-logo-color: #FFFFFF;')
  })
  it('sem APIs CSS ausentes no Chromium M56', () => {
    for (const file of walk('src/styles')) {
      expect(css(file), file).not.toMatch(/(^|[\s;{])(gap|inset|aspect-ratio):|display:\s*grid/)
    }
  })
  it('botões textuais não contêm ícones', () => {
    for (const file of walk('src').filter((f) => f.endsWith('.tsx'))) {
      const src = read(file)
      expect(src, file).not.toMatch(/<IplexButton[^>]*>\s*<IplexIcon/)
    }
  })
})

describe('segurança de credenciais', () => {
  it('TMDB nunca com prefixo VITE_ no código', () => {
    for (const file of [...walk('src').filter((f) => !isTest(f)), 'vite.config.ts', 'index.html']) {
      expect(read(file), file).not.toMatch(/VITE_TMDB/)
    }
  })
  it('frontend não chama a API do TMDB diretamente', () => {
    for (const file of walk('src').filter((f) => !isTest(f))) expect(read(file), file).not.toContain('api.themoviedb.org')
  })
  it('.env.example sem segredos e .env.local ignorado', () => {
    const example = read('.env.example')
    expect(example).toMatch(/^TMDB_READ_ACCESS_TOKEN=$/m)
    expect(example).toMatch(/^TMDB_API_KEY=$/m)
    expect(read('.gitignore')).toMatch(/^\.env\.\*$/m)
    expect(read('.gitignore')).toMatch(/^\*\.local$/m)
  })
  it('pagamentos desligados', () => {
    expect(read('src/config/features.ts')).toMatch(/paymentsEnabled: false/)
  })
})

describe('Hosting', () => {
  const config = buildFirebaseConfig(['abc='])
  it('nunca bloqueia o iframe do shell Tizen', () => {
    const csp = buildCsp(['abc='])
    expect(csp).not.toMatch(/frame-ancestors/)
    expect(csp).not.toMatch(/unsafe-inline|unsafe-eval/)
    expect(JSON.stringify(config)).not.toMatch(/X-Frame-Options/i)
  })
  it('site iplex-2c8fc, SPA, manifesto com CORS e Function em codebase próprio', () => {
    expect(config.hosting.site).toBe('iplex-2c8fc')
    expect(config.hosting.rewrites.at(-1)).toEqual({ source: '**', destination: '/index.html' })
    const manifest = config.hosting.headers.find((h: { source: string }) => h.source === '/iplex-web.json')
    expect(manifest.headers).toContainEqual({ key: 'Access-Control-Allow-Origin', value: '*' })
    expect(config.functions[0].codebase).toBe('iplex-web')
  })
  it('firebase.json versionado = gerado (hashes dos scripts inline do build)', () => {
    const current = JSON.parse(read('firebase.json'))
    const csp: string = current.hosting.headers[0].headers.find((h: { key: string }) => h.key === 'Content-Security-Policy').value
    const hashes = [...csp.matchAll(/'sha256-([^']+)'/g)].map((m) => m[1]!)
    expect(current.hosting.rewrites).toEqual(buildFirebaseConfig(hashes).hosting.rewrites)
    expect(current.hosting.headers).toEqual(buildFirebaseConfig(hashes).hosting.headers)
    if (existsSync(join(root, 'dist', 'index.html'))) expect(hashes.sort()).toEqual(inlineScriptHashes(read('dist/index.html')).sort())
  })
  it('CSP nunca libera data: para scripts', () => {
    expect(buildCsp(['x'])).not.toMatch(/script-src[^;]*data:/)
  })
  it('.firebaserc aponta para iplex-2c8fc (nunca o institucional)', () => {
    const rc = read('.firebaserc')
    expect(rc).toContain('iplex-2c8fc')
    expect(rc).not.toContain('aliens-syndicate-docs')
  })
})

describe('ponte', () => {
  const player = join(root, '..', 'aliens-syndicate-iplex-app', 'src', 'bridge', 'protocol.ts')
  it.skipIf(!existsSync(player))('protocol.ts é cópia fiel do iPlex Player', () => {
    const ours = read('src/platform/bridge/protocol.ts')
    const body = ours.slice(ours.indexOf('*/') + 3)
    expect(body).toBe(readFileSync(player, 'utf8'))
  })
})
