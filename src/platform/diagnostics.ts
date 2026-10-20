/**
 * Diagnóstico na TV (as Samsung de teste não têm Web Inspector nem logs).
 *
 * Ativo SOMENTE dentro do shell e com `?diag=1` na URL do Web (por exemplo,
 * `npm run tv -- --env production --target https://iplex-2c8fc.web.app/?diag=1`
 * no iPlex Player). Cada evento vai ao shell como um pedido de método
 * desconhecido ("diag:…"), que o host recusa e o relatório de desenvolvimento
 * do Player registra no Mac (build/logs/tv-*.log). O contrato da ponte não muda.
 * Nunca envia tokens, credenciais ou dados pessoais.
 */
import { BRIDGE_PROTOCOL, BRIDGE_VERSION } from './bridge/protocol'

let enabled: boolean | null = null
let sequence = 0

export function diagnosticsEnabled(): boolean {
  if (enabled !== null) return enabled
  try {
    enabled = window.parent !== window && /(?:^|[?&])diag=1(?:&|$)/.test(window.location.search)
  } catch {
    enabled = false
  }
  return enabled
}

const clean = (text: string) =>
  text
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '<jwt>')
    .replace(/[a-f0-9]{48,}/gi, '<hex>')
    .replace(/\s+/g, ' ')
    .slice(0, 400)

export function diag(event: string, detail = ''): void {
  if (!diagnosticsEnabled()) return
  sequence += 1
  try {
    window.parent.postMessage(
      { protocol: BRIDGE_PROTOCOL, version: BRIDGE_VERSION, kind: 'request', id: `diag-${sequence}`, method: clean(`diag:${event}:${detail}`), params: null },
      '*',
    )
  } catch {
    // sem canal: ignorado
  }
}

function describeDom(): string {
  const body = document.body
  const bg = body ? getComputedStyle(body).backgroundColor : '-'
  const root = document.getElementById('root')
  const frames = Array.from(document.querySelectorAll('iframe')).map((f) => {
    const r = f.getBoundingClientRect()
    let host = '-'
    try {
      host = new URL(f.src).hostname + new URL(f.src).pathname.slice(0, 30)
    } catch {
      // sem src
    }
    return `${host}@${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)} vis=${getComputedStyle(f).visibility}`
  })
  const center = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2)
  const centerDesc = center ? `${center.tagName.toLowerCase()}.${String(center.className).slice(0, 40)}` : '-'
  const css = Array.from(document.styleSheets).length
  const title = (document.querySelector('h1')?.textContent ?? '').slice(0, 60)
  return `h1="${title}" bg=${bg} css=${css} root=${root?.childElementCount ?? -1} vp=${window.innerWidth}x${window.innerHeight} center=${centerDesc} iframes=[${frames.join(' | ')}] scroll=${Math.round(window.scrollY)}/${document.documentElement.scrollHeight}`
}

/**
 * Métricas computadas (não declaradas) para comparar ambientes na referência
 * 1920×1080: fonte efetiva, tamanho, peso, altura de linha, espaçamento entre
 * letras e caixas dos elementos. Mesma função usada no navegador desktop.
 */
export function describeMetrics(): string {
  const pick = (selector: string) => {
    const el = document.querySelector(selector)
    if (!el) return `${selector}=-`
    const c = getComputedStyle(el)
    const r = el.getBoundingClientRect()
    return `${selector}=${c.fontSize}/${c.fontWeight}/${c.lineHeight}/${c.letterSpacing}@${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}`
  }
  const fonts = document.fonts as unknown as { check?: (f: string) => boolean }
  const loaded = ['400', '500', '700'].map((w) => `${w}:${fonts?.check ? fonts.check(`${w} 16px "Google Sans"`) : '?'}`).join(',')
  return [
    `root=${getComputedStyle(document.documentElement).fontSize}`,
    `gs=${loaded}`,
    pick('h1'),
    pick('.iplex-logo-text'),
    pick('.iplex-button'),
    pick('.iplex-pairing__steps li'),
    pick('.iplex-tab'),
    pick('.iplex-header__capsule'),
    pick('.iplex-text--meta'),
  ].join(' ')
}

/** Instala coleta de erros e sondas de DOM (sem efeito fora do modo diag). */
export function installDiagnostics(): void {
  if (!diagnosticsEnabled()) return
  const w = window as unknown as { __vite_is_modern_browser?: boolean }
  diag('boot', `ua=${navigator.userAgent} modern=${!!w.__vite_is_modern_browser} system=${typeof (window as unknown as { System?: unknown }).System}`)
  window.addEventListener('error', (e) => diag('error', `${e.message} @${(e.filename || '').split('/').pop()}:${e.lineno}`))
  window.addEventListener('unhandledrejection', (e) => {
    const reason = e.reason as { message?: string; code?: string } | undefined
    diag('rejection', `${reason?.code ?? ''} ${reason?.message ?? String(e.reason)}`)
  })
  document.addEventListener('securitypolicyviolation', (e) => {
    const target = e.target as Element | null
    const where = target && target.tagName ? `${target.tagName.toLowerCase()}#${target.id || ''}.${String(target.className || '').slice(0, 40)}` : String(target)
    diag('csp', `${e.violatedDirective} ${String(e.blockedURI).slice(0, 80)} src=${(e.sourceFile || '').split('/').pop()}:${e.lineNumber}:${e.columnNumber} el=${where} sample=${(e.sample || '').slice(0, 60)}`)
  })
  for (const ms of [4000, 12000]) setTimeout(() => diag(`metrics+${ms / 1000}s`, describeMetrics()), ms)
  for (const ms of [1500, 5000, 10000, 20000, 40000]) setTimeout(() => diag(`dom+${ms / 1000}s`, describeDom()), ms)
}
