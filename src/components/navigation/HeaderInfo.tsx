import { useEffect, useState } from 'react'
import { fetchLocalWeather, readCachedWeather, WEATHER_TTL_MS, type LocalWeather } from '../../services/weather/localWeather'
import { formatClock, formatShortDate } from '../../utils/time'

/**
 * Coluna no extremo direito do menu principal: em cima a temperatura, a data e o horário; embaixo a cidade, em fonte
 * menor. Sem rede, só a data e o horário.
 */
export function HeaderInfo() {
  const [now, setNow] = useState(() => Date.now())
  const [weather, setWeather] = useState<LocalWeather | null>(() => readCachedWeather())

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    let alive = true
    const load = () => {
      void fetchLocalWeather().then((value) => alive && value && setWeather(value))
    }
    if (!readCachedWeather()) load()
    const id = setInterval(load, WEATHER_TTL_MS)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [])

  const time = formatClock(now)
  const date = formatShortDate(now)
  return (
    <div className="iplex-header__info" aria-label={weather ? `${weather.temperature} graus, ${date}, ${time}, ${weather.city}` : `${date}, ${time}`} role="status">
      <div className="iplex-header__info-top">
        {weather && <span className="iplex-header__temp">{weather.temperature}°</span>}
        <span className="iplex-header__date">{date}</span>
        <span className="iplex-header__time">{time}</span>
      </div>
      {weather && <span className="iplex-header__city">{weather.city}</span>}
    </div>
  )
}
