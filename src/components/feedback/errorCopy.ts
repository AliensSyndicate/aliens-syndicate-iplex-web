/**
 * Textos por tipo de erro. Situações que exigem ações diferentes têm
 * mensagens diferentes; nada de "algo deu errado" genérico.
 */
import type { AppErrorKind } from '../../services/api/errors'

export interface ErrorCopy {
  title: string
  description: string
  /** Rótulo da ação principal quando há retentativa. */
  retry?: string
}

export const ERROR_COPY: Record<AppErrorKind, ErrorCopy> = {
  offline: { title: 'Não foi possível conectar', description: 'Verifique sua conexão com a internet e tente novamente.', retry: 'Tentar novamente' },
  'server-unavailable': { title: 'Servidor indisponível', description: 'O serviço do iPlex não respondeu. Tente novamente em alguns instantes.', retry: 'Tentar novamente' },
  'not-configured': { title: 'iPlex não configurado', description: 'Esta instalação do iPlex Web ainda não tem a configuração do servidor. Fale com o suporte.' },
  'shell-communication': { title: 'Falha na comunicação com a TV', description: 'O iPlex não conseguiu se comunicar com o aplicativo da TV. Feche e abra o iPlex novamente.', retry: 'Tentar novamente' },
  'device-unpaired': { title: 'Dispositivo desvinculado', description: 'Esta TV não está mais vinculada a uma família. Vincule de novo pelo iPlex Gestor.', retry: 'Vincular novamente' },
  'pairing-expired': { title: 'Código expirado', description: 'O código de vinculação expirou. Gere um novo código para continuar.', retry: 'Gerar novo código' },
  'pairing-pending': { title: 'Aguardando confirmação', description: 'Confirme a vinculação no iPlex Gestor.' },
  'subscription-inactive': { title: 'Assinatura inativa', description: 'O acesso desta família não está ativo. Regularize a assinatura no iPlex Gestor e verifique novamente.', retry: 'Verificar novamente' },
  'session-expired': { title: 'Sessão expirada', description: 'Sua sessão neste dispositivo terminou. Entre novamente para continuar.', retry: 'Entrar novamente' },
  'session-limit': { title: 'Limite de telas atingido', description: 'Sua família já está usando o iPlex no número máximo de telas. Encerre em outro dispositivo e tente novamente.', retry: 'Tentar novamente' },
  'profile-in-use': { title: 'Perfil em uso', description: 'Este perfil já está assistindo em outro dispositivo. Escolha outro perfil ou tente mais tarde.', retry: 'Tentar novamente' },
  'profile-unavailable': { title: 'Perfil indisponível', description: 'Este perfil não está disponível nesta TV. As configurações de perfis ficam no iPlex Gestor.', retry: 'Tentar novamente' },
  'profile-locked': { title: 'Perfil protegido', description: 'A entrada neste perfil exige PIN porque há um perfil infantil na família.' },
  'iptv-not-configured': { title: 'Nenhuma fonte configurada', description: 'Adicione uma fonte IPTV no iPlex Gestor para ver canais, filmes e séries aqui.', retry: 'Verificar novamente' },
  'iptv-unavailable': { title: 'Fonte IPTV indisponível', description: 'A fonte configurada não respondeu agora. Sua assinatura do iPlex não foi afetada.', retry: 'Tentar novamente' },
  'source-locked': { title: 'Fonte protegida', description: 'Esta fonte IPTV é protegida por PIN no iPlex Gestor e ainda não pode ser desbloqueada pela TV.' },
  'content-unavailable': { title: 'Conteúdo indisponível', description: 'Este conteúdo não está disponível para o perfil atual ou foi removido da fonte.' },
  'playback-error': { title: 'Não foi possível reproduzir', description: 'Houve uma falha ao reproduzir este conteúdo.', retry: 'Tentar novamente' },
  'format-unsupported': { title: 'Formato não suportado', description: 'Este dispositivo não consegue reproduzir o formato deste conteúdo.' },
  'rate-limited': { title: 'Muitas tentativas', description: 'Aguarde um pouco antes de tentar novamente.', retry: 'Tentar novamente' },
  'not-supported': { title: 'Recurso indisponível', description: 'Este recurso não está disponível neste perfil ou dispositivo.' },
  'backend-outdated': { title: 'Servidor do iPlex desatualizado', description: 'O servidor ainda não oferece este recurso para TVs. A atualização do serviço é necessária para listar suas fontes aqui.', retry: 'Verificar novamente' },
  typography: { title: 'Não foi possível carregar a interface', description: 'Os recursos visuais do iPlex não foram carregados. Verifique a conexão e tente novamente.', retry: 'Tentar novamente' },
  unknown: { title: 'Não foi possível concluir', description: 'Ocorreu uma falha inesperada. Tente novamente.', retry: 'Tentar novamente' },
}
