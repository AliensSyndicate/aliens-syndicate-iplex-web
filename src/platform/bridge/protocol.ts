/*
 * CÓPIA FIEL do contrato da ponte do iPlex Player
 * (aliens-syndicate-iplex-app/src/bridge/protocol.ts, BRIDGE_VERSION 1).
 * Não alterar aqui: mudanças são feitas no Player e copiadas para cá.
 * scripts/verify-bridge.mjs compara as duas cópias quando o Player está no workspace.
 */
/**
 * Contrato da ponte entre o aplicativo instalado na TV (shell) e o frontend
 * iPlex Web carregado dentro dele.
 *
 * Compartilhado e independente de plataforma: não referencia APIs do Tizen
 * nem do webOS. O iPlex Web (outro repositório) usa o mesmo contrato com o
 * cliente de src/bridge/client.ts.
 *
 * Transporte: window.postMessage entre o shell e o <iframe> do frontend.
 * O shell só aceita mensagens do próprio iframe, da origem configurada e
 * com métodos desta lista (BRIDGE_METHODS).
 */

export const BRIDGE_PROTOCOL = 'iplex-bridge'
export const BRIDGE_VERSION = 1

export type PlatformId = 'tizen' | 'webos' | 'browser'

/**
 * Teclas normalizadas. Os códigos (keyCode) variam por modelo e plataforma:
 * o shell informa em PlatformInfo.keys o código real de cada tecla neste
 * aparelho, e o Web compara `event.keyCode` com esse mapa.
 */
export type RemoteKeyName =
  | 'ArrowUp'
  | 'ArrowDown'
  | 'ArrowLeft'
  | 'ArrowRight'
  | 'Enter'
  | 'Back'
  | 'MediaPlayPause'
  | 'MediaPlay'
  | 'MediaPause'
  | 'MediaStop'
  | 'MediaFastForward'
  | 'MediaRewind'
  | 'ChannelUp'
  | 'ChannelDown'

export type RemoteKeyMap = Partial<Record<RemoteKeyName, number>>

export interface PlatformInfo {
  platform: PlatformId
  platformVersion: string | null
  appVersion: string
  userAgent: string
  /** Versão da ponte implementada pelo shell e métodos disponíveis (detecção de recursos). */
  bridge: { version: number; methods: BridgeMethod[] }
  /**
   * Identificador desta instalação (aleatório, gerado pelo shell, perdido ao
   * desinstalar). É uma DICA para o backend, nunca prova de identidade.
   */
  installationId: string
  device: {
    /** Modelo informado pelo sistema, quando disponível. */
    model: string | null
    screen: { width: number; height: number }
  }
  /** Código real de cada tecla neste aparelho (inclui as teclas de mídia registradas). */
  keys: RemoteKeyMap
  capabilities: {
    /** Player nativo da TV (Tizen: AVPlay). Falso = HTML5 <video>. */
    nativePlayer: boolean
    /** app.exit encerra o aplicativo de fato. */
    exit: boolean
    /** Teclas de mídia/canal registradas pelo shell (chegam ao Web como keydown). */
    mediaKeys: boolean
  }
}

export type PlayerState = 'idle' | 'loading' | 'ready' | 'playing' | 'paused' | 'ended' | 'error'
export type TrackKind = 'audio' | 'text'

export interface MediaTrack {
  kind: TrackKind
  index: number
  language: string | null
  selected: boolean
}

export interface PlayerStatus {
  state: PlayerState
  positionMs: number
  durationMs: number
  url: string | null
}

export interface PlayerErrorInfo {
  code: string
  message: string
}

/** Métodos que o frontend pode chamar no shell. */
export interface BridgeMethods {
  /** Handshake obrigatório: o frontend avisa que está pronto; o shell remove a tela de carregamento. */
  'app.ready': { params: { version?: string }; result: PlatformInfo }
  'platform.getInfo': { params: void; result: PlatformInfo }
  'app.exit': { params: void; result: void }
  'player.open': { params: { url: string; autoplay?: boolean; startPositionMs?: number }; result: PlayerStatus }
  'player.play': { params: void; result: PlayerStatus }
  'player.pause': { params: void; result: PlayerStatus }
  'player.stop': { params: void; result: PlayerStatus }
  'player.seek': { params: { positionMs: number }; result: PlayerStatus }
  'player.getStatus': { params: void; result: PlayerStatus }
  'player.getTracks': { params: void; result: MediaTrack[] }
  'player.selectTrack': { params: { kind: TrackKind; index: number }; result: MediaTrack[] }
  'player.setSubtitlesVisible': { params: { visible: boolean }; result: void }
}

export type BridgeMethod = keyof BridgeMethods
export type BridgeParams<M extends BridgeMethod> = BridgeMethods[M]['params']
export type BridgeResult<M extends BridgeMethod> = BridgeMethods[M]['result']

/** Lista de comandos permitidos (tudo fora dela é recusado). */
export const BRIDGE_METHODS: readonly BridgeMethod[] = [
  'app.ready',
  'platform.getInfo',
  'app.exit',
  'player.open',
  'player.play',
  'player.pause',
  'player.stop',
  'player.seek',
  'player.getStatus',
  'player.getTracks',
  'player.selectTrack',
  'player.setSubtitlesVisible',
]

/** Eventos que o shell envia ao frontend. */
export interface BridgeEvents {
  'player.state': PlayerStatus
  'player.buffering': { phase: 'start' | 'progress' | 'complete'; percent: number }
  'player.time': { positionMs: number; durationMs: number }
  'player.error': PlayerErrorInfo
  'player.ended': PlayerStatus
  'player.subtitle': { text: string; durationMs: number }
  /**
   * O app foi suspenso/retomado (multitarefa). Equivale a app.suspend/app.resume:
   * oculto durante reprodução => player parado; ao voltar, o foco retorna ao Web.
   */
  'app.visibility': { visible: boolean }
  'network.status': { online: boolean }
  /**
   * Tecla recebida pelo SHELL (o foco estava fora do Web) e reencaminhada.
   * Com o foco no Web, as teclas chegam direto como keydown.
   */
  'remote.key': { key: RemoteKeyName; keyCode: number }
}

export type BridgeEventName = keyof BridgeEvents

export type BridgeErrorCode =
  | 'not_allowed'
  | 'unknown_method'
  | 'invalid_params'
  | 'not_supported'
  | 'player_error'
  | 'unsupported_version'
  | 'internal'

interface Envelope {
  protocol: typeof BRIDGE_PROTOCOL
  version: typeof BRIDGE_VERSION
}

export interface BridgeRequestMessage<M extends BridgeMethod = BridgeMethod> extends Envelope {
  kind: 'request'
  id: string
  method: M
  params: BridgeParams<M>
}

export type BridgeResponseMessage =
  | (Envelope & { kind: 'response'; id: string; ok: true; result: unknown })
  | (Envelope & { kind: 'response'; id: string; ok: false; error: { code: BridgeErrorCode; message: string } })

export interface BridgeEventMessage<E extends BridgeEventName = BridgeEventName> extends Envelope {
  kind: 'event'
  event: E
  data: BridgeEvents[E]
}

function isEnvelope(value: unknown): value is Envelope & Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Envelope).protocol === BRIDGE_PROTOCOL &&
    (value as Envelope).version === BRIDGE_VERSION
  )
}

export function isBridgeRequest(value: unknown): value is BridgeRequestMessage {
  return (
    isEnvelope(value) &&
    value.kind === 'request' &&
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    value.id.length <= 64 &&
    typeof value.method === 'string'
  )
}

/**
 * Pedido do protocolo iplex-bridge, mas de outra versão: o shell responde
 * `unsupported_version` em vez de ignorar (o Web pode orientar a atualização).
 */
export function isOtherVersionRequest(value: unknown): value is { id: string; version: unknown } {
  if (typeof value !== 'object' || value === null) return false
  const message = value as Record<string, unknown>
  return (
    message.protocol === BRIDGE_PROTOCOL &&
    message.version !== BRIDGE_VERSION &&
    message.kind === 'request' &&
    typeof message.id === 'string' &&
    message.id.length > 0 &&
    message.id.length <= 64
  )
}

export function isBridgeResponse(value: unknown): value is BridgeResponseMessage {
  return isEnvelope(value) && value.kind === 'response' && typeof value.id === 'string'
}

export function isBridgeEvent(value: unknown): value is BridgeEventMessage {
  return isEnvelope(value) && value.kind === 'event' && typeof value.event === 'string'
}
