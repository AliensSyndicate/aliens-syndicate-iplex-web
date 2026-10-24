/**
 * Local e temperatura do menu principal. Sem chave de API e sem pedir permissão ao usuário:
 *  - local aproximado pelo IP (geojs.io: cidade e coordenadas);
 *  - temperatura atual (open-meteo.com).
 * Só cidade e coordenadas aproximadas circulam; nada do iPlex (conta, perfil, catálogo) vai nessas chamadas.
 * Qualquer falha (sem rede, serviço fora) devolve null e o menu mostra só o horário.
 */
export interface LocalWeather {
  city: string
  temperature: number
  fetchedAt: number
}

const CACHE_KEY = 'iplex.weather.v1'
export const WEATHER_TTL_MS = 30 * 60_000

type Fetcher = typeof fetch

const withTimeout = async (url: string, fetcher: Fetcher, ms = 8000): Promise<unknown> => {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timer = controller ? setTimeout(() => controller.abort(), ms) : null
  try {
    const response = await fetcher(url, { ...(controller ? { signal: controller.signal } : {}), credentials: 'omit', referrerPolicy: 'no-referrer' })
    if (!response.ok) throw new Error(`weather_${response.status}`)
    return await response.json()
  } finally {
    if (timer) clearTimeout(timer)
  }
}

const num = (value: unknown): number | null => {
  const n = typeof value === 'string' ? Number(value) : value
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

export function readCachedWeather(now = Date.now()): LocalWeather | null {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY)
    const value = raw ? (JSON.parse(raw) as Partial<LocalWeather>) : null
    if (value && typeof value.city === 'string' && typeof value.temperature === 'number' && typeof value.fetchedAt === 'number' && now - value.fetchedAt < WEATHER_TTL_MS) return value as LocalWeather
  } catch {
    /* sem cache */
  }
  return null
}

export async function fetchLocalWeather(fetcher: Fetcher = (...args) => fetch(...args), now = Date.now()): Promise<LocalWeather | null> {
  try {
    const place = (await withTimeout('https://get.geojs.io/v1/ip/geo.json', fetcher)) as Record<string, unknown>
    const lat = num(place.latitude)
    const lon = num(place.longitude)
    const city = typeof place.city === 'string' && place.city.trim() ? place.city.trim() : typeof place.region === 'string' ? place.region.trim() : ''
    if (lat === null || lon === null || !city) return null
    const forecast = (await withTimeout(`https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(2)}&longitude=${lon.toFixed(2)}&current=temperature_2m`, fetcher)) as { current?: { temperature_2m?: unknown } }
    const temperature = num(forecast.current?.temperature_2m)
    if (temperature === null) return null
    const weather: LocalWeather = { city, temperature: Math.round(temperature), fetchedAt: now }
    try {
      window.localStorage.setItem(CACHE_KEY, JSON.stringify(weather))
    } catch {
      /* sem armazenamento */
    }
    return weather
  } catch {
    return null
  }
}
