import { useEffect, useRef, useState } from 'react'
import { FEATURES } from '../../config/features'
import { toAppError } from '../../services/api/errors'
import { IplexButton } from '../ui/IplexButton'
import { IplexText } from '../ui/IplexText'
import { Dialog } from './Dialog'

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'back'] as const
const LOCK_KEY = 'iplex.pin.lock.v1'

function readLock(): { until: number; attempts: number } {
  try {
    const raw = window.sessionStorage.getItem(LOCK_KEY)
    return raw ? JSON.parse(raw) : { until: 0, attempts: 0 }
  } catch {
    return { until: 0, attempts: 0 }
  }
}
function writeLock(value: { until: number; attempts: number }) {
  try {
    window.sessionStorage.setItem(LOCK_KEY, JSON.stringify(value))
  } catch {
    // sem armazenamento: o limite do backend continua valendo
  }
}

/**
 * PIN de perfil. O PIN nunca é guardado nem comparado no cliente: é enviado
 * para validação (verify) e descartado. Limite de tentativas local como
 * camada adicional; o limite de verdade deve ser do backend.
 */
export function PinDialog({ profileName, verify, onSuccess, onCancel }: { profileName: string; verify: (pin: string) => Promise<boolean>; onSuccess: () => void; onCancel: () => void }) {
  const [pin, setPinState] = useState('')
  // Ref: teclas em sequência rápida (repetição do controle) não perdem dígitos.
  const pinRef = useRef('')
  const setPin = (value: string | ((p: string) => string)) => {
    const next = typeof value === 'function' ? value(pinRef.current) : value
    pinRef.current = next
    setPinState(next)
  }
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [lock, setLock] = useState(readLock)
  const [now, setNow] = useState(() => Date.now())
  const locked = lock.until > now
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  useEffect(() => {
    if (!locked) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [locked])

  const submit = async (value: string) => {
    if (busy || locked) return
    setBusy(true)
    setMessage(null)
    try {
      const ok = await verify(value)
      if (!alive.current) return
      if (ok) {
        writeLock({ until: 0, attempts: 0 })
        onSuccess()
        return
      }
      const attempts = lock.attempts + 1
      const next = attempts >= FEATURES.pinMaxAttempts ? { until: Date.now() + FEATURES.pinLockoutMs, attempts: 0 } : { until: 0, attempts }
      writeLock(next)
      setLock(next)
      setNow(Date.now())
      setMessage(next.until ? 'Muitas tentativas. Aguarde um minuto.' : 'PIN incorreto.')
      setPin('')
    } catch (error) {
      if (!alive.current) return
      const appError = toAppError(error)
      setMessage(
        appError.kind === 'not-supported'
          ? 'A proteção por PIN ainda não está disponível no servidor. Por segurança, este perfil não pode ser aberto nesta TV enquanto houver perfil infantil na família.'
          : appError.kind === 'rate-limited'
            ? 'Muitas tentativas. Aguarde antes de tentar de novo.'
            : 'Não foi possível validar o PIN. Tente novamente.',
      )
      setPin('')
    } finally {
      if (alive.current) setBusy(false)
    }
  }

  const press = (key: (typeof KEYS)[number]) => {
    if (locked || busy) return
    if (key === 'clear') return setPin('')
    if (key === 'back') return setPin((p) => p.slice(0, -1))
    const next = (pinRef.current + key).slice(0, 4)
    setPin(next)
    if (next.length === 4) void submit(next)
  }

  const remaining = Math.max(0, Math.ceil((lock.until - now) / 1000))
  return (
    <Dialog title="Digite o PIN" description={`O perfil ${profileName} é protegido porque há um perfil infantil na família.`} onClose={onCancel}>
      <div className="iplex-pin__dots" aria-label={`${pin.length} de 4 dígitos digitados`} role="status">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={i < pin.length ? 'iplex-pin__dot is-filled' : 'iplex-pin__dot'} />
        ))}
      </div>
      {(message || locked) && (
        <IplexText variant="meta" className="iplex-pin__message">
          {locked ? `Muitas tentativas. Tente novamente em ${remaining} s.` : message}
        </IplexText>
      )}
      <div className="iplex-pin__pad" role="group" aria-label="Teclado numérico">
        {KEYS.map((key, index) => (
          <button
            key={key}
            type="button"
            className="iplex-pin__key iplex-focusable"
            onClick={() => press(key)}
            disabled={busy || locked}
            aria-label={key === 'clear' ? 'Limpar' : key === 'back' ? 'Apagar' : key}
            data-nav=""
            data-nav-id={`pin-${key}`}
            {...(index === 0 ? { 'data-nav-autofocus': '' } : {})}
          >
            {key === 'clear' ? 'Limpar' : key === 'back' ? 'Apagar' : key}
          </button>
        ))}
      </div>
      <div className="iplex-dialog__actions">
        <IplexButton variant="secondary" onClick={onCancel} navId="pin-cancel">
          Cancelar
        </IplexButton>
      </div>
    </Dialog>
  )
}
