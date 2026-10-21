import type { PlatformContext } from '../environment'
import { createBridgePlaybackAdapter } from './bridgeAdapter'
import { createHtml5Adapter } from './html5Adapter'
import type { PlaybackAdapter } from './types'

/** Escolhe UM adaptador: AVPlay quando o shell anuncia player nativo; senão <video> + hls.js. */
export function createPlaybackAdapter(platform: PlatformContext): PlaybackAdapter {
  if (platform.bridge && platform.info && platform.capabilities.nativePlayer) {
    return createBridgePlaybackAdapter(platform.bridge, platform.info.bridge.methods)
  }
  return createHtml5Adapter()
}
