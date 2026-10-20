/**
 * Normalização de teclas. Na TV os códigos reais vêm de PlatformInfo.keys
 * (variam por modelo); no navegador usam-se event.key/keyCode padrão.
 * Exit (10182) nunca é tratado: a Samsung exige o comportamento padrão.
 */
import type { RemoteKeyMap, RemoteKeyName } from './bridge/protocol'

export type { RemoteKeyName }

/** Padrões do navegador e do Tizen (setas, OK, Return). */
export const DEFAULT_KEY_CODES: RemoteKeyMap = {
  ArrowLeft: 37,
  ArrowUp: 38,
  ArrowRight: 39,
  ArrowDown: 40,
  Enter: 13,
  Back: 10009,
}

const BY_KEY: Record<string, RemoteKeyName> = {
  ArrowLeft: 'ArrowLeft',
  ArrowUp: 'ArrowUp',
  ArrowRight: 'ArrowRight',
  ArrowDown: 'ArrowDown',
  Left: 'ArrowLeft',
  Up: 'ArrowUp',
  Right: 'ArrowRight',
  Down: 'ArrowDown',
  Enter: 'Enter',
  Escape: 'Back',
  Esc: 'Back',
  BrowserBack: 'Back',
  GoBack: 'Back',
  MediaPlayPause: 'MediaPlayPause',
  MediaPlay: 'MediaPlay',
  MediaPause: 'MediaPause',
  MediaStop: 'MediaStop',
  MediaFastForward: 'MediaFastForward',
  MediaRewind: 'MediaRewind',
  ChannelUp: 'ChannelUp',
  ChannelDown: 'ChannelDown',
}

export const EXIT_KEY_CODE = 10182

export function buildKeyLookup(platformKeys: RemoteKeyMap = {}): Map<number, RemoteKeyName> {
  const lookup = new Map<number, RemoteKeyName>()
  const merged: RemoteKeyMap = { ...DEFAULT_KEY_CODES, ...platformKeys }
  ;(Object.keys(merged) as RemoteKeyName[]).forEach((name) => {
    const code = merged[name]
    if (typeof code === 'number' && code !== EXIT_KEY_CODE) lookup.set(code, name)
  })
  return lookup
}

export function normalizeKey(event: Pick<KeyboardEvent, 'key' | 'keyCode'>, lookup: Map<number, RemoteKeyName>): RemoteKeyName | null {
  if (event.keyCode === EXIT_KEY_CODE) return null
  const byCode = lookup.get(event.keyCode)
  if (byCode) return byCode
  const byKey = event.key ? BY_KEY[event.key] : undefined
  return byKey ?? null
}

export const isArrow = (key: RemoteKeyName | null): key is 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight' =>
  key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight'
