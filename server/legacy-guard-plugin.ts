/**
 * O @vitejs/plugin-legacy detecta navegadores "modernos" importando uma URL
 * `data:text/javascript,...` que exige import.meta.resolve. A CSP do iPlex não
 * libera `data:` em script-src (seria uma brecha), então esse import falharia
 * até no Chrome atual. Este plugin troca a URL data: por um módulo do próprio
 * site com o MESMO conteúdo: quem não tem import.meta.resolve (ex.: Tizen
 * M69) continua caindo no bundle legado; a CSP fica só com 'self' + hashes.
 */
import type { Plugin } from 'vite'

export const GUARD_FILE = 'assets/import-meta-resolve-guard.js'
const GUARD_SOURCE = 'if(!import.meta.resolve)throw Error("import.meta.resolve not supported")'
const DATA_IMPORT = /import'data:text\/javascript,[^']*'/g

export function rewriteLegacyGuard(code: string, base = '/'): string {
  return code.replace(DATA_IMPORT, `import'${base}${GUARD_FILE}'`)
}

export function legacyGuardWithoutDataUrl(): Plugin {
  return {
    name: 'iplex-legacy-guard-without-data-url',
    apply: 'build',
    enforce: 'post',
    // renderChunk roda ANTES do cálculo do hash do nome do arquivo: o nome
    // muda junto com o conteúdo (essencial com cache imutável em /assets).
    renderChunk(code) {
      if (!code.includes("import'data:text/javascript,")) return null
      return { code: rewriteLegacyGuard(code), map: null }
    },
    generateBundle(_options, bundle) {
      for (const output of Object.values(bundle)) {
        if (output.type === 'chunk' && output.code.includes("import'data:text/javascript,")) {
          this.error(`guard data: restante em ${output.fileName} (reescrita após o hash deixaria cache inválido)`)
        }
      }
      this.emitFile({ type: 'asset', fileName: GUARD_FILE, source: GUARD_SOURCE })
    },
    transformIndexHtml: {
      order: 'post',
      handler: (html) => rewriteLegacyGuard(html),
    },
  }
}
