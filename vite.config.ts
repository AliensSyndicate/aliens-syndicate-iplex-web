import react from '@vitejs/plugin-react'
import legacy from '@vitejs/plugin-legacy'
import { readFileSync } from 'node:fs'
import { defineConfig, loadEnv } from 'vite'
import { fontPreload } from './server/font-preload-plugin.ts'
import { legacyGuardWithoutDataUrl } from './server/legacy-guard-plugin.ts'
import { tmdbDevServer } from './server/vite-tmdb-plugin.ts'

const root = import.meta.dirname
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Variáveis do servidor (sem prefixo VITE_): ficam só no processo do Node,
  // usadas pelo middleware /api/tmdb em desenvolvimento. Nunca vão ao bundle.
  const serverEnv = loadEnv(mode, root, 'TMDB_')

  return {
    base: '/',
    define: {
      __IPLEX_WEB_VERSION__: JSON.stringify(pkg.version),
    },
    plugins: [
      react(),
      tmdbDevServer({
        readAccessToken: serverEnv.TMDB_READ_ACCESS_TOKEN,
        apiKey: serverEnv.TMDB_API_KEY,
      }),
      // Tizen 4.0 (TVs 2018) = Chromium M56: sem <script type="module">.
      // Chunks modernos (ESM) + legados (SystemJS transpilado + polyfills
      // core-js), com carregamento sob demanda (Clappr, telas). O CSS sai em
      // <link> (nunca <style> injetado). Os scripts inline do plugin entram na
      // CSP por hash (scripts/hosting-config.mjs).
      legacy({
        targets: ['chrome >= 56'],
        // Sem polyfills no bundle moderno: esse chunk recebe o detector do
        // plugin depois do hash (cache imutável ficaria inconsistente).
        modernPolyfills: false,
      }),
      legacyGuardWithoutDataUrl(),
      fontPreload(),
    ],
    build: {
      // Fontes sempre como arquivo (nunca data: em CSS/JS): cache e preload.
      assetsInlineLimit: (file: string) => (/\.(woff2?|ttf|otf)$/.test(file) ? false : undefined),
      // Sem minificar CSS: o minificador reescreve os tokens oficiais do
      // Design System (ex.: alfa 0.0509803922 → 0.05, #FFFFFF → #fff).
      cssMinify: false,
      // CSS num único <link>: sem isso o bundle legado reinjeta o CSS como
      // <style> (duplicado e bloqueado pela CSP sem 'unsafe-inline').
      cssCodeSplit: false,
      // Sem <link rel="modulepreload"> inline polyfill (CSP sem unsafe-inline).
      modulePreload: { polyfill: false },
      chunkSizeWarningLimit: 1100,
      sourcemap: false,
    },
    server: {
      port: 5173,
      strictPort: true,
    },
  }
})
