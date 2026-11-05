/** Contrato com o player incorporado do YouTube (regras puras, testáveis). */
export const YOUTUBE_ORIGIN = 'https://www.youtube-nocookie.com'

const PLAYING = 1
const ENDED = 0

export function trailerUrl(videoKey: string, origin: string): string {
  const params = new URLSearchParams({ autoplay: '1', controls: '0', disablekb: '1', enablejsapi: '1', fs: '0', iv_load_policy: '3', modestbranding: '1', origin, playsinline: '1', rel: '0' })
  return `${YOUTUBE_ORIGIN}/embed/${encodeURIComponent(videoKey)}?${params}`
}

/** Ampliação que corta as tarjas pretas gravadas nos trailers widescreen (2,39:1 dentro do quadro 16:9). */
const BAR_CROP_ZOOM = 1.35

/** Tamanho do quadro 16:9 que cobre a área inteira, como a imagem, já sem as tarjas do vídeo. */
export function coverSize(width: number, height: number): { width: number; height: number } {
  const frameHeight = Math.max(height, (width * 9) / 16) * BAR_CROP_ZOOM
  return { width: Math.ceil((frameHeight * 16) / 9), height: Math.ceil(frameHeight) }
}

export interface PlayerMessage {
  ready?: boolean
  playing?: boolean
  ended?: boolean
  error?: boolean
}

/** Mensagem do player (texto JSON); qualquer outra coisa não significa nada. */
export function readPlayerMessage(data: unknown): PlayerMessage {
  if (typeof data !== 'string') return {}
  let parsed: { event?: unknown; info?: unknown }
  try {
    parsed = JSON.parse(data) as typeof parsed
  } catch {
    return {}
  }
  if (!parsed || typeof parsed !== 'object') return {}
  const { event, info } = parsed
  if (event === 'onError') return { error: true }
  const state = event === 'onStateChange' ? info : event === 'infoDelivery' ? (info as { playerState?: unknown } | null)?.playerState : undefined
  return { ready: event === 'onReady' || event === 'initialDelivery', playing: state === PLAYING, ended: state === ENDED }
}
