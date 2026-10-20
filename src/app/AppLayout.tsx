import { Suspense, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { IplexHeader } from '../components/navigation/IplexHeader'
import { LoadingState } from '../components/feedback/LoadingState'
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
      {!immersive && <IplexHeader profile={session.profile} onAvatar={() => setMenu(true)} />}
      <Suspense fallback={<main className="iplex-page"><LoadingState /></main>}>
        <Outlet />
      </Suspense>
      {menu && <ProfileMenu onClose={() => setMenu(false)} />}
    </div>
  )
}
