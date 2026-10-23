const two = (n: number) => (n < 10 ? `0${n}` : String(n))

export function formatClock(ms: number): string {
  const d = new Date(ms)
  return `${two(d.getHours())}:${two(d.getMinutes())}`
}

export function formatRuntime(minutes: number | null | undefined): string | null {
  if (!minutes || minutes <= 0) return null
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h ? `${h} h ${m ? `${m} min` : ''}`.trim() : `${m} min`
}
