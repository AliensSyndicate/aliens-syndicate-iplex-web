import { useState } from 'react'
import { classNames } from '../../utils/classNames'

/** Imagem com carregamento progressivo sobre o nome do item (sempre desenhado no fundo). */
export function Artwork({ src, alt, fallback, className }: { src: string | null | undefined; alt: string; fallback: string; className?: string }) {
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const show = !!src && !failed
  return (
    <div className={classNames('iplex-artwork', loaded && 'is-loaded', className)}>
      {/* O nome fica sempre no fundo; a imagem, quando existe e carrega, sobrepõe. */}
      {fallback && (
        <span className="iplex-artwork__fallback" aria-hidden="true">
          <span className="iplex-artwork__text">{fallback}</span>
        </span>
      )}
      {show && <img src={src} alt={alt} loading="lazy" decoding="async" onLoad={() => setLoaded(true)} onError={() => setFailed(true)} />}
    </div>
  )
}
