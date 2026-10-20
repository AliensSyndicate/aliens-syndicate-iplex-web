/**
 * Armazenamento local apenas para conveniências (cache de metadados, último
 * perfil usado como DICA). Nunca para autorizar nada. Tolerante a falhas.
 */
export function readJson<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

export function writeJson(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // armazenamento cheio, bloqueado ou indisponível: segue sem cache
  }
}

export function removeKey(key: string): void {
  try {
    window.localStorage.removeItem(key)
  } catch {
    // ignorado
  }
}
