import { useState } from 'react'
import { classNames } from '../../utils/classNames'

/** Imagem com carregamento progressivo sobre o nome do item (sempre desenhado no fundo). */
export function Artwork({ src, alt, fallback, failedText, className }: { src: string | null | undefined; alt: string; fallback: string; /** Texto mostrado só se a imagem falhar ao carregar (nunca fica um quadro vazio). */ failedText?: string; className?: string }) {
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const show = !!src && !failed
  return (
    <div className={classNames('iplex-artwork', loaded && 'is-loaded', className)}>
      {/* O nome fica sempre no fundo; a imagem, quando existe e carrega, sobrepõe. */}
      {(fallback || (failed && failedText)) && (
        <span className="iplex-artwork__fallback" aria-hidden="true">
          <span className="iplex-artwork__text">{fallback || failedText}</span>
        </span>
      )}
      {show && <img src={src} alt={alt} loading="lazy" decoding="async" referrerPolicy="no-referrer" onLoad={() => setLoaded(true)} onError={() => setFailed(true)} />}
    </div>
  )
}
