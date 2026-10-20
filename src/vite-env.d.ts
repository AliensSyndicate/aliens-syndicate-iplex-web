/// <reference types="vite/client" />

declare const __IPLEX_WEB_VERSION__: string

interface ImportMetaEnv {
  readonly VITE_FIREBASE_API_KEY?: string
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string
  readonly VITE_FIREBASE_PROJECT_ID?: string
  readonly VITE_FIREBASE_APP_ID?: string
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID?: string
  readonly VITE_FIREBASE_STORAGE_BUCKET?: string
  readonly VITE_FIREBASE_FUNCTIONS_REGION?: string
  readonly VITE_IPLEX_SHELL_ORIGINS?: string
  readonly VITE_IPLEX_USE_MOCKS?: string
  readonly VITE_IPLEX_EMULATOR_HOST?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
