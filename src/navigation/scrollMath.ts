/**
 * Rolagem de listas em TV: contas puras + um único animador por elemento.
 *
 * - `centeredTop`: posição que centraliza um item na área visível, limitada
 *   aos limites reais da rolagem (nunca cria espaço artificial).
 * - `revealTop`: rolagem mínima para manter um item dentro da área visível.
 * - `animateScrollTop`: um só movimento ativo por contêiner; um novo destino
 *   substitui o anterior (sem filas nem chamadas concorrentes). Usa só
 *   scrollTop + requestAnimationFrame (Chromium M56).
 */

export const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

/**
 * `topInset`: faixa no topo coberta pelo menu transparente (o conteúdo passa por
 * trás dela); o centro útil é a área visível abaixo dela.
 */
export function centeredTop(itemTop: number, itemHeight: number, viewHeight: number, maxScroll: number, topInset = 0): number {
  return clamp(Math.round(itemTop + itemHeight / 2 - (viewHeight + topInset) / 2), 0, Math.max(0, maxScroll))
}

export function revealTop(current: number, itemTop: number, itemHeight: number, viewHeight: number, pad: number, maxScroll: number, topInset = 0): number {
  let next = current
  if (itemTop - pad - topInset < current) next = itemTop - pad - topInset
  else if (itemTop + itemHeight + pad > current + viewHeight) next = itemTop + itemHeight + pad - viewHeight
  return clamp(Math.round(next), 0, Math.max(0, maxScroll))
}

const DURATION_MS = 130
const active = new WeakMap<HTMLElement, number>()

export function cancelScroll(el: HTMLElement) {
  const id = active.get(el)
  if (id !== undefined) {
    cancelAnimationFrame(id)
    active.delete(el)
  }
}

/** Rola até `target` (ease-out curto). `instant` ou salto longo: posiciona direto. */
export function animateScrollTop(el: HTMLElement, target: number, instant = false) {
  cancelScroll(el)
  const isDoc = typeof document !== 'undefined' && (el === document.documentElement || el === document.body || el === document.scrollingElement)
  const docEl = typeof document !== 'undefined' ? document.documentElement : null
  const body = typeof document !== 'undefined' ? document.body : null
  const max = isDoc
    ? Math.max(0, Math.max(docEl?.scrollHeight ?? 0, body?.scrollHeight ?? 0) - (typeof window !== 'undefined' ? window.innerHeight : 0))
    : Math.max(0, el.scrollHeight - el.clientHeight)
  const to = clamp(Math.round(target), 0, max)
  const from = isDoc
    ? (typeof window !== 'undefined' ? (window.scrollY || window.pageYOffset) : 0) || el.scrollTop || docEl?.scrollTop || 0
    : el.scrollTop
  const distance = to - from
  if (Math.abs(distance) < 1) return
  const apply = (val: number) => {
    if (isDoc) {
      if (typeof window !== 'undefined') window.scrollTo(0, val)
      if (docEl) docEl.scrollTop = val
      if (body) body.scrollTop = val
    } else {
      el.scrollTop = val
    }
  }
  if (instant || Math.abs(distance) > (isDoc && typeof window !== 'undefined' ? window.innerHeight : el.clientHeight) * 1.5) {
    apply(to)
    return
  }
  const start = performance.now()
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / DURATION_MS)
    const eased = 1 - (1 - t) * (1 - t)
    apply(from + distance * eased)
    if (t < 1) active.set(el, requestAnimationFrame(step))
    else active.delete(el)
  }
  active.set(el, requestAnimationFrame(step))
}
