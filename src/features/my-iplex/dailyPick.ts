import { readJson, writeJson } from '../../utils/storage'

interface DailyPick {
  day: string
  id: string
}

const pad = (n: number) => String(n).padStart(2, '0')
/** Dia local (AAAA-MM-DD): o destaque muda uma vez por dia. */
export const todayKey = (now = new Date()) => `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`

/** Destaque já escolhido hoje para este perfil (ou null: ainda não escolhido / outro dia). */
export function readDailyPick(key: string, now = new Date()): string | null {
  const stored = readJson<DailyPick>(key)
  return stored && stored.day === todayKey(now) ? stored.id : null
}

export function writeDailyPick(key: string, id: string, now = new Date()): void {
  writeJson(key, { day: todayKey(now), id } satisfies DailyPick)
}
