import { beforeEach, describe, expect, it } from 'vitest'
import { readDailyPick, todayKey, writeDailyPick } from './dailyPick'

beforeEach(() => localStorage.clear())

describe('destaque do dia', () => {
  it('mantém o mesmo título no dia e escolhe outro (nulo) no dia seguinte', () => {
    const day1 = new Date(2026, 9, 28, 10)
    writeDailyPick('k', 'm1', day1)
    expect(readDailyPick('k', new Date(2026, 9, 28, 23, 59))).toBe('m1')
    expect(readDailyPick('k', new Date(2026, 9, 29, 0, 1))).toBeNull()
  })
  it('chave do dia é a data local', () => {
    expect(todayKey(new Date(2026, 0, 5))).toBe('2026-01-05')
  })
})
