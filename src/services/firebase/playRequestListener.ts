/**
 * Ouvinte dos pedidos de reprodução do iPlex Control para esta TV
 * (families/{fid}/devices/{did}/play_requests, status "pending").
 *
 * Somente leitura, permitida pelas regras do Firestore apenas à TV dona com a
 * credencial atual. O pedido em si só é aceito via `claimPlayRequest`
 * (backend), uma vez e antes de expirar. Carregado sob demanda.
 */
import type { FirebaseApp } from 'firebase/app'
import { collection, connectFirestoreEmulator, initializeFirestore, onSnapshot, query, where, type Firestore } from 'firebase/firestore'
import { EMULATOR_HOST } from '../../config/env'
import type { DeviceIdentity, PlayRequestNotice } from '../api/types'
import { isAccessMarker, isRevocationMarker, parsePlayRequestDoc } from '../api/validation'
import { diag } from '../../platform/diagnostics'

let db: Firestore | null = null

function firestore(app: FirebaseApp): Firestore {
  if (db) return db
  // Long polling detectado automaticamente: proxies e WebViews antigas (Tizen 5.5).
  db = initializeFirestore(app, { experimentalAutoDetectLongPolling: true })
  if (import.meta.env.MODE === 'emulator' && EMULATOR_HOST) connectFirestoreEmulator(db, EMULATOR_HOST, 8080)
  return db
}

export function listenPlayRequests(
  app: FirebaseApp,
  identity: DeviceIdentity,
  onPending: (notice: PlayRequestNotice) => void,
  onError: (reason: 'revoked' | 'unavailable') => void,
  onAccess?: () => void,
): () => void {
  const ref = collection(firestore(app), 'families', identity.familyId, 'devices', identity.deviceId, 'play_requests')
  const seen = new Set<string>()
  let lastAccess = 0
  return onSnapshot(
    // "revoked": marcador gravado pelo backend ao desvincular. As regras não são
    // reavaliadas para um ouvinte já aberto; o marcador avisa na hora e a TV
    // confirma a credencial no backend (heartbeat) antes de voltar à vinculação.
    query(ref, where('status', 'in', ['pending', 'revoked', 'access'])),
    (snapshot) => {
      const now = Date.now()
      if (snapshot.docs.some((doc) => isRevocationMarker(doc.data(), now))) {
        diag('remote', 'unlink marker')
        onError('revoked')
        return
      }
      // Permissões mudaram no Control: relê já (cada aviso novo tem um createdAt maior).
      for (const doc of snapshot.docs) {
        const data = doc.data()
        if (isAccessMarker(data, now) && data.createdAt > lastAccess) {
          lastAccess = data.createdAt
          diag('remote', 'access marker')
          onAccess?.()
        }
      }
      const pending = snapshot.docs
        .map((doc) => parsePlayRequestDoc(doc.id, doc.data(), now))
        .filter((n): n is PlayRequestNotice => !!n && !seen.has(n.id))
        // O mais recente vence; o backend já marca os anteriores como substituídos.
        .sort((a, b) => b.expiresAt - a.expiresAt)
      const latest = pending[0]
      if (latest) {
        seen.add(latest.id)
        diag('remote', `play request ${latest.id}`)
        onPending(latest)
      }
    },
    (error) => {
      diag('remote', `listener ${error.code}`)
      // permission-denied: dispositivo excluído ou credencial antiga (re-pareado).
      onError(error.code === 'permission-denied' || error.code === 'unauthenticated' ? 'revoked' : 'unavailable')
    },
  )
}
