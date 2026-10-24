import { Suspense, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { IplexHeader } from '../components/navigation/IplexHeader'
import { RouteSkeleton } from '../components/feedback/ScreenSkeletons'
import { ProfileMenu } from '../features/profiles/ProfileMenu'
import { useReadySession } from './providers/SessionProvider'

/** Layout das seções: menu fixo no topo + conteúdo. O player usa tela cheia sem menu. */
export function AppLayout() {
  const session = useReadySession()
  const location = useLocation()
  const [menu, setMenu] = useState(false)
  const immersive = location.pathname.startsWith('/assistir')
  return (
    <div className="iplex-app">
      {!immersive && <IplexHeader profile={session.profile} onAvatar={() => setMenu(true)} adultEnabled={session.catalog.adultEnabled()} />}
      <Suspense fallback={<RouteSkeleton pathname={location.pathname} />}>
        <Outlet />
      </Suspense>
      {menu && <ProfileMenu onClose={() => setMenu(false)} />}
    </div>
  )
}
