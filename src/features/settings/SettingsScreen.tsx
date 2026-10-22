/**
 * Configurações (acesso pelo menu do avatar; não é aba do menu principal).
 * Só informação e ações do dispositivo. Administração (perfis, fontes,
 * assinatura, controle parental, desvincular) é do iPlex Gestor.
 * Conteúdo exato desta tela: PROPOSTA (seção 33).
 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useBackend } from '../../app/providers/BackendProvider'
import { usePlatform } from '../../app/providers/PlatformProvider'
import { useReadySession, useSession } from '../../app/providers/SessionProvider'
import { ConfirmDialog } from '../../components/dialogs/ConfirmDialog'
import { ERROR_COPY } from '../../components/feedback/errorCopy'
import { AccountBadge } from '../../components/navigation/AccountBadge'
import { IplexButton } from '../../components/ui/IplexButton'
import { IplexCard } from '../../components/ui/IplexCard'
import { IplexText } from '../../components/ui/IplexText'
import { WEB_VERSION } from '../../config/env'
import { FEATURES } from '../../config/features'
import { useInitialFocus } from '../../navigation/FocusProvider'

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
  const navigate = useNavigate()
  const [confirm, setConfirm] = useState(false)
  useInitialFocus('/configuracoes', true)

  const account = backend.accountIdentity()
  const masked = (id: string) => (id.length > 8 ? `${id.slice(0, 4)}••••${id.slice(-4)}` : id)
  const sourceState = ready.spacesError
    ? ERROR_COPY[ready.spacesError.kind].title
    : ready.spaces.length
      ? `${ready.spaces.length} fonte${ready.spaces.length > 1 ? 's' : ''} disponível${ready.spaces.length > 1 ? 'is' : ''} para este perfil`
      : 'Nenhuma fonte configurada'

  return (
    <main className="iplex-page iplex-settings" aria-label="Configurações">
      <IplexText variant="page-title" className="iplex-page__title">
        Configurações
      </IplexText>
      <div className="iplex-settings__grid">
        <IplexCard compact className="iplex-settings__card">
          <IplexText variant="section-title">Perfil</IplexText>
          <dl>
            <Row label="Perfil atual" value={`${ready.profile.name} (${PROFILE_TYPE[ready.profile.type]})`} />
          </dl>
          <div className="iplex-settings__actions">
            <IplexButton navId="set-switch" autoFocus onClick={() => void session.switchProfile()}>
              Trocar perfil
            </IplexButton>
          </div>
        </IplexCard>

        {account && account.name && (
          <IplexCard compact className="iplex-settings__card">
            <IplexText variant="section-title">Conta</IplexText>
            <AccountBadge account={account} />
          </IplexCard>
        )}

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
      {ready.profile.type === 'admin' && (
        <div className="iplex-settings__danger">
          <IplexButton variant="secondary" navId="set-forget" onClick={() => setConfirm(true)}>
            Sair deste dispositivo
          </IplexButton>
          <IplexText variant="caption">Remove a credencial desta TV. Para desvincular de vez, use o iPlex Gestor.</IplexText>
        </div>
      )}
      {confirm && (
        <ConfirmDialog
          title="Sair deste dispositivo?"
          description="A TV volta para a tela de vinculação. O vínculo no iPlex Gestor só é removido por lá."
          confirmLabel="Sair"
          onCancel={() => setConfirm(false)}
          onConfirm={() => {
            setConfirm(false)
            navigate('/', { replace: true })
            void session.forgetDevice()
          }}
        />
      )}
    </main>
  )
}
