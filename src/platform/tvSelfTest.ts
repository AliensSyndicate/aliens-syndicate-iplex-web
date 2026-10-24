/**
 * Roteiro de verificação das telas Filmes/Séries na TV (somente leitura).
 *
 * Só roda dentro do shell com `?diag=1&selftest=1` (mesmo canal de diagnóstico
 * de diagnostics.ts: o relatório chega ao Mac em build/logs/tv-*.log). Envia
 * teclas sintéticas à janela, como o controle remoto, e mede o resultado
 * (foco, rolagem, estilos, sobreposição). Não altera dados nem a conta: só
 * navega, troca categoria/ordenação na própria tela e abre/volta de um detalhe.
 */
import type { Backend } from '../services/api/backend'
import { readJson } from '../utils/storage'
import { probeCatalogCache, probeCatalogSets } from './catalogSetsProbe'
import { diag } from './diagnostics'

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)
const all = (selector: string) => Array.from(document.querySelectorAll<HTMLElement>(selector))

function press(key: string) {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
}

async function keys(key: string, count: number, gap = 80) {
  for (let i = 0; i < count; i += 1) {
    press(key)
    await sleep(gap)
  }
}

/** Espera a rolagem estabilizar (mesmo valor por 3 leituras) e devolve o tempo gasto. */
async function settle(el: HTMLElement | null, limit = 1500) {
  const start = Date.now()
  let last = -1
  let same = 0
  while (Date.now() - start < limit) {
    const now = el ? Math.round(el.scrollTop) : 0
    same = now === last ? same + 1 : 0
    if (same >= 3) break
    last = now
    await sleep(40)
  }
  return Date.now() - start
}

const label = (el: Element | null) => (el ? `${(el as HTMLElement).dataset.navId ?? el.tagName}:${(el.textContent ?? '').trim().slice(0, 18)}` : 'none')

function snapshot() {
  const active = document.activeElement as HTMLElement | null
  const content = $('.iplex-catalog__content')
  const side = $('.iplex-catalog__side')
  const rect = active ? active.getBoundingClientRect() : null
  const cr = content ? content.getBoundingClientRect() : null
  const sr = side ? side.getBoundingClientRect() : null
  return {
    a: label(active),
    gi: active?.dataset.gridIndex ?? '-',
    content: content ? `${Math.round(content.scrollTop)}/${content.scrollHeight - content.clientHeight}` : '-',
    side: side ? `${Math.round(side.scrollTop)}/${side.scrollHeight - side.clientHeight}` : '-',
    rect: rect ? `${Math.round(rect.top)},${Math.round(rect.bottom)}` : '-',
    contentBox: cr ? `${Math.round(cr.top)},${Math.round(cr.bottom)}` : '-',
    sideBox: sr ? `${Math.round(sr.top)},${Math.round(sr.bottom)}` : '-',
  }
}

const fmt = (o: Record<string, string>) => Object.keys(o).map((k) => `${k}=${o[k]}`).join(' ')
const report = (name: string, detail: Record<string, string>) => diag(`st:${name}`, fmt(detail))

function inView(rect: string, box: string) {
  const [t, b] = rect.split(',').map(Number)
  const [bt, bb] = box.split(',').map(Number)
  return t! >= bt! - 1 && b! <= bb! + 1
}

function styles(el: HTMLElement | null) {
  if (!el) return 'none'
  const c = getComputedStyle(el)
  return `fs=${c.fontSize} color=${c.color} bg=${c.backgroundColor} border=${c.borderTopWidth}/${c.borderTopColor} tf=${c.transform} shadow=${c.boxShadow.slice(0, 40)}`
}

function overlaps() {
  const rects = all('[data-grid-index]').map((el) => el.getBoundingClientRect())
  let count = 0
  for (let i = 0; i < rects.length; i += 1) {
    for (let j = i + 1; j < rects.length; j += 1) {
      const a = rects[i]!
      const b = rects[j]!
      if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) count += 1
    }
  }
  return `${count} of ${rects.length}`
}

async function waitFor(test: () => boolean, limit = 15000) {
  const start = Date.now()
  while (Date.now() - start < limit) {
    if (test()) return true
    await sleep(100)
  }
  return false
}

async function goTo(tab: string) {
  const find = () => all('.iplex-header__capsule .iplex-tab').find((b) => (b.textContent ?? '').trim() === tab)
  await waitFor(() => !!find(), 40000)
  const button = find()
  if (!button) return false
  button.focus()
  button.click()
  await sleep(300)
  const ok = await waitFor(() => !!$('.iplex-catalog__side') && all('[data-side-item]').length > 0 && !!document.activeElement && (document.activeElement as HTMLElement).hasAttribute('data-side-item'), 20000)
  await sleep(400)
  return ok
}

async function runScreen(tab: string) {
  const t = tab.toLowerCase()
  if (!(await goTo(tab))) return report(`${t}:enter`, { fail: 'tela não abriu ou foco inicial ausente', ...snapshot() })

  // 1/2 Entrada: foco inicial e item selecionado (primeira coleção com conteúdo).
  const items = all('[data-side-item]')
  const selected = items.filter((i) => i.dataset.sideSelected === 'true')
  const firstFilled = items.map((i) => (i.textContent ?? '').trim()).join('|')
  const firstCard = $('[data-grid-index]')
  const sameRow = all('[data-grid-index]').filter((c) => firstCard && Math.abs(c.getBoundingClientRect().top - firstCard.getBoundingClientRect().top) < 2).length
  const names = items.map((i) => (i.textContent ?? '').trim()).join('|')
  for (let i = 0; i < names.length; i += 360) report(`${t}:menu-${Math.floor(i / 360)}`, { names: names.slice(i, i + 360) })
  const tile = $('.iplex-tile--poster')
  const frame = $('.iplex-tile--poster .iplex-tile__frame')
  report(`${t}:radius`, { tile: tile ? getComputedStyle(tile).borderTopLeftRadius : '-', frame: frame ? getComputedStyle(frame).borderTopLeftRadius : '-', borderW: tile ? getComputedStyle(tile).borderTopWidth : '-' })
  const count = $('.iplex-catalog__count')
  report(`${t}:header`, { title: ($('h1')?.textContent ?? '').trim(), count: (count?.textContent ?? 'none').trim(), countColor: count ? getComputedStyle(count).color : '-', selectedMenu: (selected[0]?.textContent ?? '').trim() })
  report(`${t}:layout`, { h1: ($('h1')?.textContent ?? '').trim(), sideWidth: String(Math.round($('.iplex-catalog__side')?.getBoundingClientRect().width ?? 0)), cardsPerRow: String(sameRow), skeletons: String(all('.iplex-skeleton').length), headerTransparent: getComputedStyle($('.iplex-header') as HTMLElement, '::before').display, scrollerPadTop: getComputedStyle($('.iplex-catalog__content') as HTMLElement).paddingTop, mask: getComputedStyle($('.iplex-catalog__content') as HTMLElement).webkitMaskImage ?? 'n/a' })
  report(`${t}:enter`, { ...snapshot(), selected: selected.map((i) => (i.textContent ?? '').trim()).join('+'), selCount: String(selected.length), focusIsSelected: String(document.activeElement === selected[0]), menu: firstFilled.slice(0, 160) })
  report(`${t}:styles`, {
    selectedItem: styles(selected[0] ?? null),
    otherItem: styles(items.find((i) => i.dataset.sideSelected !== 'true') ?? null),
    headerActive: styles($('.iplex-header .iplex-tab.is-active')),
    chipSelected: styles($('.iplex-chip.is-active')),
    chipOther: styles(all('.iplex-chip').find((c) => !c.classList.contains('is-active')) ?? null),
  })

  // 3/4/5 Menu lateral do primeiro ao último, centralização e extremidades.
  const sideEl = $('.iplex-catalog__side')
  const trace: string[] = []
  const total = items.length
  for (let i = 0; i < total + 2; i += 1) {
    press('ArrowDown')
    await sleep(120)
    await settle(sideEl, 600)
    const s = snapshot()
    const rect = s.rect.split(',').map(Number)
    const box = s.sideBox.split(',').map(Number)
    const mid = (rect[0]! + rect[1]!) / 2
    const center = (box[0]! + box[1]!) / 2
    trace.push(`${Math.round(mid - center)}${inView(s.rect, s.sideBox) ? '' : '!'}`)
  }
  report(`${t}:side-down`, { offsetFromCenter: trace.join(','), end: JSON.stringify(snapshot()) })
  const upTrace: string[] = []
  for (let i = 0; i < total + 1; i += 1) {
    press('ArrowUp')
    await sleep(120)
    await settle(sideEl, 600)
    const s = snapshot()
    upTrace.push(s.a.split(':')[0]! + '@' + s.side)
  }
  report(`${t}:side-up`, { trace: upTrace.slice(-4).join(' ') })
  // Volta ao menu lateral (Baixo no cabeçalho) e posiciona no item selecionado.
  press('ArrowDown')
  await sleep(300)

  // 6/7/8/9 Lateral → grid, muitas linhas, topo e fim reais.
  const grid = $('.iplex-catalog__content')
  press('ArrowRight')
  await sleep(300)
  const entered = snapshot()
  const focused = document.activeElement as HTMLElement | null
  const neighbour = focused?.nextElementSibling as HTMLElement | null
  const fr = focused?.getBoundingClientRect()
  const nr = neighbour?.getBoundingClientRect()
  report(`${t}:to-grid`, { ...entered, focusedCard: styles(focused), neighbourCard: styles(neighbour), sameSize: String(!!fr && !!nr && Math.round(fr.width) === Math.round(nr.width) && Math.round(fr.height) === Math.round(nr.height)), selectedSideKept: String(all('[data-side-selected="true"]').length) })
  await keys('ArrowRight', 8, 60)
  const right = snapshot()
  report(`${t}:right-limit`, { gi: right.gi, expectedCol: '5', col: String(Number(right.gi) % 6) })
  const downTrace: string[] = []
  for (let i = 0; i < 14; i += 1) {
    const t0 = Date.now()
    press('ArrowDown')
    await sleep(60)
    const ms = await settle(grid, 1200)
    const s = snapshot()
    downTrace.push(`${s.gi}|st=${s.content.split('/')[0]}|${inView(s.rect, s.contentBox) ? 'ok' : 'FORA'}|${ms}ms`)
    if (Date.now() - t0 > 4000) break
  }
  report(`${t}:grid-down`, { trace: downTrace.join(' ; ') })
  const behind = all('[data-grid-index]').filter((c) => c.getBoundingClientRect().top < 160 && c.getBoundingClientRect().bottom > 0).length
  report(`${t}:behind-header`, { cardsVisibleBehindHeader: String(behind), scroll: snapshot().content })
  report(`${t}:overlap`, { overlapping: overlaps(), cardW: String(Math.round(($('[data-grid-index]')?.getBoundingClientRect().width ?? 0))) })
  // Fim real: segura Baixo até o limite.
  await keys('ArrowDown', 60, 35)
  await settle(grid, 3000)
  const bottom = snapshot()
  report(`${t}:bottom`, { ...bottom, atMax: String(bottom.content.split('/')[0] === bottom.content.split('/')[1]) })
  // Topo real: segura Cima até a ordenação e confirma início da área rolável.
  await keys('ArrowUp', 90, 35)
  await settle(grid, 3000)
  const top = snapshot()
  report(`${t}:top`, { ...top, atZero: String(top.content.split('/')[0] === '0') })

  // 11 Ordenação: muda com Enter, mantém foco e volta o catálogo ao início.
  const chips = all('[data-sort-index]')
  if (chips.length > 1) {
    const other = chips.find((c) => c.dataset.sortSelected !== 'true')!
    other.focus()
    await sleep(150)
    ;(document.activeElement as HTMLElement).click()
    await sleep(600)
    report(`${t}:sort`, { ...snapshot(), selectedChips: String(all('[data-sort-selected="true"]').length), selected: label(all('[data-sort-selected="true"]')[0] ?? null) })
    const back = chips.find((c) => c.dataset.sortSelected !== 'true')
    back?.focus()
    back?.click()
    await sleep(500)
  }

  // 10 Troca de categoria: confirma outra coleção; catálogo volta ao topo, uma só selecionada.
  const side = all('[data-side-item]')
  const target = side.find((s) => (s.dataset.navId ?? '').indexOf('side-cat:') === 0 && s.dataset.sideSelected !== 'true') ?? side[side.length - 1]!
  target.focus()
  await sleep(250)
  target.click()
  await sleep(900)
  await settle(grid, 1500)
  report(`${t}:category`, { ...snapshot(), selected: label(all('[data-side-selected="true"]')[0] ?? null), selCount: String(all('[data-side-selected="true"]').length), focusInSide: String(!!document.activeElement?.hasAttribute('data-side-item')) })

  // 12 Imagem ausente/falha: nomes dentro do card, sem estourar a moldura.
  const fallbacks = all('.iplex-artwork__fallback')
  const overflowing = fallbacks.filter((f) => f.scrollHeight > f.clientHeight + 1 || f.scrollWidth > f.clientWidth + 1).length
  report(`${t}:fallback`, { cardsWithNameInside: String(fallbacks.length), overflowing: String(overflowing), sample: (fallbacks[0]?.textContent ?? '').slice(0, 30), color: fallbacks[0] ? getComputedStyle(fallbacks[0]).color : '-' })

  // 9 Fim real da área rolável (categoria já carregada, sem novas páginas).
  press('ArrowRight')
  await sleep(250)
  await keys('ArrowDown', 80, 35)
  await sleep(1500)
  await settle(grid, 3000)
  const end = snapshot()
  const behindMid = all('[data-grid-index]').filter((c) => c.getBoundingClientRect().top < 160 && c.getBoundingClientRect().bottom > 0).length
  report(`${t}:category-bottom`, { cardsPerRow: String(all('[data-grid-index]').filter((c) => Math.abs(c.getBoundingClientRect().top - (all('[data-grid-index]')[0]?.getBoundingClientRect().top ?? 0)) < 2).length), behindHeader: String(behindMid), ...end, atMax: String(end.content.split('/')[0] === end.content.split('/')[1]), visible: String(inView(end.rect, end.contentBox)) })
  await keys('ArrowUp', 80, 35)
  await settle(grid, 3000)
  report(`${t}:category-top`, { ...snapshot() })
  await keys('ArrowDown', 1, 100)
  press('ArrowLeft')
  await sleep(300)
  press('ArrowRight')
  await sleep(300)

  // 15 Repetição rápida de teclas.
  press('ArrowRight')
  await sleep(250)
  await keys('ArrowDown', 40, 25)
  await settle(grid, 3000)
  const rapid = snapshot()
  report(`${t}:rapid`, { ...rapid, focusLost: String(rapid.a.startsWith('BODY') || rapid.a.startsWith('none')), visible: String(inView(rapid.rect, rapid.contentBox)) })

  // 16 Detalhes e retorno ao mesmo card.
  const before = snapshot()
  const card = document.activeElement as HTMLElement
  if (card?.dataset.gridIndex !== undefined) {
    card.click()
    const opened = await waitFor(() => !$('.iplex-catalog__content'), 8000)
    await sleep(800)
    press('Escape')
    const returned = await waitFor(() => !!$('.iplex-catalog__content') && all('[data-grid-index]').length > 0, 10000)
    await sleep(1200)
    const after = snapshot()
    report(`${t}:details-return`, { opened: String(opened), returned: String(returned), before: `${before.gi}@${before.content}`, after: `${after.gi}@${after.content}`, sameCard: String(before.a === after.a), visible: String(inView(after.rect, after.contentBox)) })
  }
}

/** Detalhes de série: selo/gêneros, botões, ausência de episódios e tela Temporadas. */
async function runDetails() {
  const t = 'detalhes'
  // Continua na tela Séries (foco no card de onde runScreen voltou dos detalhes).
  await sleep(500)
  const card = document.activeElement as HTMLElement
  if (card?.dataset.gridIndex === undefined) return report(`${t}:enter`, { fail: 'sem card focado', ...snapshot() })
  try {
    const client = (window as unknown as { __iplexTmdb?: { match: (k: 'series', t: string, y: number | null, i: { sourceId: string; id: string }) => Promise<unknown> } }).__iplexTmdb
    const found = await client?.match('series', 'Breaking Bad', null, { sourceId: 'probe', id: 'probe' })
    report(`${t}:tmdb-probe`, { result: JSON.stringify(found).slice(0, 200) })
  } catch (error) {
    report(`${t}:tmdb-probe`, { error: String((error as Error)?.message ?? error) })
  }
  // Procura um título com correspondência no TMDB (elenco/equipe/recomendações) entre os próximos cards.
  for (let tries = 0; tries < 4; tries++) {
    ;(document.activeElement as HTMLElement).click()
    if (!(await waitFor(() => !!$('.iplex-details__actions'), 15000))) return report(`${t}:open`, { fail: 'detalhes não abriram' })
    await waitFor(() => all('.iplex-details .iplex-row').length >= 2, 6000)
    await sleep(800)
    report(`${t}:try${tries}`, { title: ($('h1')?.textContent ?? '').trim().slice(0, 30), rows: String(all('.iplex-details .iplex-row').length), tmdbAttribution: String(!!$('.iplex-details__attribution')), buttons: all('.iplex-details__actions .iplex-button').map((b) => (b.textContent ?? '').trim()).join('|') })
    if (all('.iplex-details .iplex-row').length >= 2 && all('.iplex-details__actions .iplex-button').some((b) => (b.textContent ?? '').trim() === 'Temporadas')) break
    press('Escape')
    await waitFor(() => !!$('.iplex-catalog__content') && all('[data-grid-index]').length > 0, 10000)
    await sleep(1000)
    press(tries % 2 ? 'ArrowDown' : 'ArrowRight')
    await sleep(400)
  }
  if (!$('.iplex-details__actions')) return report(`${t}:open`, { fail: 'nenhum título com elenco/equipe nos 4 testados' })
  const buttons = all('.iplex-details__actions .iplex-button')
  const seal = $('.iplex-age')
  report(`${t}:rows`, { rows: all('.iplex-details .iplex-row').map((r) => (r.querySelector('.iplex-row__title')?.textContent ?? '').trim()).join('|') })
  const gap = ($('.iplex-details__overview')?.getBoundingClientRect().bottom ?? 0)
  report(`${t}:info`, { buttons: buttons.map((b) => (b.textContent ?? '').trim()).join('|'), focused: label(document.activeElement), seal: seal ? `${(seal.textContent ?? '').trim()}@${getComputedStyle(seal).backgroundColor}` : 'none', genres: all('.iplex-details__genre').map((g) => (g.textContent ?? '').trim()).join(','), episodesOnDetails: String(all('.iplex-episode').length), gapOverviewToButtons: String(Math.round((buttons[0]?.getBoundingClientRect().top ?? 0) - gap)), backdrop: String(!!$('.iplex-details__backdrop img')) })
  const trail: string[] = []
  for (let i = 0; i < 8; i++) {
    press('ArrowDown')
    await sleep(400)
    trail.push(`${label(document.activeElement)}@y${Math.round(window.scrollY)}`)
  }
  report(`${t}:walk-down`, { trail: trail.join(' > ') })
  const up: string[] = []
  for (let i = 0; i < 8; i++) {
    press('ArrowUp')
    await sleep(400)
    up.push(`${label(document.activeElement)}@y${Math.round(window.scrollY)}`)
  }
  report(`${t}:walk-up`, { trail: up.join(' > ') })
  press('ArrowDown')
  await sleep(500)
  const seasons = buttons.find((b) => (b.textContent ?? '').trim() === 'Temporadas')
  if (!seasons) return report(`${t}:seasons`, { fail: 'sem botão Temporadas (filme?)' })
  for (let i = 0; i < 6 && document.activeElement !== seasons; i++) {
    press('ArrowRight')
    await sleep(250)
  }
  report(`${t}:seasons-focus`, { onSeasons: String(document.activeElement === seasons), focused: label(document.activeElement) })
  seasons.click()
  const opened = await waitFor(() => all('.iplex-episode').length > 0, 15000)
  await sleep(1200)
  report(`${t}:seasons`, { opened: String(opened), episodes: String(all('.iplex-episode').length), chips: String(all('.iplex-chips .iplex-chip').length), focused: label(document.activeElement) })
  const eps: string[] = []
  for (let i = 0; i < 24; i++) {
    press('ArrowDown')
    await sleep(150)
    if (i === 0 || i === 9 || i === 22) eps.push(`${label(document.activeElement)}@y${Math.round(window.scrollY)}`)
  }
  report(`${t}:seasons-down`, { trail: eps.join(' > ') })
  const epsUp: string[] = []
  for (let i = 0; i < 26; i++) {
    press('ArrowUp')
    await sleep(150)
    if (i === 0 || i === 4 || i >= 22) epsUp.push(`${label(document.activeElement)}@y${Math.round(window.scrollY)}`)
  }
  report(`${t}:seasons-up`, { trail: epsUp.join(' > ') })
  press('ArrowDown')
  await sleep(400)
  press('Escape')
  const back = await waitFor(() => !!$('.iplex-details__actions'), 8000)
  await sleep(3000)
  report(`${t}:back`, { back: String(back), focused: label(document.activeElement) })
}

/** Busca: mínimo de 3 letras, ordem das categorias, grid de 5, navegação, lado esquerdo fixo e recentes. */
async function runSearch() {
  const t = 'busca'
  const tab = all('.iplex-header__capsule .iplex-tab').find((b) => b.dataset.navId === 'tab-search')
  if (!tab) return report(`${t}:enter`, { fail: 'aba Busca não encontrada' })
  tab.focus()
  tab.click()
  if (!(await waitFor(() => !!$('#iplex-search-input'), 15000))) return report(`${t}:enter`, { fail: 'tela não abriu' })
  await sleep(800)
  const side = $('.iplex-search__side')
  const type = async (text: string) => {
    for (const ch of text) {
      $(`[data-nav-id="key-${ch}"]`)?.click()
      await sleep(120)
    }
  }
  await type('ab')
  await sleep(1200)
  report(`${t}:min2`, { sections: String(all('[data-sr-block]').length), cells: String(all('[data-sr-cell]').length), hint: ($('.iplex-search__content')?.textContent ?? '').slice(0, 60) })
  await type('a')
  await sleep(1500)
  const blocks = all('[data-sr-block]').map((b) => `${b.dataset.srBlock}:${(b.querySelector('.iplex-catalog__count')?.textContent ?? '').trim()}/${b.querySelectorAll('[data-sr-cell]').length}`)
  const firstRow = all('[data-sr-cell]').filter((c) => Math.abs(c.getBoundingClientRect().top - (all('[data-sr-cell]')[0]?.getBoundingClientRect().top ?? 0)) < 2).length
  const lastKey = $('[data-nav-id="key-clear"]')?.getBoundingClientRect()
  report(`${t}:min3`, { blocks: blocks.join('|'), perRow: String(firstRow), sideScrollable: String(!!side && side.scrollHeight > side.clientHeight + 1), side: `${side?.scrollHeight}/${side?.clientHeight}`, lastKeyBottom: String(Math.round(lastKey?.bottom ?? 0)), vh: String(window.innerHeight), resultsWidth: String(Math.round($('.iplex-search__content')?.getBoundingClientRect().width ?? 0)) })
  // Navegação: teclado → resultados → descer até o fim → voltar ao campo.
  const input = $('#iplex-search-input')
  input?.focus()
  press('ArrowRight')
  await sleep(300)
  const trail: string[] = [label(document.activeElement)]
  for (let i = 0; i < 12; i++) {
    press('ArrowDown')
    await sleep(250)
    trail.push(`${label(document.activeElement)}@y${Math.round($('.iplex-search__content')?.scrollTop ?? 0)}`)
  }
  report(`${t}:down`, { trail: trail.join(' > ') })
  const up: string[] = []
  for (let i = 0; i < 14; i++) {
    press('ArrowUp')
    await sleep(250)
    up.push(`${label(document.activeElement)}@y${Math.round($('.iplex-search__content')?.scrollTop ?? 0)}`)
  }
  report(`${t}:up`, { trail: up.slice(-6).join(' > ') })
  // Recentes com o campo vazio.
  $('[data-nav-id="key-clear"]')?.click()
  await sleep(1200)
  report(`${t}:recents`, { title: ($('[data-sr-block="recents"] h2')?.textContent ?? '').trim(), cells: String(all('[data-sr-block="recents"] [data-sr-cell]').length), blocks: all('[data-sr-block]').map((b) => b.dataset.srBlock).join('|') })
}

/** Adulto: item de menu condicionado ao Control, layout do catálogo, lista lateral e PIN antes do vídeo. */
async function runAdult() {
  const t = 'adulto'
  const tabs = all('.iplex-header__capsule .iplex-tab').map((b) => b.dataset.navId ?? '')
  const tab = all('.iplex-header__capsule .iplex-tab').find((b) => b.dataset.navId === 'tab-adult')
  const backend = (window as unknown as { __iplexBackend?: Backend }).__iplexBackend
  report(`${t}:menu`, { tabs: tabs.join('|'), hasAdult: String(!!tab) })
  // Conjuntos 7 e 8 no backend (sem listar títulos).
  try {
    const hint = readJson<{ profileId?: string }>('iplex.lastProfile.v1')
    const profileId = hint?.profileId
    const spaces = profileId ? await backend?.listSpaces(profileId) : []
    for (const space of spaces ?? []) {
      const manifest = await backend!.readCatalogManifest(profileId!, space.sourceId)
      const sets = manifest.sets
      report(`${t}:manifest`, { adultEnabled: String(manifest.adultEnabled), adultChunks: String(sets.adult?.chunks), adultCatChunks: String(sets.adult_categories?.chunks) })
      if (sets.adult && manifest.adultEnabled) {
        const first = await backend!.readCatalogChunk(profileId!, space.sourceId, 'adult', 0, manifest.version)
        const cats = await backend!.readCatalogChunk(profileId!, space.sourceId, 'adult_categories', 0, manifest.version)
        const kinds: Record<string, number> = {}
        for (const r of first.records) kinds[String(r.kind)] = (kinds[String(r.kind)] ?? 0) + 1
        report(`${t}:sets`, { firstChunk: String(first.records.length), kinds: JSON.stringify(kinds), categorias: cats.records.map((c) => String(c.name)).join('|') })
      }
    }
  } catch (error) {
    report(`${t}:manifest`, { error: String((error as Error)?.message ?? error) })
  }
  if (!tab) return
  tab.focus()
  tab.click()
  if (!(await waitFor(() => !!$('.iplex-catalog__side'), 15000))) return report(`${t}:enter`, { fail: 'tela Adulto não abriu', path: location.pathname })
  await sleep(1200)
  const side = all('[data-side-item]').map((b) => (b.textContent ?? '').trim())
  const cards = all('[data-grid-index]')
  const first = cards[0]
  const perRow = cards.filter((c) => first && Math.abs(c.getBoundingClientRect().top - first.getBoundingClientRect().top) < 2).length
  report(`${t}:layout`, { path: location.pathname, side: side.join('|'), cards: String(cards.length), perRow: String(perRow), count: ($('.iplex-catalog__count')?.textContent ?? '').trim() })
  if (!first) return
  ;(first as HTMLElement).focus()
  first.click()
  if (!(await waitFor(() => location.pathname === '/assistir' || location.pathname.endsWith('/temporadas'), 12000))) return report(`${t}:open`, { fail: 'não abriu player nem episódios', path: location.pathname })
  if (location.pathname.endsWith('/temporadas')) {
    await sleep(1500)
    $('.iplex-episode')?.click()
    await waitFor(() => location.pathname === '/assistir', 10000)
  }
  await sleep(2500)
  report(`${t}:pin`, { path: location.pathname, dialog: String(!!$('.iplex-pin__dots')), video: String(!!$('video')), overlayVisible: String(!!$('.iplex-player__overlay.is-visible')) })
  press('Escape')
  await sleep(1200)
  report(`${t}:cancel`, { path: location.pathname })
}

export async function runTvSelfTest() {
  try {
    diag('st:start', `vp=${window.innerWidth}x${window.innerHeight} dpr=${window.devicePixelRatio}`)
    // Amostrador de skeletons: maior quantidade vista ao mesmo tempo no grid e quantos cards reais já havia.
    let maxSkeleton = 0
    let cardsWhenMax = 0
    setInterval(() => {
      const n = document.querySelectorAll('.iplex-catalog__grid--skeleton .iplex-skeleton').length
      if (n > maxSkeleton) {
        maxSkeleton = n
        cardsWhenMax = document.querySelectorAll('[data-grid-index]').length
      }
    }, 40)
    ;(window as unknown as { __st?: () => string }).__st = () => `maxSkeleton=${maxSkeleton} realCardsAtMax=${cardsWhenMax}`
    await sleep(4000)
    await runScreen('Filmes')
    await runScreen('Séries')
    await runDetails()
    await runSearch()
    await runAdult()
    // Ao Vivo: nomes das categorias já padronizadas.
    const live = all('.iplex-header__capsule .iplex-tab').find((b) => (b.textContent ?? '').trim() === 'Ao Vivo')
    if (live) {
      live.click()
      await waitFor(() => all('.iplex-chips .iplex-chip').length > 1, 20000)
      await sleep(500)
      const chips = all('.iplex-chips .iplex-chip').map((c) => (c.textContent ?? '').trim()).join('|')
      for (let i = 0; i < chips.length; i += 360) diag(`st:live-chips-${Math.floor(i / 360)}`, chips.slice(i, i + 360))
    }
    await probeCatalogSets((window as unknown as { __iplexBackend?: Backend }).__iplexBackend, diag)
    await probeCatalogCache((window as unknown as { __iplexBackend?: Backend }).__iplexBackend, diag)
    diag('st:skeleton', (window as unknown as { __st: () => string }).__st())
    diag('st:done', 'ok')
  } catch (error) {
    diag('st:error', String((error as Error)?.stack ?? error))
  }
}

export const selfTestRequested = () => /(?:^|[?&])selftest=1(?:&|$)/.test(window.location.search)
