/**
 * Selo de classificação indicativa brasileira (ClassInd), igual ao do iPlex
 * Control: quadrado com a cor regulamentada de cada faixa e a idade (ou "L").
 */
export type AgeSeal = 'L' | '10' | '12' | '14' | '16' | '18'

/** Faixa brasileira a partir de uma certificação TMDB ou valor da fonte ("L", "Livre", "AL", "A14", "16 anos"…); null se não for uma. */
export function normalizeAgeRating(value: string | null | undefined): AgeSeal | null {
  const raw = (value ?? '').trim().toUpperCase()
  if (!raw) return null
  if (raw === 'L' || raw === 'AL' || raw.startsWith('LIVRE')) return 'L'
  const age = /^A?(10|12|14|16|18)(\s*ANOS)?$/.exec(raw)
  return (age?.[1] as AgeSeal | undefined) ?? null
}

/** Cores regulamentadas (ClassInd / ABNT NBR 15290), usadas somente aqui. */
const SEAL: Record<AgeSeal, { background: string; color: string; border?: string }> = {
  L: { background: '#0C9447', color: '#FFFFFF' },
  '10': { background: '#0F7DC2', color: '#FFFFFF' },
  '12': { background: '#F8C411', color: '#000000' },
  '14': { background: '#E67824', color: '#FFFFFF' },
  '16': { background: '#DB2827', color: '#FFFFFF' },
  '18': { background: '#1D1815', color: '#FFFFFF', border: '1px solid #B7B7B7' },
}

export function AgeRatingBadge({ rating }: { rating: AgeSeal }) {
  return (
    <span className="iplex-age" style={SEAL[rating]} role="img" aria-label={rating === 'L' ? 'Classificação livre' : `Classificação ${rating} anos`}>
      {rating}
    </span>
  )
}
