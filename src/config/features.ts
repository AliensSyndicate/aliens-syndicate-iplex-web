/**
 * Decisões de produto centralizadas.
 *
 * APROVADAS (seção 32 do prompt mestre) estão marcadas como tal e não devem
 * mudar. PROPOSTAS (seção 33, ainda sem aprovação definitiva) ficam aqui para
 * ajuste sem alterar regras de negócio espalhadas pelo código.
 */
import type { SectionId } from '../services/api/types'

export const FEATURES = {
  /** APROVADO: sem checkout nesta fase. Não libera reprodução nem assinatura. */
  paymentsEnabled: false,

  /** APROVADO: visitante abre em Ao Vivo. */
  guestStartSection: 'live' as SectionId,

  /** PROPOSTA: seção inicial de perfis regulares/administrador/infantis. */
  regularStartSection: 'my-iplex' as SectionId,

  /** PROPOSTA (não aprovada): abrir automaticamente o último canal. Desligado. */
  autoplayLastChannel: false,

  /**
   * SEGURANÇA — decisão pendente de aprovação.
   * Com perfil infantil na família, a entrada em perfis adultos exige PIN.
   * O backend atual (callable `manager`) NÃO tem validação de PIN de perfil.
   * 'block' = falha fechada: sem validação no backend, perfis adultos ficam
   * bloqueados na TV enquanto houver perfil infantil. Nunca validar PIN só
   * no cliente.
   */
  adultProfileGuardWithoutBackend: 'block',

  /** Tentativas de PIN antes do bloqueio temporário no cliente (o backend deve limitar também). */
  pinMaxAttempts: 5,
  pinLockoutMs: 60_000,
} as const

export const TIMING = {
  /** Handshake com o shell (o shell mostra erro próprio após 20 s). */
  bridgeHandshakeMs: 8_000,
  /** Lease do backend dura 90 s (LEASE_MS); renovação com folga. */
  leaseHeartbeatMs: 30_000,
  /** Pareamento: consulta com recuo exponencial (evita polling excessivo). */
  pairingPollInitialMs: 3_000,
  pairingPollMaxMs: 15_000,
  /** Progresso: gravação controlada. */
  progressSaveIntervalMs: 30_000,
  progressMinDeltaMs: 10_000,
  /** Busca: espera após a última tecla. */
  searchDebounceMs: 300,
  searchMinLength: 3,
  /** Ocultar controles do player sem interação. */
  playerControlsHideMs: 5_000,
  /** Startup: limite para cada etapa remota. */
  startupStepTimeoutMs: 20_000,
} as const

export const PLAYER = {
  /** APROVADO (player de filmes e séries): saltos dos botões laterais. */
  skipMs: 10_000,
  /**
   * PROPOSTA (granularidade da barra ainda não definida): passo de cada toque
   * Esquerda/Direita na barra = fração da duração, limitado a [minMs, maxMs].
   */
  scrubStep: { fraction: 0.01, minMs: 5_000, maxMs: 60_000 },
  /** APROVADO: o botão "Próximo episódio" aparece nos últimos 30 s do episódio. */
  nextEpisodeWindowMs: 30_000,
} as const

export const CATALOG = {
  /** Primeiro lote por espaço, buscado sozinho ao abrir a tela (a API devolve 30 itens por página). */
  initialPages: 1,
  /** Lote extra (30 itens) carregado ao chegar perto do fim do grid. */
  morePages: 1,
  /** Limite de páginas por espaço mantidas em memória. */
  maxPages: 60,
  /** Itens por lista horizontal (sem paginação nem rolagem infinita). */
  rowLimit: 10,
  /** Requisições TMDB simultâneas a partir do cliente. */
  tmdbConcurrency: 4,
  /** Confiança mínima exibida como correspondência (o servidor já filtra). */
  heroCandidates: 12,
} as const
