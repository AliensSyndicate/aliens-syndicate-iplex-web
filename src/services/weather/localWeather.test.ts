import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchLocalWeather, readCachedWeather, WEATHER_TTL_MS } from './localWeather'

const reply = (body: unknown, ok = true) => ({ ok, status: ok ? 200 : 503, json: async () => body })

describe('local e temperatura', () => {
  beforeEach(() => window.localStorage.clear())
  it('junta a cidade (por IP) com a temperatura atual e guarda em cache', async () => {
    const fetcher = vi.fn(async (url: string) => (url.includes('geojs') ? reply({ city: 'São Paulo', latitude: '-23.55', longitude: '-46.63' }) : reply({ current: { temperature_2m: 23.6 } })))
    const weather = await fetchLocalWeather(fetcher as never, 1000)
    expect(weather).toEqual({ city: 'São Paulo', temperature: 24, fetchedAt: 1000 })
    expect(readCachedWeather(1000 + 60_000)).toEqual(weather)
    expect(readCachedWeather(1000 + WEATHER_TTL_MS + 1)).toBeNull()
    // Só coordenadas aproximadas na consulta do tempo.
    expect(String(fetcher.mock.calls[1]![0])).toContain('latitude=-23.55&longitude=-46.63')
  })
  it('qualquer falha devolve null (o menu mostra só o horário)', async () => {
    expect(await fetchLocalWeather((async () => reply({}, false)) as never)).toBeNull()
    expect(await fetchLocalWeather((async () => { throw new Error('offline') }) as never)).toBeNull()
    expect(await fetchLocalWeather((async (url: string) => (url.includes('geojs') ? reply({ city: 'X' }) : reply({}))) as never)).toBeNull()
  })
})
