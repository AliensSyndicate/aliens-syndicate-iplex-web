import { useState } from 'react'
import { classNames } from '../../utils/classNames'

/** Imagem com carregamento progressivo e alternativa textual quando ausente. */
export function Artwork({ src, alt, fallback, className }: { src: string | null | undefined; alt: string; fallback: string; className?: string }) {
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const show = !!src && !failed
  return (
    <div className={classNames('iplex-artwork', loaded && 'is-loaded', className)}>
      {show ? (
        <img src={src} alt={alt} loading="lazy" decoding="async" onLoad={() => setLoaded(true)} onError={() => setFailed(true)} />
      ) : (
        fallback && (
          <span className="iplex-artwork__fallback" aria-hidden="true">
            <span className="iplex-artwork__text">{fallback}</span>
          </span>
        )
      )}
    </div>
  )
}
