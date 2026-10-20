import { describe, expect, it } from 'vitest'
import { prepareTypography, type TypographyEnv } from './fonts'

class FakeFace {
  status: 'unloaded' | 'loading' | 'loaded' | 'error' = 'unloaded'
  family: string
  weight: string
  static behavior: 'ok' | 'fail' | 'never' = 'ok'
  constructor(family: string, _src: string, d: { weight: string }) {
    this.family = family
    this.weight = d.weight
  }
  load() {
    if (FakeFace.behavior === 'never') return new Promise<this>(() => undefined)
    if (FakeFace.behavior === 'fail') {
      this.status = 'error'
      return Promise.reject(new Error('network'))
    }
    this.status = 'loaded'
    return Promise.resolve(this)
  }
}

function env(check = true): TypographyEnv {
  // Construtor novo a cada teste: cache de faces isolado.
  const Face = class extends FakeFace {}
  return { FontFace: Face as unknown as typeof FontFace, fonts: { add: () => undefined, check: () => check }, now: () => 0 }
}

describe('prepareTypography', () => {
  it('só confirma quando as faces estão carregadas E verificadas', async () => {
    FakeFace.behavior = 'ok'
    expect(await prepareTypography({ env: env(true) })).toEqual({ ok: true, ms: 0 })
  })
  it('promise resolvida não basta: check() falso é falha', async () => {
    FakeFace.behavior = 'ok'
    expect(await prepareTypography({ env: env(false) })).toMatchObject({ ok: false, reason: 'check-failed:400,500,700' })
  })
  it('erro de rede é falha recuperável', async () => {
    FakeFace.behavior = 'fail'
    expect(await prepareTypography({ env: env() })).toMatchObject({ ok: false, reason: 'load-error:network' })
  })
  it('prazo máximo evita bloqueio permanente', async () => {
    FakeFace.behavior = 'never'
    expect(await prepareTypography({ deadlineMs: 5, env: env() })).toMatchObject({ ok: false, reason: 'deadline' })
  })
  it('sem a API de fontes, falha explícita', async () => {
    expect(await prepareTypography({ env: { now: () => 0 } })).toMatchObject({ ok: false, reason: 'font-loading-api-unavailable' })
  })
})
