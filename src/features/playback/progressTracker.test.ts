import { describe, expect, it } from 'vitest'
import { createProgressTracker } from './progressTracker'

describe('progressTracker', () => {
  it('controla a frequência de gravação', () => {
    let now = 0
    const t = createProgressTracker({ intervalMs: 30000, minDeltaMs: 10000 }, () => now)
    expect(t.shouldSave(15000, 600000)).toBe(true)
    t.markSaved(15000)
    now = 5000
    expect(t.shouldSave(20000, 600000)).toBe(false) // intervalo
    now = 40000
    expect(t.shouldSave(20000, 600000)).toBe(false) // deslocamento < 10 s
    expect(t.shouldSave(40000, 600000)).toBe(true)
  })
  it('pausa/saída força a gravação, mas não sem avanço', () => {
    const t = createProgressTracker({ intervalMs: 30000, minDeltaMs: 10000 }, () => 0)
    t.markSaved(10000)
    expect(t.shouldSave(12000, 600000, true)).toBe(false)
    expect(t.shouldSave(25000, 600000, true)).toBe(true)
  })
  it('sem duração (ao vivo) nunca grava', () => {
    expect(createProgressTracker({ intervalMs: 0, minDeltaMs: 0 }).shouldSave(1000, 0, true)).toBe(false)
  })
})
