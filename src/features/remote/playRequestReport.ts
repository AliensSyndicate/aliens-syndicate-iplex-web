/**
 * Resultado de um pedido de reprodução do iPlex Control, reportado uma única
 * vez ao backend (que o repassa ao celular). Falha de rede no relatório não
 * afeta a reprodução na TV.
 */
import type { Backend } from '../../services/api/backend'
import type { AppError } from '../../services/api/errors'
import type { PlayRequestErrorCode } from '../../services/api/types'

const reported = new Set<string>()
let playbackActive = false

/**
 * Reprodução em andamento (player tocando ou pausado com mídia carregada).
 * Um pedido do celular só exige confirmação na TV quando isto é verdade:
 * o player em erro ou carregando não é "reprodução em andamento".
 */
export function setPlaybackActive(active: boolean): void {
  playbackActive = active
}
export function isPlaybackActive(): boolean {
  return playbackActive
}

export function reportPlayRequest(backend: Pick<Backend, 'updatePlayRequest'>, id: string | null, status: 'started' | 'declined' | 'failed', errorCode?: PlayRequestErrorCode): void {
  if (!id || reported.has(id)) return
  reported.add(id)
  void backend.updatePlayRequest(id, status, errorCode).catch(() => undefined)
}

/** Erro do player/backend na TV → código do contrato (o celular mostra a mensagem própria). */
export function playRequestErrorCode(error: AppError): PlayRequestErrorCode {
  switch (error.kind) {
    case 'content-unavailable':
      return 'content-unavailable'
    case 'source-locked':
      return 'source-protected'
    case 'format-unsupported':
      return 'format-unsupported'
    case 'iptv-unavailable':
      return 'stream-unavailable'
    case 'session-limit':
      return 'session-limit'
    case 'subscription-inactive':
      return 'subscription-required'
    default:
      return 'playback-failed'
  }
}

/** Mensagem curta na TV quando o pedido não pôde ser atendido. */
export function playRequestFailureCopy(code: string | undefined): string {
  switch (code) {
    case 'content-not-allowed':
      return 'O conteúdo pedido pelo celular não está disponível para o perfil atual.'
    case 'source-protected':
      return 'O conteúdo pedido pelo celular está numa fonte protegida por PIN.'
    case 'content-unavailable':
      return 'O conteúdo pedido pelo celular não está mais disponível.'
    default:
      return 'Não foi possível atender ao pedido de reprodução do celular.'
  }
}

export function __resetPlayRequestReports() {
  reported.clear()
  playbackActive = false
}
