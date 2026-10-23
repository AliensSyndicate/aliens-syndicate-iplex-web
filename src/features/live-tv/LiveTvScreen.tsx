/**
 * Ao Vivo: categorias e canais da fonte IPTV autorizada.
 * - Categorias vêm da fonte (nenhuma categoria fixa inventada).
 * - EPG só quando o backend fornece; sem EPG o canal aparece normalmente.
 * - Último canal NÃO abre sozinho (FEATURES.autoplayLastChannel = false).
 * Organização final do guia: PROPOSTA (seção 33).
 */
import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useBackend } from '../../app/providers/BackendProvider'
import { useReadySession } from '../../app/providers/SessionProvider'
import { PATHS } from '../../app/routes/paths'
import { ChannelCard } from '../../components/catalog/ChannelCard'
import { ProgressBar } from '../../components/catalog/ProgressBar'
import { EmptyState } from '../../components/feedback/EmptyState'
import { SkeletonRow } from '../../components/feedback/LoadingState'
import { SourceStates } from '../../components/feedback/SourceStates'
import { IplexButton } from '../../components/ui/IplexButton'
import { IplexText } from '../../components/ui/IplexText'
import { useCatalog } from '../../hooks/useCatalog'
import { useLibrary } from '../../hooks/useLibrary'
import { useInitialFocus } from '../../navigation/FocusProvider'
import type { CatalogItem, EpgResult, Programme } from '../../services/api/types'
import { hasPersonalLibrary } from '../profiles/profileRules'
import { formatClock } from '../../utils/time'

const ALL = '__all'
const FAVORITES = '__favorites'
const PAGE = 48

function useEpg(channel: CatalogItem | null): EpgResult | null {
  const { backend } = useBackend()
  const [result, setResult] = useState<EpgResult | null>(null)
  useEffect(() => {
    setResult(null)
    if (!channel?.epgId) return
    let alive = true
    const id = setTimeout(() => {
      backend.readEpg(channel.sourceId, channel.epgId!).then(
        (value) => alive && setResult(value),
        () => alive && setResult({ supported: false }),
      )
    }, 400)
    return () => {
      alive = false
      clearTimeout(id)
    }
  }, [backend, channel])
  return result
}

function nowNext(programmes: Programme[], now: number) {
  const current = programmes.find((p) => p.startAt <= now && p.endAt > now) ?? null
  const next = programmes.find((p) => p.startAt >= (current?.endAt ?? now)) ?? null
  return { current, next }
}

export default function LiveTvScreen() {
  const navigate = useNavigate()
  const location = useLocation()
  const session = useReadySession()
  const { items, categories, loading, error, spacesError, noSources, noKind, reload, loadMore, hasMore } = useCatalog('channel')
  const { store, library } = useLibrary()
  const personal = hasPersonalLibrary(session.profile)
  const [category, setCategory] = useState(ALL)
  const [limit, setLimit] = useState(PAGE)
  const [focused, setFocused] = useState<CatalogItem | null>(null)
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])

  const favoriteIds = useMemo(() => new Set(library.favorites.map((f) => f.contentId)), [library.favorites])
  const channels = useMemo(() => {
    if (category === ALL) return items
    if (category === FAVORITES) return items.filter((i) => favoriteIds.has(i.id))
    return categories.find((c) => c.key === category)?.items ?? []
  }, [category, items, categories, favoriteIds])

  const epg = useEpg(focused)
  const guide = epg && epg.supported ? nowNext(epg.programmes, now) : null

  const ready = items.length > 0 || !!error || !!spacesError || noSources || noKind || (!loading && !hasMore)
  useInitialFocus(`${location.pathname}${location.search}`, ready)

  const play = (item: CatalogItem) => navigate(PATHS.watch({ sourceId: item.sourceId, itemId: item.id, kind: 'channel', title: item.title }))
  const toggleFavorite = async (item: CatalogItem) => {
    setBusy(true)
    try {
      await store.setFavorite(item, !favoriteIds.has(item.id))
    } catch {
      // estado revertido pelo store
    } finally {
      setBusy(false)
    }
  }

  const chips = [
    { key: ALL, name: 'Todos' },
    ...(personal && favoriteIds.size > 0 ? [{ key: FAVORITES, name: 'Favoritos' }] : []),
    ...categories.map((c) => ({ key: c.key, name: c.name })),
  ]

  return (
    <main className="iplex-page iplex-live" aria-label="Ao Vivo">
      <IplexText variant="page-title" className="iplex-page__title">
        Ao Vivo
      </IplexText>
      <SourceStates spacesError={spacesError} noSources={noSources} noKind={noKind} error={error} kindLabel="TV ao vivo" onRetry={reload} />

      {focused && (
        <section className="iplex-live__info" aria-live="polite" aria-label="Canal selecionado">
          <div className="iplex-live__info-text">
            <IplexText variant="section-title" as="p">{focused.title}</IplexText>
            {focused.category && <IplexText variant="meta">{focused.category}</IplexText>}
            {guide?.current ? (
              <div className="iplex-live__epg">
                <IplexText variant="content-title" as="p">
                  Agora: {guide.current.title}
                </IplexText>
                <IplexText variant="meta">
                  {formatClock(guide.current.startAt)} – {formatClock(guide.current.endAt)}
                </IplexText>
                <ProgressBar value={(now - guide.current.startAt) / (guide.current.endAt - guide.current.startAt)} label="Andamento do programa" />
                {guide.next && (
                  <IplexText variant="meta">
                    A seguir: {formatClock(guide.next.startAt)} · {guide.next.title}
                  </IplexText>
                )}
              </div>
            ) : null}
          </div>
          <div className="iplex-live__info-actions" data-nav-group-root="live-actions">
            <IplexButton navId="live-watch" navGroup="live-actions" onClick={() => play(focused)}>
              Assistir
            </IplexButton>
            {personal && (
              <IplexButton variant="secondary" navId="live-favorite" navGroup="live-actions" disabled={busy} onClick={() => void toggleFavorite(focused)}>
                {favoriteIds.has(focused.id) ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}
              </IplexButton>
            )}
          </div>
        </section>
      )}

      {chips.length > 1 && (
        <div className="iplex-chips" data-nav-scroll="x" role="tablist" aria-label="Categorias" data-nav-group-root="live-categories">
          {chips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              role="tab"
              aria-selected={chip.key === category}
              className={chip.key === category ? 'iplex-chip iplex-focusable is-active' : 'iplex-chip iplex-focusable'}
              onClick={() => {
                setCategory(chip.key)
                setLimit(PAGE)
              }}
              data-nav=""
              data-nav-id={`chip-${chip.key}`}
              data-nav-group="live-categories"
              {...(chip.key === category ? { 'data-nav-preferred': '' } : {})}
            >
              {chip.name}
            </button>
          ))}
        </div>
      )}

      <div className="iplex-grid" role="list" aria-label="Canais" data-nav-group-root="live-grid">
        {channels.slice(0, limit).map((item, index) => (
          <ChannelCard
            key={item.id}
            item={item}
            navId={`channel-${item.id}`}
            navGroup="live-grid"
            onSelect={play}
            onFocus={setFocused}
            favorite={favoriteIds.has(item.id)}
            autoFocus={index === 0}
          />
        ))}
      </div>
      {loading && channels.length === 0 && <SkeletonRow shape="channel" count={15} />}
      {!loading && ready && channels.length === 0 && !error && !spacesError && !noSources && !noKind && (
        <EmptyState title="Nenhum canal nesta categoria" />
      )}
      {(channels.length > limit || (hasMore && category === ALL)) && !loading && (
        <div className="iplex-page__more">
          <IplexButton
            variant="secondary"
            navId="live-more"
            onClick={() => {
              if (channels.length > limit) setLimit((l) => l + PAGE)
              else loadMore()
            }}
          >
            Carregar mais canais
          </IplexButton>
        </div>
      )}
    </main>
  )
}
