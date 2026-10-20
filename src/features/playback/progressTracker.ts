/**
 * Decide quando gravar progresso: intervalo mínimo e deslocamento mínimo,
 * para evitar gravações excessivas no backend. Puro (testável).
 */
export interface ProgressPolicy {
  intervalMs: number
  minDeltaMs: number
}

export function createProgressTracker(policy: ProgressPolicy, now: () => number = Date.now) {
  let lastSavedAt = -Infinity
  let lastSavedPosition = -Infinity
  return {
    /** Deve gravar agora? `force` (pausa/saída) ignora o intervalo, não o deslocamento. */
    shouldSave(positionMs: number, durationMs: number, force = false): boolean {
      if (!(durationMs > 0) || positionMs < 0) return false
      if (Math.abs(positionMs - lastSavedPosition) < policy.minDeltaMs) return false
      if (!force && now() - lastSavedAt < policy.intervalMs) return false
      return true
    },
    markSaved(positionMs: number) {
      lastSavedAt = now()
      lastSavedPosition = positionMs
    },
  }
}
