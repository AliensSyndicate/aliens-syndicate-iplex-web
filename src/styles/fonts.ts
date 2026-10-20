/**
 * Google Sans (SIL OFL 1.1, Copyright 2017 Google — arquivos do pacote
 * @fontsource/google-sans, auto-hospedados em /assets; licença publicada em
 * /licenses/google-sans-OFL.txt).
 *
 * Sem FOUT: a interface só é montada depois que os três pesos usados (400,
 * 500, 700; subconjunto latin, que cobre o português) estão REALMENTE
 * carregados — FontFace.status === 'loaded' e document.fonts.check() — e não
 * apenas porque uma Promise resolveu. Não há atraso fixo: o único limite é um
 * prazo máximo, depois do qual a falha é exibida com opção de tentar de novo.
 *
 * Chromium 69 (Tizen 5.5) e 56 (Tizen 4.0) suportam a CSS Font Loading API
 * (Chrome 35+) e WOFF2 (Chrome 36+). O WOFF fica como alternativa no src.
 * As URLs são as mesmas do <link rel="preload"> (plugin do Vite), então a
 * fonte não é baixada duas vezes.
 */
import regular2 from '@fontsource/google-sans/files/google-sans-latin-400-normal.woff2?url'
import regular1 from '@fontsource/google-sans/files/google-sans-latin-400-normal.woff?url'
import medium2 from '@fontsource/google-sans/files/google-sans-latin-500-normal.woff2?url'
import medium1 from '@fontsource/google-sans/files/google-sans-latin-500-normal.woff?url'
import bold2 from '@fontsource/google-sans/files/google-sans-latin-700-normal.woff2?url'
import bold1 from '@fontsource/google-sans/files/google-sans-latin-700-normal.woff?url'

export const FONT_FAMILY = 'Google Sans'
/** Latin (U+0000–00FF e símbolos usados pelo @fontsource). */
const UNICODE_RANGE =
  'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD'

export const FONT_FILES = [
  { weight: '400', woff2: regular2, woff: regular1 },
  { weight: '500', woff2: medium2, woff: medium1 },
  { weight: '700', woff2: bold2, woff: bold1 },
] as const

export type TypographyResult = { ok: true; ms: number } | { ok: false; ms: number; reason: string }

interface FontFaceSetLike {
  add(face: FontFace): void
  delete?(face: FontFace): boolean
  check(font: string, text?: string): boolean
}

export interface TypographyEnv {
  FontFace?: typeof FontFace
  fonts?: FontFaceSetLike
  now(): number
}

const defaultEnv = (): TypographyEnv => ({
  FontFace: typeof FontFace === 'undefined' ? undefined : FontFace,
  fonts: typeof document === 'undefined' ? undefined : (document.fonts as unknown as FontFaceSetLike),
  now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
})

/** The deadline cancels registration, so a late download cannot swap the fallback. */
export async function prepareTypography({ deadlineMs = 15000, env = defaultEnv() }: { deadlineMs?: number; env?: TypographyEnv } = {}): Promise<TypographyResult> {
  const started = env.now()
  const elapsed = () => Math.round(env.now() - started)
  if (!env.FontFace || !env.fonts) return { ok: false, ms: 0, reason: 'font-loading-api-unavailable' }
  const Face = env.FontFace, fonts = env.fonts
  let faces: FontFace[]
  try {
    faces = FONT_FILES.map(file => new Face(FONT_FAMILY, `url(${file.woff2}) format('woff2'), url(${file.woff}) format('woff')`, {
      weight: file.weight, style: 'normal', unicodeRange: UNICODE_RANGE, display: 'block',
    }))
  } catch { return { ok: false, ms: elapsed(), reason: 'font-construction-failed' } }
  return new Promise<TypographyResult>((resolve) => {
    let settled = false
    const finish = (result: TypographyResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (!result.ok) faces.forEach(face => fonts.delete?.(face))
      resolve(result)
    }
    const timer = setTimeout(() => finish({ ok: false, ms: elapsed(), reason: 'deadline' }), deadlineMs)
    Promise.all(faces.map(face => face.load())).then(() => {
      if (settled) return
      const missing = faces.filter(face => face.status !== 'loaded').map(face => face.weight)
      if (missing.length) { finish({ ok: false, ms: elapsed(), reason: `not-loaded:${missing.join(',')}` }); return }
      faces.forEach(face => fonts.add(face))
      const unchecked = FONT_FILES.filter(file => !fonts.check(`${file.weight} 16px "${FONT_FAMILY}"`, 'iPlex')).map(file => file.weight)
      finish(unchecked.length ? { ok: false, ms: elapsed(), reason: `check-failed:${unchecked.join(',')}` } : { ok: true, ms: elapsed() })
    }).catch((error: unknown) => finish({ ok: false, ms: elapsed(), reason: `load-error:${error instanceof Error ? error.message : String(error)}` }))
  })
}
