import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

afterEach(() => {
  cleanup()
  try {
    window.localStorage.clear()
    window.sessionStorage.clear()
  } catch {
    // ignorado
  }
})
