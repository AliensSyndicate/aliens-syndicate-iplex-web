/**
 * Navegação espacial por controle remoto (sem dependência de mouse/hover).
 *
 * - Candidatos: elementos [data-nav] visíveis e habilitados dentro do escopo
 *   ativo (o último [data-nav-scope] aberto, ex.: diálogos — foco preso).
 * - Escolha geométrica: na direção pedida, menor distância no eixo principal
 *   com forte penalidade para desalinhamento (mantém o foco na mesma fileira).
 * - Memória: ao entrar num grupo ([data-nav-group]) vindo de outro, volta ao
 *   último item focado nele (ou ao [data-nav-preferred], ex.: aba ativa).
 * - Rolagem: mantém o item visível em contêineres [data-nav-scroll="x|y"] e
 *   na página, sem depender de scrollIntoView com opções (Chromium 61+).
 */

export type Direction = 'up' | 'down' | 'left' | 'right'

export interface Rect {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

export interface Candidate<T> {
  value: T
  rect: Rect
}

const EPS = 2

export function isVisible(el: HTMLElement): boolean {
  if (el.hidden) return false
  if (el.closest('[hidden],[aria-hidden="true"],[inert]')) return false
  const rect = el.getBoundingClientRect()
  return rect.width > 0 || rect.height > 0 || el.getClientRects().length > 0
}

export function isEnabled(el: HTMLElement): boolean {
  return !(el as HTMLButtonElement).disabled && el.getAttribute('aria-disabled') !== 'true'
}

export function activeScope(doc: Document = document): ParentNode {
  const scopes = doc.querySelectorAll<HTMLElement>('[data-nav-scope]')
  return scopes.length ? scopes[scopes.length - 1]! : doc
}

export function navigables(scope: ParentNode = activeScope()): HTMLElement[] {
  return Array.from(scope.querySelectorAll<HTMLElement>('[data-nav]')).filter((el) => isEnabled(el) && isVisible(el))
}

function inDirection(from: Rect, to: Rect, dir: Direction): boolean {
  switch (dir) {
    case 'right':
      return to.left >= from.right - EPS || (to.left > from.left + EPS && centerX(to) > from.right)
    case 'left':
      return to.right <= from.left + EPS || (to.right < from.right - EPS && centerX(to) < from.left)
    case 'down':
      return to.top >= from.bottom - EPS || (to.top > from.top + EPS && centerY(to) > from.bottom)
    case 'up':
      return to.bottom <= from.top + EPS || (to.bottom < from.bottom - EPS && centerY(to) < from.top)
  }
}

const centerX = (r: Rect) => r.left + r.width / 2
const centerY = (r: Rect) => r.top + r.height / 2

function overlap(a1: number, a2: number, b1: number, b2: number): number {
  return Math.max(0, Math.min(a2, b2) - Math.max(a1, b1))
}

export function score(from: Rect, to: Rect, dir: Direction): number {
  const horizontal = dir === 'left' || dir === 'right'
  const primary = Math.max(
    0,
    dir === 'right' ? to.left - from.right : dir === 'left' ? from.left - to.right : dir === 'down' ? to.top - from.bottom : from.top - to.bottom,
  )
  const aligned = horizontal ? overlap(from.top, from.bottom, to.top, to.bottom) > 0 : overlap(from.left, from.right, to.left, to.right) > 0
  const orthogonal = aligned ? 0 : horizontal ? Math.abs(centerY(to) - centerY(from)) : Math.abs(centerX(to) - centerX(from))
  return horizontal ? primary + orthogonal * 10 : primary * 4 + orthogonal
}

export function pickNext<T>(from: Rect, candidates: Array<Candidate<T>>, dir: Direction): T | null {
  let best: Candidate<T> | null = null
  let bestScore = Infinity
  for (const candidate of candidates) {
    if (!inDirection(from, candidate.rect, dir)) continue
    const s = score(from, candidate.rect, dir)
    if (s < bestScore) {
      best = candidate
      bestScore = s
    }
  }
  return best ? best.value : null
}

export class FocusMemory {
  private readonly groups = new Map<string, string>()
  private readonly routes = new Map<string, string>()

  rememberGroup(group: string, navId: string) {
    this.groups.set(group, navId)
  }
  group(group: string): string | undefined {
    return this.groups.get(group)
  }
  rememberRoute(route: string, navId: string) {
    this.routes.set(route, navId)
  }
  route(route: string): string | undefined {
    return this.routes.get(route)
  }
  forgetRoute(route: string) {
    this.routes.delete(route)
  }
}

const groupOf = (el: Element | null): HTMLElement | null => (el ? el.closest<HTMLElement>('[data-nav-group-root]') : null)

export function groupName(el: Element | null): string | null {
  if (!el) return null
  const own = el.getAttribute('data-nav-group')
  if (own) return own
  return groupOf(el)?.getAttribute('data-nav-group-root') ?? null
}

/** Move o foco na direção. Retorna true quando algo foi focado. */
export function moveFocus(dir: Direction, memory: FocusMemory, doc: Document = document): boolean {
  const scope = activeScope(doc)
  const current = doc.activeElement instanceof HTMLElement && doc.activeElement.hasAttribute('data-nav') ? doc.activeElement : null
  const items = navigables(scope)
  if (!current || !items.includes(current)) {
    const first = initialTarget(scope)
    if (first) focusElement(first)
    return !!first
  }
  const from = current.getBoundingClientRect()
  const next = pickNext(
    from,
    items.filter((el) => el !== current).map((el) => ({ value: el, rect: el.getBoundingClientRect() })),
    dir,
  )
  if (!next) return false
  const fromGroup = groupName(current)
  const toGroup = groupName(next)
  let target = next
  if (toGroup && toGroup !== fromGroup) {
    const members = items.filter((el) => groupName(el) === toGroup)
    const preferred = members.find((el) => el.hasAttribute('data-nav-preferred'))
    const rememberedId = memory.group(toGroup)
    const remembered = rememberedId ? members.find((el) => el.getAttribute('data-nav-id') === rememberedId) : undefined
    target = (dir === 'up' || dir === 'down' ? (remembered ?? preferred) : preferred) ?? next
  }
  focusElement(target)
  return true
}

export function initialTarget(scope: ParentNode = activeScope()): HTMLElement | null {
  const items = navigables(scope)
  // Conteúdo antes do menu fixo: autofocus, depois o primeiro item de <main>.
  return (
    items.find((el) => el.hasAttribute('data-nav-autofocus')) ??
    items.find((el) => !el.closest('[data-nav-fixed]') && !!el.closest('main')) ??
    items[0] ??
    null
  )
}

export function focusElement(el: HTMLElement) {
  try {
    el.focus({ preventScroll: true })
  } catch {
    el.focus()
  }
  ensureVisible(el)
}

/** Mantém o elemento visível nos contêineres roláveis e na janela. */
export function ensureVisible(el: HTMLElement, win: Window = window) {
  const pad = 48
  let node: HTMLElement | null = el.parentElement
  while (node) {
    const axis = node.getAttribute('data-nav-scroll')
    if (axis === 'x' || axis === 'y') {
      const box = node.getBoundingClientRect()
      const r = el.getBoundingClientRect()
      if (axis === 'x') {
        const startPad = Number(node.getAttribute('data-nav-scroll-pad')) || pad
        if (r.left < box.left + startPad) node.scrollLeft -= box.left + startPad - r.left
        else if (r.right > box.right - pad) node.scrollLeft += r.right - (box.right - pad)
      } else {
        // 'padding': o início da área rolável fica sob o menu transparente (padding-top).
        const startPad = node.getAttribute('data-nav-scroll-pad') === 'padding' ? parseFloat(getComputedStyle(node).paddingTop) || pad : pad
        if (r.top < box.top + startPad) node.scrollTop -= box.top + startPad - r.top
        else if (r.bottom > box.bottom - pad) node.scrollTop += r.bottom - (box.bottom - pad)
      }
    }
    node = node.parentElement
  }
  if (el.closest('[data-nav-fixed]')) return
  const r = el.getBoundingClientRect()
  const top = Number(getComputedStyle(document.documentElement).getPropertyValue('--iplex-content-top').replace('px', '')) || 120
  if (r.top < top) win.scrollBy(0, r.top - top)
  else if (r.bottom > win.innerHeight - pad) win.scrollBy(0, r.bottom - (win.innerHeight - pad))
}
