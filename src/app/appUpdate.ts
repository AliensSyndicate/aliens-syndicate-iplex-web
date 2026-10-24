/**
 * Atualização do próprio app: a TV costuma só suspender e retomar o iPlex (a página não recarrega), então uma
 * publicação nova não chegava. Ao voltar para a tela, e a cada 10 minutos, comparamos os arquivos principais
 * carregados (index-*.js e style-*.css, com hash no nome) com os do index.html publicado. Se algum já não existe
 * lá, há versão nova e a página recarrega (nunca no meio de uma reprodução).
 */
const NAME = /assets\/((?:index|style)-[A-Za-z0-9_-]+\.(?:js|css))/g

export function namesIn(text: string): Set<string> {
  const out = new Set<string>()
  NAME.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = NAME.exec(text))) out.add(match[1]!)
  return out
}

/** Arquivos principais que ESTA página carregou (scripts, scripts legados e folhas de estilo). */
export function loadedNames(doc: Document = document): Set<string> {
  const refs: string[] = []
  doc.querySelectorAll('script').forEach((s) => refs.push(s.getAttribute('src') ?? '', s.getAttribute('data-src') ?? ''))
  doc.querySelectorAll('link[rel="stylesheet"]').forEach((l) => refs.push(l.getAttribute('href') ?? ''))
  return namesIn(refs.join('\n'))
}

/** Há versão nova? Só quando algo carregado já não existe no index.html publicado (sem nomes carregados: nunca). */
export function isOutdated(loaded: Set<string>, latest: Set<string>): boolean {
  if (loaded.size === 0 || latest.size === 0) return false
  for (const name of loaded) if (!latest.has(name)) return true
  return false
}

export async function checkForUpdate(fetcher: typeof fetch = (...args) => fetch(...args)): Promise<boolean> {
  try {
    const response = await fetcher(`/index.html?t=${Date.now()}`, { cache: 'no-store', credentials: 'omit' })
    if (!response.ok) return false
    return isOutdated(loadedNames(), namesIn(await response.text()))
  } catch {
    return false
  }
}
