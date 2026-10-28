/**
 * Navegação por fileiras para telas de página rolável (Detalhes, Temporadas).
 *
 * Cada fileira é um [data-nav-row]: "x" (padrão, carrossel/botões: esquerda e
 * direita andam nela) ou "list" (itens empilhados: cima e baixo andam nela).
 * Cima/baixo entre fileiras vai sempre para a fileira vizinha (nunca pula
 * seções), entrando no item lembrado ou no mais alinhado na horizontal.
 * A rolagem vertical tem um só dono (o hook; o main leva [data-nav-managed-y]),
 * e a horizontal dos carrosséis continua em spatial.ensureVisible.
 */
import { useCallback, useEffect, useRef } from 'react'
import { isArrow } from '../platform/keys'
import { useKeyHandler } from './FocusProvider'
import { animateScrollTop, revealTop } from './scrollMath'
import { focusElement, navigables } from './spatial'

const PAD = 32

const rowOf = (el: Element | null) => (el ? el.closest<HTMLElement>('[data-nav-row]') : null)
const isList = (row: HTMLElement) => row.getAttribute('data-nav-row') === 'list'
const rowItems = (row: HTMLElement) => navigables(row)

function topInset(): number {
  const header = document.querySelector<HTMLElement>('[data-nav-fixed]')
  return (header ? header.getBoundingClientRect().bottom : 0) + 24
}

/** Rola a página para deixar o item (e, em carrosséis, o título da fileira) à vista. */
export function scrollToItem(el: HTMLElement, rows: HTMLElement[]) {
  const scroller = (document.scrollingElement ?? document.documentElement) as HTMLElement
  const row = rowOf(el)
  const view = window.innerHeight
  const max = Math.max(0, scroller.scrollHeight - view)
  // O primeiro item (primeira fileira ou data-nav-top) SEMPRE leva a página ao topo real (0)
  const isFirstRow = !!row && rows[0] === row
  const toTop = isFirstRow || (!!row && row.hasAttribute('data-nav-top'))
  if (row && toTop && (isList(row) ? rowItems(row)[0] === el : true)) {
    animateScrollTop(scroller, 0)
    return
  }
  const inset = topInset()
  const current = (typeof window !== 'undefined' ? window.scrollY : 0) || scroller.scrollTop || 0
  if (row && rows[rows.length - 1] === row && (!isList(row) || rowItems(row).pop() === el)) {
    animateScrollTop(scroller, max)
    return
  }
  // Meio: rolagem mínima (como o grid do Catálogo). Fileira horizontal: a fileira inteira (título + itens).
  const box = (row && !isList(row) ? row : el).getBoundingClientRect()
  animateScrollTop(scroller, revealTop(current, box.top + current, box.height, view, PAD, max, inset))
}

function closestByX(items: HTMLElement[], x: number): HTMLElement | null {
  let best: HTMLElement | null = null
  let bestDist = Infinity
  for (const item of items) {
    const r = item.getBoundingClientRect()
    const d = Math.abs(r.left + r.width / 2 - x)
    if (d < bestDist) {
      best = item
      bestDist = d
    }
  }
  return best
}

/** Teclas de seta tratadas pelas fileiras; devolve true quando consumiu a tecla. */
export function handleRowKey(key: string, last: WeakMap<HTMLElement, string>): boolean {
  if (document.querySelector('[data-nav-scope]')) return false // diálogo aberto: navegação espacial padrão
  const active = document.activeElement
  if (!(active instanceof HTMLElement) || !active.hasAttribute('data-nav')) return false
  const main = document.querySelector('main')
  if (!main) return false
  const rows = Array.from(main.querySelectorAll<HTMLElement>('[data-nav-row]')).filter((r) => rowItems(r).length > 0)
  if (rows.length === 0) return false
  const row = rowOf(active)
  const goto = (el: HTMLElement | null) => {
    if (!el) return true
    focusElement(el)
    scrollToItem(el, rows)
    return true
  }
  const enter = (target: HTMLElement, from: HTMLElement | null) => {
    const items = rowItems(target)
    const id = last.get(target)
    const remembered = id ? items.find((i) => i.getAttribute('data-nav-id') === id) : undefined
    const preferred = items.find((i) => i.hasAttribute('data-nav-preferred'))
    if (isList(target)) return remembered ?? preferred ?? items[0] ?? null
    const x = from ? from.getBoundingClientRect().left + from.getBoundingClientRect().width / 2 : 0
    return preferred ?? (from ? closestByX(items, x) : null) ?? remembered ?? items[0] ?? null
  }

  // Fora de qualquer fileira (menu superior): Baixo entra na primeira fileira; o resto é padrão.
  if (!row) {
    if (key === 'ArrowDown' && active.closest('[data-nav-fixed]')) return goto(enter(rows[0]!, null))
    return false
  }
  const id = active.getAttribute('data-nav-id')
  if (id) last.set(row, id)
  const items = rowItems(row)
  const index = items.indexOf(active)
  const list = isList(row)
  const horizontal = key === 'ArrowLeft' || key === 'ArrowRight'

  if (horizontal && !list) return goto(items[index + (key === 'ArrowRight' ? 1 : -1)] ?? null) && true
  if (horizontal && list) return true
  if (list) {
    const step = key === 'ArrowDown' ? 1 : -1
    if (items[index + step]) return goto(items[index + step]!)
  }
  const at = rows.indexOf(row)
  const neighbour = rows[at + (key === 'ArrowDown' ? 1 : -1)]
  if (!neighbour) {
    // Como no Catálogo: da primeira fileira, Cima sobe ao menu principal; da última, Baixo não faz nada.
    if (key === 'ArrowUp') {
      const tab = document.querySelector<HTMLElement>('[data-nav-fixed] .iplex-tab.is-active') ?? document.querySelector<HTMLElement>('[data-nav-fixed] [data-nav]')
      if (tab) focusElement(tab)
    }
    return true
  }
  const target = enter(neighbour, active)
  // Subindo para uma lista vinda de baixo, entra pelo último item se não houver memória.
  return goto(target)
}

export function useRowNavigation(enabled = true) {
  const last = useRef(new WeakMap<HTMLElement, string>())
  const handler = useCallback((key: string) => isArrow(key as never) && handleRowKey(key, last.current), [])
  useKeyHandler((key) => handler(key), enabled)

  // Entrada na tela: começa no topo; o primeiro foco (inicial ou restaurado ao voltar) posiciona a rolagem.
  useEffect(() => {
    if (!enabled) return
    window.scrollTo(0, 0)
    const onFirstFocus = (event: FocusEvent) => {
      const el = event.target
      if (!(el instanceof HTMLElement) || !el.hasAttribute('data-nav') || !el.closest('main')) return
      document.removeEventListener('focusin', onFirstFocus)
      const rows = Array.from(document.querySelectorAll<HTMLElement>('main [data-nav-row]'))
      scrollToItem(el, rows)
    }
    document.addEventListener('focusin', onFirstFocus)
    return () => document.removeEventListener('focusin', onFirstFocus)
  }, [enabled])
}
