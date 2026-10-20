import { USE_MOCKS } from '../config/env'

/** Marca visível de dados de demonstração (somente `vite dev` com mocks). */
export function DevBadge() {
  if (!(import.meta.env.DEV && USE_MOCKS)) return null
  return (
    <div className="iplex-dev-badge" role="note">
      Dados de demonstração · somente desenvolvimento
    </div>
  )
}
