const two = (n: number) => (n < 10 ? `0${n}` : String(n))

export function formatClock(ms: number): string {
  const d = new Date(ms)
  return `${two(d.getHours())}:${two(d.getMinutes())}`
}

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

/** Data curta do relógio do menu: "Sex, 13 nov" (sem Intl: a TV antiga nem sempre tem pt-BR completo). */
export function formatShortDate(ms: number): string {
  const d = new Date(ms)
  return `${WEEKDAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]}`
}

export function formatRuntime(minutes: number | null | undefined): string | null {
  if (!minutes || minutes <= 0) return null
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h ? `${h} h ${m ? `${m} min` : ''}`.trim() : `${m} min`
}

/** "28/10/2026 13:05" (sem Intl, para a TV). */
export function formatDateTime(ms: number): string {
  const d = new Date(ms)
  return `${two(d.getDate())}/${two(d.getMonth() + 1)}/${d.getFullYear()} ${two(d.getHours())}:${two(d.getMinutes())}`
}
