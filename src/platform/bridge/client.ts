/**
 * Cliente da ponte iplex-bridge v1 (Web → shell Samsung).
 *
 * Baseado no cliente de referência do Player (src/bridge/client.ts), com
 * validações adicionais exigidas pelo iPlex Web:
 *  - fonte: somente window.parent;
 *  - origem: lista explícita (o shell empacotado tem origem opaca "null"/"file://");
 *  - formato, tipo e versão: guardas do protocol.ts;
 *  - id: respostas só para pedidos pendentes (duplicadas são descartadas);
 *  - eventos: somente nomes conhecidos;
 *  - desconexão: timeouts consecutivos marcam a ponte como desconectada.
 */
import {
  BRIDGE_PROTOCOL,
  BRIDGE_VERSION,
  isBridgeEvent,
  isBridgeResponse,
  type BridgeErrorCode,
  type BridgeEventName,
  type BridgeEvents,
  type BridgeMethod,
  type BridgeParams,
  type BridgeRequestMessage,
  type BridgeResult,
} from './protocol'
import { diag } from '../diagnostics'

export class BridgeCallError extends Error {
  readonly code: BridgeErrorCode | 'timeout' | 'unavailable' | 'disconnected'
  constructor(code: BridgeCallError['code'], message: string) {
    super(message)
    this.name = 'BridgeCallError'
    this.code = code
  }
}

const KNOWN_EVENTS: ReadonlySet<BridgeEventName> = new Set<BridgeEventName>([
  'player.state',
  'player.buffering',
  'player.time',
  'player.error',
  'player.ended',
  'player.subtitle',
  'app.visibility',
  'network.status',
  'remote.key',
])

/** Tempos limite por método: abrir mídia inclui o prepare do player e a rede. */
const METHOD_TIMEOUTS: Partial<Record<BridgeMethod, number>> = {
  'player.open': 45000,
  'player.seek': 20000,
}

/** Timeouts seguidos que caracterizam perda de comunicação com o shell. */
const DISCONNECT_AFTER = 3

interface Pending {
  method: BridgeMethod
  resolve: (value: unknown) => void
  reject: (error: BridgeCallError) => void
  timer: ReturnType<typeof setTimeout>
}

export interface BridgeClientOptions {
  win?: Window
  allowedOrigins: readonly string[]
  timeoutMs?: number
}

export type BridgeConnection = 'connected' | 'disconnected'

export function isInsideFrame(win: Window = window): boolean {
  try {
    return win.parent !== win
  } catch {
    return true
  }
}

export function createBridgeClient({ win = window, allowedOrigins, timeoutMs = 10000 }: BridgeClientOptions) {
  const pending = new Map<string, Pending>()
  const listeners = new Map<BridgeEventName, Set<(data: never) => void>>()
  const connectionListeners = new Set<(state: BridgeConnection) => void>()
  const origins = new Set(allowedOrigins)
  let sequence = 0
  let consecutiveTimeouts = 0
  let connection: BridgeConnection = 'connected'
  let disposed = false

  const setConnection = (next: BridgeConnection) => {
    if (connection === next) return
    connection = next
    connectionListeners.forEach((listener) => listener(next))
  }

  const handleMessage = (event: MessageEvent) => {
    const data = event.data as { kind?: unknown; id?: unknown } | null
    if (data && typeof data === 'object' && !String(data.id ?? '').startsWith('diag-')) {
      diag('bridge-in', `origin=${event.origin} fromParent=${event.source === win.parent} kind=${String(data.kind)} id=${String(data.id).slice(0, 20)}`)
    }
    if (event.source !== win.parent) return
    if (!origins.has(event.origin)) return
    const message: unknown = event.data
    if (isBridgeResponse(message)) {
      const entry = pending.get(message.id)
      if (!entry) return // resposta duplicada ou de pedido já expirado
      pending.delete(message.id)
      clearTimeout(entry.timer)
      consecutiveTimeouts = 0
      setConnection('connected')
      if (message.ok) entry.resolve(message.result)
      else {
        const error = (message as { error?: { code?: unknown; message?: unknown } }).error
        const code = typeof error?.code === 'string' ? (error.code as BridgeErrorCode) : 'internal'
        entry.reject(new BridgeCallError(code, typeof error?.message === 'string' ? error.message : code))
      }
    } else if (isBridgeEvent(message)) {
      if (!KNOWN_EVENTS.has(message.event)) return
      if (typeof message.data !== 'object' || message.data === null) return
      consecutiveTimeouts = 0
      setConnection('connected')
      listeners.get(message.event)?.forEach((listener) => listener(message.data as never))
    }
  }
  win.addEventListener('message', handleMessage)

  return {
    available: isInsideFrame(win),

    get connection(): BridgeConnection {
      return connection
    },

    call<M extends BridgeMethod>(method: M, ...args: BridgeParams<M> extends void ? [] : [BridgeParams<M>]): Promise<BridgeResult<M>> {
      return new Promise<BridgeResult<M>>((resolve, reject) => {
        if (disposed || !isInsideFrame(win)) {
          reject(new BridgeCallError('unavailable', 'Fora do aplicativo de TV: ponte indisponível'))
          return
        }
        sequence += 1
        const id = `${Date.now().toString(36)}-${sequence}`
        const limit = METHOD_TIMEOUTS[method] ?? timeoutMs
        const timer = setTimeout(() => {
          pending.delete(id)
          consecutiveTimeouts += 1
          if (consecutiveTimeouts >= DISCONNECT_AFTER) setConnection('disconnected')
          reject(new BridgeCallError('timeout', `Sem resposta para ${method} em ${limit / 1000} s`))
        }, limit)
        pending.set(id, { method, resolve: resolve as (value: unknown) => void, reject, timer })
        const request: BridgeRequestMessage<M> = {
          protocol: BRIDGE_PROTOCOL,
          version: BRIDGE_VERSION,
          kind: 'request',
          id,
          method,
          params: args[0] as BridgeParams<M>,
        }
        // A origem do shell empacotado é opaca (file://): "*" é obrigatório.
        // Pedidos não levam segredos; o shell responde só à origem exata do Web.
        win.parent.postMessage(request, '*')
      })
    },

    on<E extends BridgeEventName>(name: E, listener: (data: BridgeEvents[E]) => void): () => void {
      const set = listeners.get(name) ?? new Set()
      set.add(listener as (data: never) => void)
      listeners.set(name, set)
      return () => {
        set.delete(listener as (data: never) => void)
      }
    },

    onConnection(listener: (state: BridgeConnection) => void): () => void {
      connectionListeners.add(listener)
      return () => {
        connectionListeners.delete(listener)
      }
    },

    dispose() {
      disposed = true
      win.removeEventListener('message', handleMessage)
      pending.forEach((entry) => {
        clearTimeout(entry.timer)
        entry.reject(new BridgeCallError('disconnected', 'Ponte encerrada'))
      })
      pending.clear()
      listeners.clear()
      connectionListeners.clear()
    },
  }
}

export type BridgeClient = ReturnType<typeof createBridgeClient>
