import { describe, expect, it, vi } from 'vitest'
import { createStatusReporter } from './playbackStatus'

describe('status de reprodução para o Control', () => {
  it('envia ao mudar de estado e renova a cada minuto, sem gravar a cada segundo', () => {
    let t = 0
    const send = vi.fn().mockResolvedValue(undefined)
    const reporter = createStatusReporter(send, 60_000, () => t)
    reporter.report({ state: 'playing', positionSec: 0, durationSec: 100 })
    for (t = 1000; t < 59_000; t += 1000) reporter.report({ state: 'playing', positionSec: t / 1000, durationSec: 100 })
    expect(send).toHaveBeenCalledTimes(1)
    t = 61_000
    reporter.report({ state: 'playing', positionSec: 61, durationSec: 100 })
    expect(send).toHaveBeenCalledTimes(2)
    reporter.report({ state: 'paused', positionSec: 61, durationSec: 100 })
    expect(send).toHaveBeenCalledTimes(3)
  })
  it('parado só é enviado depois de ter tocado, uma vez', () => {
    const send = vi.fn().mockResolvedValue(undefined)
    const reporter = createStatusReporter(send)
    reporter.report({ state: 'stopped' })
    expect(send).not.toHaveBeenCalled()
    reporter.report({ state: 'playing' })
    reporter.report({ state: 'stopped' })
    reporter.report({ state: 'stopped' })
    expect(send).toHaveBeenCalledTimes(2)
  })
  it('falha de rede não quebra e permite repetir', async () => {
    const send = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined)
    const reporter = createStatusReporter(send, 60_000, () => 5)
    reporter.report({ state: 'playing' })
    await Promise.resolve()
    await Promise.resolve()
    reporter.report({ state: 'playing' })
    expect(send).toHaveBeenCalledTimes(2)
  })
})
