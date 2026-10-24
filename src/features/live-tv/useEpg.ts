import { useEffect, useState } from 'react'
import { useBackend } from '../../app/providers/BackendProvider'
import type { CatalogItem, EpgResult, Programme } from '../../services/api/types'

/** Programação do canal (EPG da fonte IPTV via backend). `null` enquanto carrega ou sem EPG para o canal. */
export function useEpg(channel: CatalogItem | null): EpgResult | null {
  const { backend } = useBackend()
  const [result, setResult] = useState<EpgResult | null>(null)
  const id = channel?.id
  const sourceId = channel?.sourceId
  const epgId = channel?.epgId
  useEffect(() => {
    setResult(null)
    if (!sourceId || !epgId) return
    let alive = true
    // Pequeno atraso: percorrer o grid não dispara uma consulta por canal.
    const timer = setTimeout(() => {
      backend.readEpg(sourceId, epgId).then(
        (value) => alive && setResult(value),
        () => alive && setResult({ supported: false }),
      )
    }, 400)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [backend, id, sourceId, epgId])
  return result
}

export function nowNext(programmes: Programme[], now: number) {
  const current = programmes.find((p) => p.startAt <= now && p.endAt > now) ?? null
  const next = programmes.find((p) => p.startAt >= (current?.endAt ?? now)) ?? null
  return { current, next }
}
