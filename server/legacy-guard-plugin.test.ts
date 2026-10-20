import { describe, expect, it } from 'vitest'
import { rewriteLegacyGuard } from './legacy-guard-plugin'

describe('legacy guard sem data:', () => {
  it('troca o import data: por módulo do próprio site', () => {
    const code = `import'data:text/javascript,"assets/x.js";if(!import.meta.resolve)throw Error("import.meta.resolve not supported")';export function __vite_legacy_guard(){}`
    expect(rewriteLegacyGuard(code)).toBe(`import'/assets/import-meta-resolve-guard.js';export function __vite_legacy_guard(){}`)
  })
  it('não altera código sem o guard', () => {
    expect(rewriteLegacyGuard('const a = 1')).toBe('const a = 1')
  })
})
