import { describe, expect, it } from 'vitest'
import type { PlatformInfo } from './bridge/protocol'
import { capabilitiesFrom } from './environment'

const info = (capabilities: Partial<PlatformInfo['capabilities']>) =>
  ({ bridge: { version: 1, methods: [] }, capabilities: { nativePlayer: true, exit: true, mediaKeys: true, ...capabilities } }) as unknown as PlatformInfo

describe('capacidades do shell', () => {
  it('trailer só em shell que libera o YouTube (os instalados antes não enviam o campo)', () => {
    expect(capabilitiesFrom(info({})).externalVideo).toBe(false)
    expect(capabilitiesFrom(info({ externalVideo: false })).externalVideo).toBe(false)
    expect(capabilitiesFrom(info({ externalVideo: true })).externalVideo).toBe(true)
  })
})
