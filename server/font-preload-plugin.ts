/**
 * Injeta <link rel="preload" as="font" crossorigin> para os WOFF2 da Google
 * Sans no index.html, com os nomes finais (hash) do build. Assim o download
 * começa junto com o HTML, em paralelo ao JavaScript; src/styles/fonts.ts usa
 * as MESMAS URLs (modo CORS anônimo, como o preload), sem baixar duas vezes.
 */
import type { Plugin } from 'vite'

const FONT = /google-sans-latin-(400|500|700)-normal-[\w-]+\.woff2$/

export function fontPreload(): Plugin {
  return {
    name: 'iplex-font-preload',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(_html, ctx) {
        const files = Object.keys(ctx.bundle ?? {}).filter((name) => FONT.test(name)).sort()
        if (files.length !== 3) throw new Error(`iplex-font-preload: esperados 3 arquivos WOFF2 da Google Sans, encontrados ${files.length}`)
        return files.map((file) => ({
          tag: 'link',
          attrs: { rel: 'preload', href: `/${file}`, as: 'font', type: 'font/woff2', crossorigin: '' },
          injectTo: 'head-prepend' as const,
        }))
      },
    },
  }
}
