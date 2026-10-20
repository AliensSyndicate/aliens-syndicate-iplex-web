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

/**
 * Somente `vite build --mode emulator` (validação local, inclusive na TV pela
 * rede): conecta Auth/Functions/Firestore aos emulators do Firebase neste host.
 * Em builds de produção o ramo é eliminado (MODE é constante).
 */
export const EMULATOR_HOST: string = import.meta.env.MODE === 'emulator' ? env.VITE_IPLEX_EMULATOR_HOST ?? '' : ''

export function firebaseConfig(): FirebaseWebConfig | null {
  const config: FirebaseWebConfig = {
    apiKey: env.VITE_FIREBASE_API_KEY ?? '',
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN ?? '',
    projectId: env.VITE_FIREBASE_PROJECT_ID ?? '',
    appId: env.VITE_FIREBASE_APP_ID ?? '',
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? '',
    storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET ?? '',
  }
  if (!config.apiKey || !config.appId) return null
  if (config.projectId !== EXPECTED_FIREBASE_PROJECT && !(EMULATOR_HOST && config.projectId.startsWith('demo-'))) return null
  return config
}

export const FUNCTIONS_REGION = env.VITE_FIREBASE_FUNCTIONS_REGION || 'us-central1'

/** Origens aceitas nas mensagens do shell. O app Tizen empacotado tem origem opaca. */
export const SHELL_ORIGINS: readonly string[] = (env.VITE_IPLEX_SHELL_ORIGINS || 'null,file://')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)

/** Dados de demonstração: somente em `vite dev` e somente quando pedido. */
export const USE_MOCKS: boolean = import.meta.env.DEV && env.VITE_IPLEX_USE_MOCKS === 'true'
