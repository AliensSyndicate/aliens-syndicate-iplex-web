/**
 * Configuração pública (bundle). Segredos nunca passam por aqui: o TMDB é
 * acessado só pelos endpoints internos /api/tmdb (servidor).
 */
export interface FirebaseWebConfig {
  apiKey: string
  authDomain: string
  projectId: string
  appId: string
  messagingSenderId: string
  storageBucket: string
}

const env = import.meta.env

export const WEB_VERSION: string = __IPLEX_WEB_VERSION__

/** Projeto Firebase previsto para o iPlex (nunca o institucional aliens-syndicate-docs). */
export const EXPECTED_FIREBASE_PROJECT = 'iplex-2c8fc'

export function firebaseConfig(): FirebaseWebConfig | null {
  const config: FirebaseWebConfig = {
    apiKey: env.VITE_FIREBASE_API_KEY ?? '',
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN ?? '',
    projectId: env.VITE_FIREBASE_PROJECT_ID ?? '',
    appId: env.VITE_FIREBASE_APP_ID ?? '',
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? '',
    storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET ?? '',
  }
  if (!config.apiKey || !config.appId || config.projectId !== EXPECTED_FIREBASE_PROJECT) return null
  return config
}

export const FUNCTIONS_REGION = env.VITE_FIREBASE_FUNCTIONS_REGION || 'us-central1'
export const APP_CHECK_SITE_KEY = env.VITE_FIREBASE_APPCHECK_SITE_KEY || ''
/** Token de depuração do App Check: aceito apenas em desenvolvimento. */
export const APP_CHECK_DEBUG_TOKEN = import.meta.env.DEV ? env.VITE_FIREBASE_APPCHECK_DEBUG_TOKEN || '' : ''

/** Origens aceitas nas mensagens do shell. O app Tizen empacotado tem origem opaca. */
export const SHELL_ORIGINS: readonly string[] = (env.VITE_IPLEX_SHELL_ORIGINS || 'null,file://')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)

/** Dados de demonstração: somente em `vite dev` e somente quando pedido. */
export const USE_MOCKS: boolean = import.meta.env.DEV && env.VITE_IPLEX_USE_MOCKS === 'true'
