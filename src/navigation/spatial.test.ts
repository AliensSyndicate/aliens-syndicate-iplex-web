import { describe, expect, it } from 'vitest'
import { FocusMemory, moveFocus, pickNext, type Rect } from './spatial'

const r = (left: number, top: number, width = 100, height = 100): Rect => ({ left, top, width, height, right: left + width, bottom: top + height })

describe('pickNext', () => {
  const from = r(0, 0)
  it('fica na mesma fileira ao ir para a direita', () => {
    const next = pickNext(from, [{ value: 'below-right', rect: r(120, 200) }, { value: 'same-row', rect: r(500, 0) }], 'right')
    expect(next).toBe('same-row')
  })
  it('desce para o item mais alinhado da fileira de baixo', () => {
    const next = pickNext(from, [{ value: 'far', rect: r(900, 200) }, { value: 'aligned', rect: r(20, 200) }, { value: 'two-rows', rect: r(0, 500) }], 'down')
    expect(next).toBe('aligned')
  })
  it('sem candidato na direção, não move', () => {
    expect(pickNext(from, [{ value: 'x', rect: r(200, 0) }], 'left')).toBeNull()
  })
})

describe('moveFocus com memória de grupo', () => {
  function button(id: string, group: string, rect: Rect) {
    const el = document.createElement('button')
    el.setAttribute('data-nav', '')
    el.setAttribute('data-nav-id', id)
    el.setAttribute('data-nav-group', group)
    el.getBoundingClientRect = () => ({ ...rect, x: rect.left, y: rect.top, toJSON: () => ({}) }) as DOMRect
    document.body.appendChild(el)
    return el
  }
  it('volta ao último item focado na fileira', () => {
    document.body.innerHTML = ''
    const a1 = button('a1', 'row-a', r(0, 0))
    button('a2', 'row-a', r(120, 0))
    const a3 = button('a3', 'row-a', r(240, 0))
    button('b1', 'row-b', r(0, 200))
    const memory = new FocusMemory()
    memory.rememberGroup('row-a', 'a3')
    a1.focus()
    expect(moveFocus('down', memory)).toBe(true)
    expect(document.activeElement?.getAttribute('data-nav-id')).toBe('b1')
    expect(moveFocus('up', memory)).toBe(true)
    expect(document.activeElement).toBe(a3)
  })
  it('diálogo prende o foco no seu escopo', () => {
    document.body.innerHTML = ''
    button('outside', 'x', r(0, 300))
    const scope = document.createElement('div')
    scope.setAttribute('data-nav-scope', '')
    document.body.appendChild(scope)
    const inside = button('inside', 'dialog', r(0, 0))
    scope.appendChild(inside)
    inside.focus()
    expect(moveFocus('down', new FocusMemory())).toBe(false)
    expect(document.activeElement).toBe(inside)
  })
})
