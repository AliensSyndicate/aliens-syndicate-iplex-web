import { useEffect, useState, type RefObject } from 'react'
import { ProgressBar } from '../../components/catalog/ProgressBar'
import { IplexButton } from '../../components/ui/IplexButton'
import { IplexText } from '../../components/ui/IplexText'
import type { CatalogItem } from '../../services/api/types'
import { categoryLabel } from '../../services/catalog/categoryLabels'
import { formatClock } from '../../utils/time'
import { nowNext, useEpg } from './useEpg'

/**
 * Painel expansível do canal selecionado, na largura do grid (acima da primeira linha).
 * Dados: programação da fonte IPTV (EPG) quando existe; senão o que a própria lista traz
 * (nome e categoria). Não há API pública confiável de dados de canais, então nada é inventado.
 * Botões: Assistir (liga o áudio) e Favoritar.
 */
export function LiveChannelPanel({
  panelRef,
  channel,
  open,
  favorite,
  canFavorite,
  canWatch = true,
  busy,
  onWatch,
  onToggleFavorite,
  onLayout,
}: {
  panelRef: RefObject<HTMLElement | null>
  channel: CatalogItem | null
  open: boolean
  favorite: boolean
  canFavorite: boolean
  canWatch?: boolean
  busy: boolean
  onWatch: () => void
  onToggleFavorite: () => void
  onLayout: () => void
}) {
  // Monta fechado e abre no quadro seguinte: a animação de abrir/fechar é uma transição de CSS.
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setShown(open), 30)
    return () => clearTimeout(timer)
  }, [open])
  const epg = useEpg(channel)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])
  const guide = epg && epg.supported ? nowNext(epg.programmes, now) : null
  const current = guide?.current ?? null
  // O texto muda de altura quando a programação chega: o grid refaz a conta da janela.
  useEffect(() => {
    onLayout()
  }, [onLayout, epg, current?.title, shown])

  return (
    <section ref={panelRef} className={`iplex-live-panel${shown ? ' is-open' : ''}`} aria-hidden={shown ? undefined : true} aria-label="Canal selecionado" aria-live="polite" onTransitionEnd={onLayout}>
      <div className="iplex-live-panel__inner">
        {channel && (
          <div className="iplex-live-panel__text">
            <IplexText variant="section-title" as="p">{channel.title}</IplexText>
            <IplexText variant="meta">{[channel.category ? categoryLabel(channel.category) : null, 'Ao vivo'].filter(Boolean).join(' · ')}</IplexText>
            {current ? (
              <div className="iplex-live-panel__epg">
                <IplexText variant="content-title" as="p">Agora: {current.title}</IplexText>
                <IplexText variant="meta">
                  {formatClock(current.startAt)} – {formatClock(current.endAt)}
                  {guide?.next ? ` · A seguir: ${formatClock(guide.next.startAt)} ${guide.next.title}` : ''}
                </IplexText>
                {current.description && <IplexText variant="meta">{current.description}</IplexText>}
                <div className="iplex-live-panel__progress">
                  <ProgressBar value={(now - current.startAt) / (current.endAt - current.startAt)} label="Andamento do programa" />
                </div>
              </div>
            ) : (
              <IplexText variant="meta">{channel.epgId ? (epg ? 'Programação indisponível para este canal.' : 'Buscando programação…') : 'Este canal não informa programação.'}</IplexText>
            )}
          </div>
        )}
        <div className="iplex-live-panel__actions" data-nav-group-root="live-panel">
          {canWatch && (
            <IplexButton navId="live-watch" navGroup="live-panel" onClick={onWatch}>
              Assistir
            </IplexButton>
          )}
          {canFavorite && (
            <IplexButton variant="secondary" navId="live-favorite" navGroup="live-panel" disabled={busy} onClick={onToggleFavorite}>
              {favorite ? 'Desfavoritar' : 'Favoritar'}
            </IplexButton>
          )}
        </div>
      </div>
    </section>
  )
}
