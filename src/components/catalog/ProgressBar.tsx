/** Barra de progresso (0..1), apenas com cores oficiais. */
export function ProgressBar({ value, label }: { value: number; label?: string }) {
  const pct = Math.max(0, Math.min(1, value)) * 100
  return (
    <span className="iplex-progress" role="progressbar" aria-label={label ?? 'Progresso'} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
      <span className="iplex-progress__fill" style={{ width: `${pct}%` }} />
    </span>
  )
}
