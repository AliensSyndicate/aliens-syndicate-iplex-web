/**
 * Integração do controle remoto com o React:
 *  - setas → navegação espacial;
 *  - OK/Enter → manipuladores registrados (player) e, sem tratamento, ativa
 *    o elemento focado (botões nativos já tratam);
 *  - Return/Back → pilha de manipuladores (diálogo, player, tela) e, por fim,
 *    o comportamento padrão da rota;
 *  - teclas de mídia → manipuladores registrados (player);
 *  - memória de foco por rota, para voltar ao mesmo item após os detalhes.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react'
import { buildKeyLookup, isArrow, normalizeKey, type RemoteKeyName } from '../platform/keys'
import type { RemoteKeyMap } from '../platform/bridge/protocol'
import { FocusMemory, focusElement, initialTarget, moveFocus, navigables, type Direction } from './spatial'

type KeyHandler = (key: RemoteKeyName) => boolean

interface FocusApi {
  memory: FocusMemory
  /** Registra manipulador de Back (o mais recente tem prioridade). Devolve remoção. */
  pushBack(handler: () => boolean): () => void
  /** Registra manipulador de teclas de mídia/canal. */
  pushKeys(handler: KeyHandler): () => void
  /** Restaura o foco da rota (memória) ou foca o alvo inicial. */
  restore(routeKey: string): void
  focusFirst(): void
}

const FocusContext = createContext<FocusApi | null>(null)

const ARROW_DIR: Record<'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight', Direction> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
}

const MEDIA_KEYS = new Set<RemoteKeyName>(['MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaStop', 'MediaFastForward', 'MediaRewind', 'ChannelUp', 'ChannelDown'])

function isTextInput(el: Element | null): el is HTMLInputElement {
  return el instanceof HTMLInputElement && (el.type === 'text' || el.type === 'search')
}

export function FocusProvider({
  children,
  platformKeys,
  onDefaultBack,
  routeKey,
}: {
  children: ReactNode
  platformKeys: RemoteKeyMap
  onDefaultBack: () => void
  routeKey: string
}) {
  const memory = useMemo(() => new FocusMemory(), [])
  const backStack = useRef<Array<() => boolean>>([])
  const keyStack = useRef<KeyHandler[]>([])
  const lookup = useMemo(() => buildKeyLookup(platformKeys), [platformKeys])
  const routeRef = useRef(routeKey)
  const defaultBack = useRef(onDefaultBack)

  useEffect(() => {
    routeRef.current = routeKey
    defaultBack.current = onDefaultBack
  }, [routeKey, onDefaultBack])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const key = normalizeKey(event, lookup)
      if (!key) return
      const active = document.activeElement
      if (isArrow(key)) {
        if (isTextInput(active) && (key === 'ArrowLeft' || key === 'ArrowRight')) {
          const atStart = active.selectionStart === 0 && active.selectionEnd === 0
          const atEnd = active.selectionStart === active.value.length
          if ((key === 'ArrowLeft' && !atStart) || (key === 'ArrowRight' && !atEnd)) return
        }
        for (let i = keyStack.current.length - 1; i >= 0; i -= 1) {
          if (keyStack.current[i]!(key)) {
            event.preventDefault()
            return
          }
        }
        event.preventDefault()
        moveFocus(ARROW_DIR[key], memory)
        return
      }
      if (key === 'Back') {
        // Backspace/Escape num campo de texto editam o texto.
        if (isTextInput(active) && event.key !== 'Escape' && event.keyCode !== 10009) return
        event.preventDefault()
        for (let i = backStack.current.length - 1; i >= 0; i -= 1) {
          if (backStack.current[i]!()) return
        }
        defaultBack.current()
        return
      }
      if (key === 'Enter') {
        // Telas com OK contextual (player: OK revela os controles antes de acionar um botão).
        for (let i = keyStack.current.length - 1; i >= 0; i -= 1) {
          if (keyStack.current[i]!(key)) {
            event.preventDefault()
            return
          }
        }
        if (active instanceof HTMLElement && active.hasAttribute('data-nav') && !(active instanceof HTMLButtonElement) && !(active instanceof HTMLAnchorElement) && !isTextInput(active)) {
          event.preventDefault()
          active.click()
        }
        return
      }
      if (MEDIA_KEYS.has(key)) {
        for (let i = keyStack.current.length - 1; i >= 0; i -= 1) {
          if (keyStack.current[i]!(key)) {
            event.preventDefault()
            return
          }
        }
      }
    }
    const onFocusIn = (event: FocusEvent) => {
      const el = event.target
      if (!(el instanceof HTMLElement)) return
      const id = el.getAttribute('data-nav-id')
      if (!id) return
      memory.rememberRoute(routeRef.current, id)
      const group = el.getAttribute('data-nav-group')
      if (group) memory.rememberGroup(group, id)
    }
    window.addEventListener('keydown', onKeyDown)
    document.addEventListener('focusin', onFocusIn)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('focusin', onFocusIn)
    }
  }, [lookup, memory])

  const pushBack = useCallback((handler: () => boolean) => {
    backStack.current.push(handler)
    return () => {
      backStack.current = backStack.current.filter((h) => h !== handler)
    }
  }, [])

  const pushKeys = useCallback((handler: KeyHandler) => {
    keyStack.current.push(handler)
    return () => {
      keyStack.current = keyStack.current.filter((h) => h !== handler)
    }
  }, [])

  const focusFirst = useCallback(() => {
    const target = initialTarget()
    if (target) focusElement(target)
  }, [])

  const restore = useCallback(
    (key: string) => {
      const id = memory.route(key)
      if (id) {
        const el = navigables().find((node) => node.getAttribute('data-nav-id') === id)
        if (el) {
          focusElement(el)
          return
        }
      }
      focusFirst()
    },
    [memory, focusFirst],
  )

  const api = useMemo<FocusApi>(() => ({ memory, pushBack, pushKeys, restore, focusFirst }), [memory, pushBack, pushKeys, restore, focusFirst])
  return <FocusContext.Provider value={api}>{children}</FocusContext.Provider>
}

export function useFocusApi(): FocusApi {
  const api = useContext(FocusContext)
  if (!api) throw new Error('FocusProvider ausente')
  return api
}

/** Back contextual: devolva true quando tratado. */
export function useBackHandler(handler: () => boolean, enabled = true) {
  const { pushBack } = useFocusApi()
  const ref = useRef(handler)
  useEffect(() => {
    ref.current = handler
  })
  useEffect(() => {
    if (!enabled) return
    return pushBack(() => ref.current())
  }, [enabled, pushBack])
}

export function useKeyHandler(handler: KeyHandler, enabled = true) {
  const { pushKeys } = useFocusApi()
  const ref = useRef(handler)
  useEffect(() => {
    ref.current = handler
  })
  useEffect(() => {
    if (!enabled) return
    return pushKeys((key) => ref.current(key))
  }, [enabled, pushKeys])
}

/**
 * Foco inicial da tela quando o conteúdo estiver pronto: memória da rota
 * (volta dos detalhes) ou [data-nav-autofocus]/primeiro item.
 */
export function useInitialFocus(routeKey: string, ready: boolean) {
  const { restore } = useFocusApi()
  const done = useRef<string | null>(null)
  useEffect(() => {
    if (!ready || done.current === routeKey) return
    // Após a pintura, para que as medidas do layout existam. Só marca como feito ao
    // executar: se `ready` oscilar antes disso, o agendamento é refeito.
    const id = setTimeout(() => {
      done.current = routeKey
      const active = document.activeElement
      const insideScope = active instanceof HTMLElement && active.hasAttribute('data-nav') && active.closest('main')
      if (!insideScope) restore(routeKey)
    }, 0)
    return () => clearTimeout(id)
  }, [ready, routeKey, restore])
}
