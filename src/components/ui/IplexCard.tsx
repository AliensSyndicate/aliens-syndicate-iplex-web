import type { ReactNode } from 'react'
import { classNames } from '../../utils/classNames'

/** Card de superfície (fundo translúcido oficial, raio 48px). Não usar para pôsteres. */
export function IplexCard({ children, compact, className }: { children: ReactNode; compact?: boolean; className?: string }) {
  return <div className={classNames('iplex-card', compact && 'iplex-card--compact', className)}>{children}</div>
}
