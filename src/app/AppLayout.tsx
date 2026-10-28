import { Suspense, useEffect, useRef, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { IplexHeader } from '../components/navigation/IplexHeader'
import { RouteSkeleton } from '../components/feedback/ScreenSkeletons'
import { ProfileMenu } from '../features/profiles/ProfileMenu'
import { checkForUpdate } from './appUpdate'
import { usePlatform } from './providers/PlatformProvider'
import { useReadySession } from './providers/SessionProvider'

/** Layout das seções: menu fixo no topo + conteúdo. O player usa tela cheia sem menu. */
export function AppLayout() {
  const session = useReadySession()
  const location = useLocation()
  const [menu, setMenu] = useState(false)
  const immersive = location.pathname.startsWith('/assistir')
  const { visible } = usePlatform()
  // Versão nova do app publicada: recarrega ao voltar para a tela ou a cada 10 min, nunca no meio de uma reprodução.
  const outdated = useRef(false)
  const lastCheck = useRef(0)
  useEffect(() => {
    let alive = true
    const check = async () => {
      if (!outdated.current) {
        if (Date.now() - lastCheck.current < 60_000) return
        lastCheck.current = Date.now()
        if (!(await checkForUpdate())) return
      }
      outdated.current = true
      if (alive && !window.location.pathname.startsWith('/assistir')) window.location.reload()
    }
    if (visible) void check()
    const id = setInterval(() => void check(), 10 * 60_000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [visible, location.pathname])
  return (
    <div className="iplex-app">
      {!immersive && <IplexHeader profile={session.profile} onAvatar={() => setMenu(true)} adultEnabled={session.catalog.adultEnabled()} />}
      <Suspense fallback={<RouteSkeleton pathname={location.pathname} />}>
        <Outlet />
      </Suspense>
      {session.unavailable && !immersive && (
        <p className="iplex-watermark" role="status">Conteúdo indisponível, favor contatar seu fornecedor de IPTV</p>
      )}
      {menu && <ProfileMenu onClose={() => setMenu(false)} />}
    </div>
  )
}
