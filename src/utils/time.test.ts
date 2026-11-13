import { describe, expect, it } from 'vitest'
import { formatShortDate } from './time'

describe('formatShortDate', () => {
  it('dia da semana, dia e mês abreviados em português', () => {
    expect(formatShortDate(new Date(2026, 10, 13, 14, 32).getTime())).toBe('Sex, 13 nov')
    expect(formatShortDate(new Date(2026, 0, 4).getTime())).toBe('Dom, 4 jan')
  })
})
