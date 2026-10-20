/**
 * Identificação do ambiente de execução e capacidades REAIS.
 * Nada é presumido: dentro do shell, as capacidades vêm do handshake
 * `app.ready` (PlatformInfo). Fora dele, o navegador comum.
 */
import { SHELL_ORIGINS } from '../config/env'
import { WEB_VERSION } from '../config/env'
import { createBridgeClient, isInsideFrame, type BridgeClient } from './bridge/client'
import type { BridgeMethod, PlatformInfo, RemoteKeyMap } from './bridge/protocol'

export type RuntimeKind = 'tizen' | 'webos' | 'browser'

export interface Capabilities {
  nativePlayer: boolean
  exit: boolean
  mediaKeys: boolean
  audioTracks: boolean
  subtitles: boolean
  playerEvents: boolean
  lifecycle: boolean
}

export interface PlatformContext {
  kind: RuntimeKind
  /** TV = escala 10 pés (data-iplex-platform="tv"). */
  isTv: boolean
  info: PlatformInfo | null
  bridge: BridgeClient | null
  keys: RemoteKeyMap
  capabilities: Capabilities
}

export const BROWSER_CAPABILITIES: Capabilities = {
  nativePlayer: false,
  exit: false,
  mediaKeys: false,
  audioTracks: true,
  subtitles: true,
  playerEvents: true,
  lifecycle: true,
}

export function capabilitiesFrom(info: PlatformInfo): Capabilities {
  const has = (method: BridgeMethod) => info.bridge.methods.includes(method)
  return {
    nativePlayer: info.capabilities.nativePlayer && has('player.open'),
    exit: info.capabilities.exit && has('app.exit'),
    mediaKeys: info.capabilities.mediaKeys,
    audioTracks: has('player.getTracks') && has('player.selectTrack'),
    subtitles: has('player.getTracks') && has('player.setSubtitlesVisible'),
    playerEvents: has('player.open'),
    lifecycle: true,
  }
}

export function browserContext(): PlatformContext {
  return { kind: 'browser', isTv: false, info: null, bridge: null, keys: {}, capabilities: BROWSER_CAPABILITIES }
}

export class ShellHandshakeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ShellHandshakeError'
  }
}

/**
 * Dentro de um iframe, tenta o handshake obrigatório `app.ready`. O shell
 * só exibe o Web após esse sinal. Sem resposta, é falha de comunicação com
 * o shell (não "sem internet").
 */
export async function detectPlatform({ timeoutMs, win = window }: { timeoutMs: number; win?: Window }): Promise<PlatformContext> {
  if (!isInsideFrame(win)) return browserContext()
  const bridge = createBridgeClient({ win, allowedOrigins: SHELL_ORIGINS, timeoutMs })
  try {
    const info = await bridge.call('app.ready', { version: WEB_VERSION })
    const kind: RuntimeKind = info.platform === 'tizen' || info.platform === 'webos' ? info.platform : 'browser'
    return {
      kind,
      isTv: kind !== 'browser',
      info,
      bridge,
      keys: info.keys ?? {},
      capabilities: capabilitiesFrom(info),
    }
  } catch (error) {
    bridge.dispose()
    throw new ShellHandshakeError(error instanceof Error ? error.message : 'handshake falhou')
  }
}
