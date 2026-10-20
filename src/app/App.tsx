import { lazy, useCallback, useState } from 'react'
import { BrowserRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { ConfirmDialog } from '../components/dialogs/ConfirmDialog'
import { ErrorState } from '../components/feedback/ErrorState'
import { PairingScreen } from '../features/pairing/PairingScreen'
import { SECTION_PATHS, sectionForPath, startSection } from '../features/profiles/profileRules'
import { ProfileSelectScreen } from '../features/profiles/ProfileSelectScreen'
import { SplashScreen } from '../features/startup/SplashScreen'
import { FocusProvider } from '../navigation/FocusProvider'
import { focusElement, navigables } from '../navigation/spatial'
import { DevBadge } from '../dev/DevBadge'
import { AppLayout } from './AppLayout'
import type { Backend } from '../services/api/backend'
import type { detectPlatform } from '../platform/environment'
import type { TypographyResult } from '../styles/fonts'
import { TypographyGate } from './TypographyGate'
import { BackendProvider } from './providers/BackendProvider'
import { PlatformProvider, usePlatform } from './providers/PlatformProvider'
import { SessionProvider, useSession, type StartupStep } from './providers/SessionProvider'
import { ProfileRoute, StartRedirect } from './routes/guards'

const MyIplexScreen = lazy(() => import('../features/my-iplex/MyIplexScreen'))
const SearchScreen = lazy(() => import('../features/search/SearchScreen'))
const LiveTvScreen = lazy(() => import('../features/live-tv/LiveTvScreen'))
const MoviesScreen = lazy(() => import('../features/movies/MoviesScreen'))
const SeriesScreen = lazy(() => import('../features/series/SeriesScreen'))
const DetailsScreen = lazy(() => import('../features/details/DetailsScreen'))
const PlayerScreen = lazy(() => import('../features/playback/PlayerScreen'))
const SettingsScreen = lazy(() => import('../features/settings/SettingsScreen'))

const STEP_LABEL: Record<StartupStep, string> = {
  device: 'Verificando este dispositivo',
  profiles: 'Carregando perfis',
  session: 'Validando acesso',
  catalog: 'Carregando suas fontes',
}

function SessionGate() {
  const session = useSession()
  const { state } = session
  if (state.status === 'starting') return <SplashScreen label={STEP_LABEL[state.step]} />
  if (state.status === 'pairing') return <PairingScreen />
  if (state.status === 'choosing') return <ProfileSelectScreen profiles={state.profiles} notice={state.notice} />
  if (state.status === 'blocked') {
    const canSwitch = state.profiles.length > 1 && ['session-limit', 'profile-in-use', 'profile-unavailable', 'session-expired'].includes(state.error.kind)
    return (
      <ErrorState
        error={state.error}
        onRetry={state.error.kind === 'device-unpaired' ? () => void session.forgetDevice() : session.retry}
        secondary={canSwitch ? { label: 'Trocar perfil', onClick: () => void session.switchProfile().then(() => undefined, () => session.retry()) } : undefined}
      />
    )
  }
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<StartRedirect />} />
        <Route path={SECTION_PATHS['my-iplex']} element={<ProfileRoute><MyIplexScreen /></ProfileRoute>} />
        <Route path={SECTION_PATHS.search} element={<SearchScreen />} />
        <Route path={SECTION_PATHS.live} element={<LiveTvScreen />} />
        <Route path={SECTION_PATHS.movies} element={<MoviesScreen />} />
        <Route path={SECTION_PATHS.series} element={<SeriesScreen />} />
        <Route path="/titulo/:sourceId/:itemId" element={<DetailsScreen />} />
        <Route path="/assistir" element={<PlayerScreen />} />
        <Route path="/configuracoes" element={<SettingsScreen />} />
        <Route path="*" element={<StartRedirect />} />
      </Route>
    </Routes>
  )
}

/**
 * Back padrão (quando nenhum diálogo/tela tratou):
 *  - telas internas (detalhes, player, configurações) → volta uma tela;
 *  - seção com foco no conteúdo → leva o foco ao menu;
 *  - menu numa seção que não é a inicial → vai para a inicial;
 *  - seção inicial → confirma a saída (somente dentro do app da TV).
 */
function Navigation() {
  const platform = usePlatform()
  const session = useSession()
  const navigate = useNavigate()
  const location = useLocation()
  const [confirmExit, setConfirmExit] = useState(false)

  const onDefaultBack = useCallback(() => {
    const { state } = session
    if (state.status !== 'ready') {
      if (platform.capabilities.exit) setConfirmExit(true)
      return
    }
    const section = sectionForPath(location.pathname)
    if (!section) {
      if (window.history.length > 1 && (window.history.state as { idx?: number } | null)?.idx) navigate(-1)
      else navigate(SECTION_PATHS[startSection(state.profile)], { replace: true })
      return
    }
    const active = document.activeElement
    const inHeader = active instanceof HTMLElement && !!active.closest('.iplex-header')
    if (!inHeader) {
      const tab = navigables().find((el) => el.hasAttribute('data-nav-preferred')) ?? navigables().find((el) => el.closest('.iplex-header'))
      if (tab) {
        focusElement(tab)
        window.scrollTo(0, 0)
        return
      }
    }
    const start = startSection(state.profile)
    if (section !== start) {
      navigate(SECTION_PATHS[start])
      return
    }
    if (platform.capabilities.exit) setConfirmExit(true)
  }, [session, platform.capabilities.exit, location.pathname, navigate])

  return (
    <FocusProvider platformKeys={platform.keys} onDefaultBack={onDefaultBack} routeKey={`${location.pathname}${location.search}`}>
      <SessionGate />
      {confirmExit && (
        <ConfirmDialog
          title="Sair do iPlex?"
          confirmLabel="Sair"
          onCancel={() => setConfirmExit(false)}
          onConfirm={() => {
            setConfirmExit(false)
            platform.exit()
          }}
        />
      )}
      <DevBadge />
    </FocusProvider>
  )
}

export function App({ backend, detect, typography = { ok: true, ms: 0 } }: { backend?: Backend; detect?: typeof detectPlatform; typography?: TypographyResult } = {}) {
  return (
    <PlatformProvider detect={detect}>
      <TypographyGate result={typography}>
      <BackendProvider backend={backend}>
        <BrowserRouter>
          <SessionProvider>
            <Navigation />
          </SessionProvider>
        </BrowserRouter>
      </BackendProvider>
      </TypographyGate>
    </PlatformProvider>
  )
}
