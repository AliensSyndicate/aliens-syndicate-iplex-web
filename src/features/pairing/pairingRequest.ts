import type { PlatformContext } from '../../platform/environment'
import type { PairingRequest } from '../../services/api/backend'
import { readJson, writeJson } from '../../utils/storage'

const BROWSER_ID_KEY = 'iplex.installation.v1'

function randomId(): string {
  const bytes = new Uint8Array(16)
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(bytes)
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256)
  return Array.from(bytes, (b) => (b < 16 ? '0' : '') + b.toString(16)).join('')
}

/**
 * Dados enviados ao beginDevicePair. Os identificadores são DICAS para o
 * backend (que calcula o id canônico); nunca prova de propriedade.
 */
export function buildPairingRequest(platform: Pick<PlatformContext, 'kind' | 'info'>): PairingRequest {
  if (platform.info && (platform.kind === 'tizen' || platform.kind === 'webos')) {
    const model = platform.info.device.model ?? undefined
    return {
      name: platform.kind === 'tizen' ? 'Samsung Smart TV' : 'LG Smart TV',
      platform: platform.kind,
      manufacturer: platform.kind === 'tizen' ? 'Samsung' : 'LG',
      ...(model ? { model } : {}),
      nativeDeviceId: platform.info.installationId,
      identitySource: platform.kind === 'tizen' ? 'tizen_app_install_fallback' : 'webos_app_install_fallback',
      identityScope: 'app_scoped',
      identityStability: 'installation_persistent',
    }
  }
  let id = readJson<string>(BROWSER_ID_KEY)
  if (!id || !/^[a-f0-9]{32}$/.test(id)) {
    id = randomId()
    writeJson(BROWSER_ID_KEY, id)
  }
  return {
    name: 'iPlex Web (navegador)',
    // O schema do backend lista android_tv|tizen|webos; "web" é aceito pela
    // callable mas ainda não é reconhecido pelo Gestor (pendência documentada).
    platform: 'web' as PairingRequest['platform'],
    manufacturer: 'Navegador',
    nativeDeviceId: `web_${id}`,
    identitySource: 'web_browser_storage',
    identityScope: 'app_scoped',
    identityStability: 'installation_persistent',
  }
}
