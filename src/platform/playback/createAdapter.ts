import type { PlatformContext } from '../environment'
import { createBridgePlaybackAdapter } from './bridgeAdapter'
import { diagnosticsEnabled } from '../diagnostics'
import { createHtml5Adapter } from './html5Adapter'
import type { PlaybackAdapter } from './types'

/** Escolhe UM adaptador: AVPlay quando o shell anuncia player nativo; senão <video> + hls.js. */
export function createPlaybackAdapter(platform: PlatformContext): PlaybackAdapter {
  // DIAGNÓSTICO TEMPORÁRIO (ponto no centro): `?diag=1&html5=1` ignora o AVPlay e usa <video>.
  const forceHtml5 = diagnosticsEnabled() && /(?:^|[?&])html5=1(?:&|$)/.test(window.location.search)
  if (!forceHtml5 && platform.bridge && platform.info && platform.capabilities.nativePlayer) {
    return createBridgePlaybackAdapter(platform.bridge, platform.info.bridge.methods)
  }
  return createHtml5Adapter()
}
