import type { PlatformContext } from '../environment'
import { createBridgePlaybackAdapter } from './bridgeAdapter'
import { createClapprAdapter } from './clapprAdapter'
import type { PlaybackAdapter } from './types'

/** Escolhe UM adaptador: AVPlay quando o shell anuncia player nativo; senão Clappr. */
export function createPlaybackAdapter(platform: PlatformContext): PlaybackAdapter {
  if (platform.bridge && platform.info && platform.capabilities.nativePlayer) {
    return createBridgePlaybackAdapter(platform.bridge, platform.info.bridge.methods)
  }
  return createClapprAdapter()
}
