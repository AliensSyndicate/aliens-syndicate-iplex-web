import { describe, expect, it, vi } from 'vitest'
import { checkForUpdate, isOutdated, namesIn } from './appUpdate'

describe('atualização do app', () => {
  const html = '<script type="module" src="/assets/index-AAA111.js"></script><link rel="stylesheet" href="/assets/style-BBB222.css"><script nomodule data-src="/assets/index-legacy-CCC333.js"></script><link href="/assets/google-sans-latin-400-normal-x.woff2">'
  it('lê só os arquivos principais (index e style)', () => {
    expect([...namesIn(html)].sort()).toEqual(['index-AAA111.js', 'index-legacy-CCC333.js', 'style-BBB222.css'])
  })
  it('versão nova só quando algo carregado sumiu do index publicado', () => {
    const loaded = new Set(['index-AAA111.js', 'style-BBB222.css'])
    expect(isOutdated(loaded, namesIn(html))).toBe(false)
    expect(isOutdated(loaded, namesIn(html.replaceAll('AAA111', 'ZZZ999')))).toBe(true)
    expect(isOutdated(new Set(), namesIn(html))).toBe(false)
    expect(isOutdated(loaded, new Set())).toBe(false)
  })
  it('falha de rede nunca recarrega', async () => {
    expect(await checkForUpdate((async () => { throw new Error('offline') }) as never)).toBe(false)
    expect(await checkForUpdate((async () => ({ ok: false })) as never)).toBe(false)
    expect(await checkForUpdate(vi.fn(async () => ({ ok: true, text: async () => html })) as never)).toBe(false) // página de teste sem arquivos carregados
  })
})
