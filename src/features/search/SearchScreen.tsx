/**
 * Busca unificada no catálogo IPTV AUTORIZADO do perfil (o backend aplica as
 * permissões: conteúdo bloqueado não aparece). O TMDB só enriquece os cards;
 * títulos que existem só no TMDB nunca aparecem como reproduzíveis.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { usePlatform } from '../../app/providers/PlatformProvider'
import { useReadySession } from '../../app/providers/SessionProvider'
import { contentPath } from '../../app/routes/paths'
import { ChannelCard } from '../../components/catalog/ChannelCard'
import { ContentCarousel } from '../../components/catalog/ContentCarousel'
import { PosterCard } from '../../components/catalog/PosterCard'
import { EmptyState } from '../../components/feedback/EmptyState'
import { ErrorState } from '../../components/feedback/ErrorState'
import { LoadingState } from '../../components/feedback/LoadingState'
import { IplexText } from '../../components/ui/IplexText'
import { TIMING } from '../../config/features'
import { useInitialFocus } from '../../navigation/FocusProvider'
import { toAppError, type AppError } from '../../services/api/errors'
import type { CatalogItem } from '../../services/api/types'
import { VirtualKeyboard } from './VirtualKeyboard'

type State = { status: 'idle' } | { status: 'loading' } | { status: 'done'; items: CatalogItem[] } | { status: 'error'; error: AppError }

export default function SearchScreen() {
  const platform = usePlatform()
  const navigate = useNavigate()
  const location = useLocation()
  const { catalog, spaces } = useReadySession()
  const params = new URLSearchParams(location.search)
  const [term, setTerm] = useState(params.get('q') ?? '')
  const [state, setState] = useState<State>({ status: 'idle' })
  const [attempt, setAttempt] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  // Mantém o termo na URL (voltar dos detalhes preserva a busca).
  useEffect(() => {
    const id = setTimeout(() => navigate({ search: term ? `?q=${encodeURIComponent(term)}` : '' }, { replace: true }), TIMING.searchDebounceMs)
    return () => clearTimeout(id)
  }, [term, navigate])

  useEffect(() => {
    const q = term.trim()
    if (q.length < TIMING.searchMinLength) {
      setState({ status: 'idle' })
      return
    }
    let alive = true
    const id = setTimeout(() => {
      setState({ status: 'loading' })
      catalog.search(q).then(
        (items) => alive && setState({ status: 'done', items }),
        (e) => alive && setState({ status: 'error', error: toAppError(e) }),
      )
    }, TIMING.searchDebounceMs)
    return () => {
      alive = false
      clearTimeout(id)
    }
  }, [term, catalog, attempt])

  const groups = useMemo(() => {
    if (state.status !== 'done') return null
    const by = (k: CatalogItem['kind']) => state.items.filter((i) => i.kind === k)
    const movies = by('movie')
    const series = by('series')
    const top = movies[0] ?? series[0]
    // Relacionados: mesma categoria do primeiro resultado, entre itens já carregados do catálogo.
    const related = top
      ? catalog.items(top.kind).filter((i) => i.category && i.category === top.category && !state.items.some((r) => r.id === i.id)).slice(0, 20)
      : []
    return { channels: by('channel'), movies, series, related }
  }, [state, catalog])

  useInitialFocus(`${location.pathname}`, true)
  const open = (item: CatalogItem) => navigate(contentPath(item))

  return (
    <main className="iplex-page iplex-search" aria-label="Busca">
      <IplexText variant="page-title" className="iplex-page__title">
        Busca
      </IplexText>
      <div className="iplex-search__layout">
        <div className="iplex-search__input-area">
          <label className="iplex-visually-hidden" htmlFor="iplex-search-input">
            Buscar por título ou canal
          </label>
          <input
            id="iplex-search-input"
            ref={inputRef}
            type="search"
            className="iplex-search__input iplex-focusable"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Filmes, séries ou canais"
            autoComplete="off"
            spellCheck={false}
            readOnly={platform.isTv}
            data-nav=""
            data-nav-id="search-input"
            {...(platform.isTv ? {} : { 'data-nav-autofocus': '' })}
          />
          {platform.isTv && (
            <VirtualKeyboard
              onKey={(k) => setTerm((t) => (t + k).slice(0, 100))}
              onSpace={() => setTerm((t) => (t.endsWith(' ') || !t ? t : `${t} `))}
              onDelete={() => setTerm((t) => t.slice(0, -1))}
              onClear={() => setTerm('')}
            />
          )}
        </div>
        <div className="iplex-search__results" aria-live="polite">
          {spaces.length === 0 && <ErrorState inline kind="iptv-not-configured" />}
          {state.status === 'idle' && spaces.length > 0 && <IplexText variant="description">Digite ao menos {TIMING.searchMinLength} letras para buscar.</IplexText>}
          {state.status === 'loading' && <LoadingState label="Buscando" />}
          {state.status === 'error' && <ErrorState inline error={state.error} onRetry={() => setAttempt((a) => a + 1)} />}
          {groups && !groups.channels.length && !groups.movies.length && !groups.series.length && (
            <EmptyState title="Nenhum resultado" description={`Nada encontrado para “${term.trim()}” nas fontes deste perfil.`} />
          )}
          {groups && groups.channels.length > 0 && (
            <ContentCarousel title="Canais" id="search-channels" shape="channel">
              {groups.channels.map((item) => (
                <ChannelCard key={item.id} item={item} navId={`sr-${item.id}`} navGroup="search-channels" onSelect={open} />
              ))}
            </ContentCarousel>
          )}
          {groups && groups.movies.length > 0 && (
            <ContentCarousel title="Filmes" id="search-movies">
              {groups.movies.map((item) => (
                <PosterCard key={item.id} item={item} navId={`sr-${item.id}`} navGroup="search-movies" onSelect={open} />
              ))}
            </ContentCarousel>
          )}
          {groups && groups.series.length > 0 && (
            <ContentCarousel title="Séries" id="search-series">
              {groups.series.map((item) => (
                <PosterCard key={item.id} item={item} navId={`sr-${item.id}`} navGroup="search-series" onSelect={open} />
              ))}
            </ContentCarousel>
          )}
          {groups && groups.related.length > 0 && (
            <ContentCarousel title="Relacionados" id="search-related">
              {groups.related.map((item) => (
                <PosterCard key={item.id} item={item} navId={`srr-${item.id}`} navGroup="search-related" onSelect={open} />
              ))}
            </ContentCarousel>
          )}
        </div>
      </div>
    </main>
  )
}
