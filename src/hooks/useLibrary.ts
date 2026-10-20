import { useSyncExternalStore } from 'react'
import { useReadySession } from '../app/providers/SessionProvider'

export function useLibrary() {
  const { library } = useReadySession()
  const snapshot = useSyncExternalStore(library.subscribe, library.getSnapshot)
  return { store: library, ...snapshot }
}
