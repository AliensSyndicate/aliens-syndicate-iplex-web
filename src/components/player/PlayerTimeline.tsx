import { formatTimecode } from '../../features/playback/playerRules'

/**
 * Tempo decorrido — barra — duração total, com os tempos REAIS do player.
 *
 * Navegável (role="slider") somente quando a mídia aceita seek: Esquerda/Direita
 * movem uma prévia e OK confirma (tratados pelo player). A barra preenchida só
 * muda quando o player confirma a posição; prévia e seek pendente aparecem como
 * marcador separado, nunca como posição aplicada.
 */
/** Texto da prévia/seek pendente; o overlay o mostra acima da barra, à direita das informações. */
export function seekHint(positionMs: number, durationMs: number, previewMs: number | null, pendingMs: number | null): string | null {
  const marker = previewMs ?? pendingMs
  if (marker === null) return null
  const withHours = durationMs >= 3_600_000 || positionMs >= 3_600_000
  return previewMs !== null ? `Ir para ${formatTimecode(previewMs, withHours)} · OK confirma` : `Buscando ${formatTimecode(marker, withHours)}…`
}

export function PlayerTimeline({
  positionMs,
  durationMs,
  seekable,
  previewMs,
  pendingMs,
  onBlur,
}: {
  positionMs: number
  durationMs: number
  seekable: boolean
  previewMs: number | null
  pendingMs: number | null
  onBlur?: () => void
}) {
  const known = durationMs > 0
  const withHours = durationMs >= 3_600_000 || positionMs >= 3_600_000
  const pct = known ? Math.min(100, (positionMs / durationMs) * 100) : 0
  const marker = previewMs ?? pendingMs
  const markerPct = known && marker !== null ? Math.min(100, (marker / durationMs) * 100) : null
  const value = Math.round(pct)
  const bar = (
    <>
      <span className="iplex-progress__fill" style={{ width: `${pct}%` }} />
      {markerPct !== null && <span className={pendingMs !== null && previewMs === null ? 'iplex-player__marker is-pending' : 'iplex-player__marker'} style={{ left: `${markerPct}%` }} />}
    </>
  )
  return (
    <div className="iplex-player__timeline">
      <span className="iplex-player__time">{formatTimecode(positionMs, withHours)}</span>
      {seekable && known ? (
        <span className="iplex-player__bar-frame">
          <span
            className="iplex-progress iplex-player__bar iplex-player__bar--seekable iplex-focusable"
            role="slider"
            tabIndex={-1}
            aria-label="Posição"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={value}
            aria-valuetext={`${formatTimecode(positionMs, withHours)} de ${formatTimecode(durationMs, withHours)}`}
            data-nav=""
            data-nav-id="pc-timeline"
            data-nav-group="player-timeline"
            onBlur={onBlur}
          >
            {bar}
          </span>
        </span>
      ) : (
        <span className="iplex-progress iplex-player__bar" role="progressbar" aria-label="Posição" aria-valuemin={0} aria-valuemax={100} {...(known ? { 'aria-valuenow': value } : {})}>
          {bar}
        </span>
      )}
      <span className="iplex-player__time">{formatTimecode(known ? durationMs : 0, withHours)}</span>
    </div>
  )
}
