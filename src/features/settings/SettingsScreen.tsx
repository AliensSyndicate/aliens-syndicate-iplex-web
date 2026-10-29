/**
 * Configurações (acesso pelo menu do avatar; não é aba do menu principal).
 * Só informação e ações do dispositivo. Administração (perfis, fontes,
 * assinatura, controle parental, desvincular) é do iPlex Gestor; a TV não
 * oferece "sair deste dispositivo".
 * Conteúdo exato desta tela: PROPOSTA (seção 33).
 */
import { useNavigate } from 'react-router-dom'
import { useBackend } from '../../app/providers/BackendProvider'
import { usePlatform } from '../../app/providers/PlatformProvider'
import { useAppLayout } from '../../app/AppLayout'
import { useReadySession, useSession } from '../../app/providers/SessionProvider'
import { ERROR_COPY } from '../../components/feedback/errorCopy'
import { AccountBadge } from '../../components/navigation/AccountBadge'
import { IplexButton } from '../../components/ui/IplexButton'
import { navAttrs } from '../../navigation/navAttrs'
import { classNames } from '../../utils/classNames'
import { IplexCard } from '../../components/ui/IplexCard'
import { IplexText } from '../../components/ui/IplexText'
import { WEB_VERSION } from '../../config/env'
import { FEATURES } from '../../config/features'
import { SECTION_PATHS, startSection } from '../profiles/profileRules'
import { readJson } from '../../utils/storage'
import { formatDateTime } from '../../utils/time'
import { useInitialFocus } from '../../navigation/FocusProvider'
import { useRowNavigation } from '../../navigation/rowNavigation'

const PROFILE_TYPE = { admin: 'Administrador', regular: 'Regular', kids: 'Infantil', guest: 'Visitante' } as const

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="iplex-settings__row">
      <dt className="iplex-settings__label">{label}</dt>
      <dd className="iplex-settings__value">{value}</dd>
    </div>
  )
}

export default function SettingsScreen() {
  const platform = usePlatform()
  const { backend } = useBackend()
  const session = useSession()
  const ready = useReadySession()
  const { openProfiles } = useAppLayout()
  const navigate = useNavigate()
  useInitialFocus('/configuracoes', true)
  // Mesma navegação por fileiras das outras telas: cima/baixo vão à fileira vizinha (o menu só no topo).
  useRowNavigation()

  const account = backend.accountIdentity()
  // Quando a lista foi conferida neste aparelho (reserva se o servidor não informar a data).
  const localSync = readJson<Record<string, number>>(`iplex.sourceSync.v1.${ready.identity.familyId}.${ready.profile.id}`) ?? {}
  /** Troca a lista: volta à página inicial e recarrega tudo desde o começo. */
  const switchSource = (sourceId: string) => {
    navigate(SECTION_PATHS[startSection(ready.profile)], { replace: true })
    void session.selectSource(sourceId)
  }
  const masked = (id: string) => (id.length > 8 ? `${id.slice(0, 4)}••••${id.slice(-4)}` : id)
  const sourceState = ready.spacesError
    ? ERROR_COPY[ready.spacesError.kind].title
    : ready.spaces.length
      ? `${ready.spaces.length} fonte${ready.spaces.length > 1 ? 's' : ''} disponível${ready.spaces.length > 1 ? 'is' : ''} para este perfil`
      : 'Nenhuma fonte configurada'

  return (
    <main className="iplex-page iplex-settings" aria-label="Configurações" data-nav-managed-y="" data-nav-spill-x="">
      <IplexText variant="page-title" className="iplex-page__title">
        Configurações
      </IplexText>
      <div className="iplex-settings__grid">
        <IplexCard compact className="iplex-settings__card">
          <IplexText variant="section-title">Perfil</IplexText>
          <dl>
            <Row label="Perfil atual" value={`${ready.profile.name} (${PROFILE_TYPE[ready.profile.type]})`} />
          </dl>
          <div className="iplex-settings__actions" data-nav-row="x">
            <IplexButton navId="set-switch" autoFocus onClick={openProfiles}>
              Trocar perfil
            </IplexButton>
          </div>
        </IplexCard>

        {account && account.name && (
          <IplexCard compact className="iplex-settings__card">
            <IplexText variant="section-title">Conta</IplexText>
            <AccountBadge account={account} className="iplex-settings__account" />
          </IplexCard>
        )}

        <IplexCard compact className="iplex-settings__card">
          <IplexText variant="section-title">Listas IPTV</IplexText>
          {ready.allSpaces.length === 0 ? (
            <IplexText variant="meta">Nenhuma lista cadastrada. Adicione uma no iPlex Gestor.</IplexText>
          ) : (
            <ul className="iplex-settings__lists" data-nav-row="list">
              {ready.allSpaces.map((space, index) => {
                const current = ready.spaces.some((s) => s.sourceId === space.sourceId)
                const updated = space.lastSyncAt ?? localSync[space.sourceId]
                const name = space.name || `Lista ${index + 1}`
                const date = updated ? `Atualizada em ${formatDateTime(updated)}` : 'Sem registro de atualização'
                return (
                  <li key={space.sourceId} className="iplex-settings__list">
                    {/* Cada lista é um botão: nome e, embaixo, a última atualização. A atual é a destacada. */}
                    <button
                      type="button"
                      className={classNames('iplex-button', current ? 'iplex-button-primary' : 'iplex-button-secondary', 'iplex-settings__source')}
                      {...navAttrs({ navId: `set-source-${space.sourceId}` })}
                      aria-current={current ? 'true' : undefined}
                      aria-label={`${name}${current ? ', lista atual' : ''}. ${date}`}
                      onClick={() => !current && switchSource(space.sourceId)}
                    >
                      <span className="iplex-settings__source-name">{name}</span>
                      <span className="iplex-settings__source-date">{date}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </IplexCard>

        <IplexCard compact className="iplex-settings__card">
          <IplexText variant="section-title">Dispositivo</IplexText>
          <dl>
            <Row label="Plataforma" value={platform.kind === 'tizen' ? 'Samsung Tizen' : platform.kind === 'webos' ? 'LG webOS' : 'Navegador'} />
            {platform.info?.device.model && <Row label="Modelo" value={platform.info.device.model} />}
            <Row label="Identificação" value={masked(ready.identity.deviceId)} />
            <Row label="Conexão" value={platform.online ? 'Conectado' : 'Sem conexão'} />
            <Row label="Fontes IPTV" value={sourceState} />
          </dl>
        </IplexCard>

        <IplexCard compact className="iplex-settings__card">
          <IplexText variant="section-title">Sobre</IplexText>
          <dl>
            <Row label="iPlex Web" value={WEB_VERSION} />
            {platform.info && <Row label="Aplicativo da TV" value={platform.info.appVersion} />}
            {platform.info && <Row label="Ponte" value={`v${platform.info.bridge.version}`} />}
            {platform.info?.platformVersion && <Row label="Sistema" value={platform.info.platformVersion} />}
            <Row label="Reprodução" value={platform.capabilities.nativePlayer ? 'Player nativo da TV' : 'Navegador (HTML5)'} />
            <Row label="Pagamentos" value={FEATURES.paymentsEnabled ? 'Ativos' : 'Gerenciados no iPlex Gestor'} />
            {backend.label === 'mock' && <Row label="Dados" value="Demonstração (desenvolvimento)" />}
          </dl>
          <IplexText variant="caption">Suporte: perfis, fontes, assinatura e desvinculação são gerenciados no iPlex Gestor.</IplexText>
        </IplexCard>
      </div>
    </main>
  )
}
