/**
 * Pedidos de reprodução do iPlex Control (celular → backend → esta TV).
 *
 * O Control não é controle remoto: ele só pede para INICIAR um título. Aqui:
 *  - o ouvinte do Firestore (ou, na falta dele, o heartbeat) avisa que há pedido;
 *  - o pedido é aceito pelo backend (claimPlayRequest): uma vez, antes de expirar,
 *    revalidando o perfil ativo, a assinatura e a visibilidade do conteúdo;
 *  - política de transição: sem reprodução em andamento, inicia direto; com
 *    reprodução em andamento, pergunta na TV ("Assistir agora" / "Continuar
 *    assistindo"), sem substituir em silêncio;
 *  - na seleção de perfis, o pedido espera a escolha do perfil (até expirar);
 *  - o resultado (iniciado, recusado, falhou) volta ao celular.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useBackend } from '../../app/providers/BackendProvider'
import { useSession } from '../../app/providers/SessionProvider'
import { PATHS } from '../../app/routes/paths'
import { ConfirmDialog } from '../../components/dialogs/ConfirmDialog'
import { IplexText } from '../../components/ui/IplexText'
import { toAppError } from '../../services/api/errors'
import type { PlayRequestContent, PlayRequestNotice } from '../../services/api/types'
import { isPlaybackActive, playRequestFailureCopy, reportPlayRequest } from './playRequestReport'

/** Sem resposta na TV dentro deste prazo, o pedido é recusado (o atual continua). */
export const CONFIRM_TIMEOUT_MS = 40_000
const TOAST_MS = 7_000

export function playRequestPath(id: string, r: PlayRequestContent): string {
  if (r.kind === 'series' && !r.episodeId) return PATHS.details(r.sourceId, r.itemId, r.title)
  const path = PATHS.watch({ sourceId: r.sourceId, itemId: r.itemId, kind: r.kind, title: r.title, ...(r.episodeId ? { episodeId: r.episodeId } : {}), ...(r.resume ? { resume: true } : {}), ...(r.resume && r.resumePositionSec ? { resumeAtSec: r.resumePositionSec } : {}) })
  return `${path}&pr=${encodeURIComponent(id)}`
}

const describe = (r: Pick<PlayRequestContent, 'title' | 'episodeLabel'>) => (r.episodeLabel ? `${r.title} · ${r.episodeLabel}` : r.title)

export function PlayRequestCoordinator() {
  const session = useSession()
  const { state } = session
  const { backend } = useBackend()
  const navigate = useNavigate()

  const [waiting, setWaiting] = useState<PlayRequestNotice | null>(null)
  const [confirm, setConfirm] = useState<{ id: string; request: PlayRequestContent } | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const handled = useRef(new Set<string>())

  const identity = state.status === 'choosing' || state.status === 'ready' ? state.identity : null
  const deviceKey = identity ? `${identity.familyId}/${identity.deviceId}` : null
  // Ref: a API da sessão muda a cada estado; o ouvinte não deve ser recriado por isso.
  const checkRef = useRef(session.checkDevice)
  useEffect(() => {
    checkRef.current = session.checkDevice
  }, [session.checkDevice])
  const checkDevice = useCallback(() => checkRef.current(), [])

  // Ouvinte em tempo real enquanto a TV está pareada (seleção de perfis ou app aberto).
  useEffect(() => {
    if (!identity) return
    return backend.watchPlayRequests(
      identity,
      (notice) => {
        if (!handled.current.has(notice.id)) setWaiting(notice)
      },
      (reason) => {
        // Sem permissão de leitura: dispositivo excluído ou re-pareado → confirma já.
        if (reason === 'revoked') void checkDevice()
      },
      () => void session.refreshAccess(),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backend, deviceKey])

  // Reserva: o heartbeat informa pedido pendente se o ouvinte não estiver disponível.
  const onHeartbeat = session.onHeartbeat
  useEffect(
    () =>
      onHeartbeat(({ playRequest }) => {
        if (playRequest && !handled.current.has(playRequest.id)) {
          setWaiting((current) => (current?.id === playRequest.id ? current : { id: playRequest.id, expiresAt: playRequest.expiresAt, requesterName: '', title: '' }))
        }
      }),
    [onHeartbeat],
  )

  useEffect(() => {
    if (!toast) return
    const id = setTimeout(() => setToast(null), TOAST_MS)
    return () => clearTimeout(id)
  }, [toast])

  // O pedido em espera (seleção de perfis) vale só até expirar.
  useEffect(() => {
    if (!waiting) return
    const id = setTimeout(() => setWaiting((w) => (w === waiting ? null : w)), Math.max(0, waiting.expiresAt - Date.now()))
    return () => clearTimeout(id)
  }, [waiting])

  const decline = useCallback(
    (id: string, code: 'busy' | 'no-answer') => {
      setConfirm((c) => (c?.id === id ? null : c))
      reportPlayRequest(backend, id, 'declined', code)
    },
    [backend],
  )

  // Processa quando há perfil ativo.
  const ready = state.status === 'ready'
  useEffect(() => {
    if (!waiting || !ready || handled.current.has(waiting.id)) return
    const notice = waiting
    handled.current.add(notice.id)
    setWaiting(null)
    if (notice.expiresAt <= Date.now()) return
    void (async () => {
      let claim
      try {
        claim = await backend.claimPlayRequest(notice.id)
      } catch (raw) {
        const error = toAppError(raw)
        if (error.kind === 'device-unpaired') void checkDevice()
        // Já atendido, substituído ou expirado: nada a fazer na TV.
        return
      }
      if (claim.status !== 'delivered') {
        if (claim.status === 'failed') setToast(playRequestFailureCopy(claim.errorCode))
        return
      }
      const target = playRequestPath(claim.id, claim.request)
      if (isPlaybackActive()) {
        // Reprodução em andamento: nunca substituir sem a confirmação na TV.
        await backend.updatePlayRequest(claim.id, 'confirming').catch(() => undefined)
        setConfirm({ id: claim.id, request: claim.request })
        return
      }
      if (claim.request.kind === 'series' && !claim.request.episodeId) reportPlayRequest(backend, claim.id, 'started')
      navigate(target)
    })()
  }, [waiting, ready, backend, navigate, checkDevice])

  useEffect(() => {
    if (!confirm) return
    const id = setTimeout(() => decline(confirm.id, 'no-answer'), CONFIRM_TIMEOUT_MS)
    return () => clearTimeout(id)
  }, [confirm, decline])

  return (
    <>
      {waiting && state.status === 'choosing' && (
        <div className="iplex-remote-toast" role="status">
          <IplexText variant="meta" as="p">
            {waiting.requesterName ? `${waiting.requesterName} pediu para assistir ` : 'Pedido do celular para assistir '}
            {waiting.title ? `“${waiting.title}”` : 'um conteúdo'}. Escolha um perfil para continuar.
          </IplexText>
        </div>
      )}
      {toast && !confirm && (
        <div className="iplex-remote-toast" role="status">
          <IplexText variant="meta" as="p">{toast}</IplexText>
        </div>
      )}
      {confirm && (
        <ConfirmDialog
          title="Pedido de reprodução"
          description={`${confirm.request.requesterName || 'Alguém'} quer assistir “${describe(confirm.request)}” nesta TV. A reprodução atual será interrompida.`}
          confirmLabel="Assistir agora"
          cancelLabel="Continuar assistindo"
          onCancel={() => decline(confirm.id, 'busy')}
          onConfirm={() => {
            const { id, request } = confirm
            setConfirm(null)
            if (request.kind === 'series' && !request.episodeId) reportPlayRequest(backend, id, 'started')
            navigate(playRequestPath(id, request), { replace: true })
          }}
        />
      )}
    </>
  )
}
