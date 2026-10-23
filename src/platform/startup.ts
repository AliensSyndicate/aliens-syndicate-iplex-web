/**
 * Inicialização única com o shell (TV).
 *
 * Em shells que oferecem `app.status`/`app.show`, a tela de carregamento é a DO SHELL (logo, texto,
 * spinner, versão): o Web não desenha a sua. Cada etapa real vira `app.status` e, quando o Web tem
 * algo para mostrar (pareamento, perfis, erro, app), `app.show` revela o iframe. Com shell antigo
 * ou no navegador, nada muda: o Web desenha a própria tela de carregamento.
 *
 * Depois do primeiro `app.show` o shell já não controla a tela; carregamentos posteriores (trocar de
 * perfil, por exemplo) usam a tela do próprio Web.
 */
import type { BridgeClient } from './bridge/client'

/** Intervalo do batimento enquanto uma etapa longa roda (o shell vigia o silêncio do Web). */
export const HEARTBEAT_MS = 15_000

let bridge: BridgeClient | null = null
let unified = false
let active = 0
let lastText = ''

export const isUnifiedStartup = () => unified

export function enableUnifiedStartup(client: BridgeClient) {
  bridge = client
  unified = true
}

function send(text: string) {
  if (!bridge) return
  lastText = text
  bridge.call('app.status', { text }).catch(() => undefined)
}

function show() {
  if (!bridge || !unified) return
  const client = bridge
  unified = false
  client.call('app.show').catch(() => undefined)
}

/**
 * Marca uma tela de carregamento ativa: informa a etapa ao shell e mantém o batimento. Ao encerrar,
 * se nenhuma outra assumir no mesmo ciclo, revela o Web. Devolve a função de encerramento.
 */
export function startupSplashActive(text: string): () => void {
  active += 1
  send(text)
  const timer = setInterval(() => send(lastText || text), HEARTBEAT_MS)
  return () => {
    clearInterval(timer)
    active = Math.max(0, active - 1)
    // Duas telas de carregamento seguidas (troca de componente) não revelam nada no meio.
    setTimeout(() => {
      if (active === 0) show()
    }, 0)
  }
}

/** Testes. */
export function resetStartupForTests() {
  bridge = null
  unified = false
  active = 0
  lastText = ''
}
