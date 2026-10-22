/**
 * Delegate policy to the Gestor backend: one subscription/profile/catalog policy.
 * TVs (paired device token) are authorized by the `player` callable; the iPlex
 * Control (person account) by the `manager` callable, which also verifies its
 * App Check token — so a person token without App Check never gets metadata.
 */
export interface MetadataGrant { kind: 'movie' | 'series'; title: string; year: string | number | null }
export type AccessResult = { ok: true; item: MetadataGrant } | { ok: false; status: 401 | 403 | 429 | 503; error: string }
export type ControlCaller = (bearer: string, appCheck: string, sourceId: string, itemId: string, contextFamilyId: string | null | undefined) => Promise<MetadataGrant>
const ID = /^[A-Za-z0-9_-]{1,128}$/
export function createTmdbAccess(callPlayer: (bearer: string, sourceId: string, itemId: string) => Promise<MetadataGrant>, callControl?: ControlCaller) {
  return async (authorization: string | undefined, query: URLSearchParams, appCheck?: string): Promise<AccessResult> => {
    const bearer = /^Bearer (.+)$/.exec(authorization ?? '')?.[1]
    if (!bearer) return { ok: false, status: 401, error: 'unauthenticated' }
    const sourceId = query.get('sourceId') ?? '', itemId = query.get('itemId') ?? ''
    if (![sourceId, itemId].every(id => ID.test(id))) return { ok: false, status: 403, error: 'catalog_item_required' }
    const context = query.get('contextFamilyId')
    if (context !== null && context !== 'null' && !ID.test(context)) return { ok: false, status: 403, error: 'catalog_item_required' }
    try {
      const item = appCheck
        ? await (callControl ?? (() => { throw new Error('unauthenticated') }))(bearer, appCheck, sourceId, itemId, context === null ? undefined : context === 'null' ? null : context)
        : await callPlayer(bearer, sourceId, itemId)
      if (!['movie', 'series'].includes(item?.kind) || typeof item.title !== 'string') throw new Error('invalid_response')
      return { ok: true, item }
    } catch (e) {
      const code = e instanceof Error ? e.message : ''
      if (code === 'rate-limited') return { ok: false, status: 429, error: 'rate_limited' }
      if (['unauthenticated', 'Unauthenticated', 'device-revoked', 'device-required'].includes(code)) return { ok: false, status: 401, error: 'device_revoked' }
      if (['subscription-required', 'session-expired', 'profile-disabled', 'profile-unavailable', 'permission-denied', 'not-found', 'pin-required'].includes(code)) return { ok: false, status: 403, error: 'content_unavailable' }
      return { ok: false, status: 503, error: 'authorization_unavailable' }
    }
  }
}

/** Fixed project endpoint. Never forward a bearer token to a client-supplied URL. */
export async function callPlayerMetadata(bearer: string, sourceId: string, itemId: string): Promise<MetadataGrant> {
  const project = process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT
  if (project !== 'iplex-2c8fc' && project !== 'demo-iplex') throw new Error('invalid_project')
  const local = process.env.FUNCTIONS_EMULATOR === 'true' && project === 'demo-iplex'
  const url = local ? 'http://127.0.0.1:5001/demo-iplex/us-central1/player' : 'https://us-central1-iplex-2c8fc.cloudfunctions.net/player'
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10_000)
  try {
    const response = await fetch(url, {
      method: 'POST', redirect: 'error', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
      body: JSON.stringify({ data: { action: 'authorizeMetadata', payload: { sourceId, itemId } } }),
    })
    const body = await response.json() as { result?: MetadataGrant; error?: { message?: string } }
    if (!response.ok || !body.result) throw new Error(body.error?.message ?? 'authorization_unavailable')
    return body.result
  } finally { clearTimeout(timer) }
}

/** Control path: the `manager` callable verifies the ID token AND App Check. */
export async function callControlMetadata(bearer: string, appCheck: string, sourceId: string, itemId: string, contextFamilyId: string | null | undefined): Promise<MetadataGrant> {
  const project = process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT
  if (project !== 'iplex-2c8fc' && project !== 'demo-iplex') throw new Error('invalid_project')
  const local = process.env.FUNCTIONS_EMULATOR === 'true' && project === 'demo-iplex'
  const url = local ? 'http://127.0.0.1:5001/demo-iplex/us-central1/manager' : 'https://us-central1-iplex-2c8fc.cloudfunctions.net/manager'
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10_000)
  try {
    const response = await fetch(url, {
      method: 'POST', redirect: 'error', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}`, 'X-Firebase-AppCheck': appCheck },
      body: JSON.stringify({ data: { action: 'authorizeMetadata', payload: { sourceId, itemId, ...(contextFamilyId !== undefined ? { contextFamilyId } : {}) } } }),
    })
    const body = await response.json() as { result?: MetadataGrant; error?: { message?: string } }
    if (!response.ok || !body.result) throw new Error(body.error?.message ?? 'authorization_unavailable')
    return body.result
  } finally { clearTimeout(timer) }
}

export type DiscoveryResult = { ok: true } | { ok: false; status: 401 | 403 | 429 | 503; error: string }
export type DiscoveryCaller = (bearer: string, appCheck: string, contextFamilyId: string | null | undefined) => Promise<unknown>
/**
 * Editorial discovery (titles outside the IPTV catalog, people, filmographies) is a
 * Control-only grant: person account + App Check, verified by the `manager` callable
 * (never a TV, never a kids profile, per-account quota). TVs keep the item-scoped path.
 */
export function createDiscoveryAccess(callControl: DiscoveryCaller) {
  return async (authorization: string | undefined, query: URLSearchParams, appCheck?: string): Promise<DiscoveryResult> => {
    const bearer = /^Bearer (.+)$/.exec(authorization ?? '')?.[1]
    if (!bearer || !appCheck) return { ok: false, status: 401, error: 'unauthenticated' }
    const context = query.get('contextFamilyId')
    if (context !== null && context !== 'null' && !ID.test(context)) return { ok: false, status: 403, error: 'discovery_unavailable' }
    try {
      await callControl(bearer, appCheck, context === null ? undefined : context === 'null' ? null : context)
      return { ok: true }
    } catch (e) {
      const code = e instanceof Error ? e.message : ''
      if (code === 'rate-limited') return { ok: false, status: 429, error: 'rate_limited' }
      if (['unauthenticated', 'Unauthenticated'].includes(code)) return { ok: false, status: 401, error: 'unauthenticated' }
      if (['permission-denied', 'content-unavailable', 'not-found', 'profile-unavailable'].includes(code)) return { ok: false, status: 403, error: 'discovery_unavailable' }
      return { ok: false, status: 503, error: 'authorization_unavailable' }
    }
  }
}

/** Control discovery grant: `manager` → authorizeDiscovery (ID token AND App Check). */
export async function callControlDiscovery(bearer: string, appCheck: string, contextFamilyId: string | null | undefined): Promise<unknown> {
  const project = process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT
  if (project !== 'iplex-2c8fc' && project !== 'demo-iplex') throw new Error('invalid_project')
  const local = process.env.FUNCTIONS_EMULATOR === 'true' && project === 'demo-iplex'
  const url = local ? 'http://127.0.0.1:5001/demo-iplex/us-central1/manager' : 'https://us-central1-iplex-2c8fc.cloudfunctions.net/manager'
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10_000)
  try {
    const response = await fetch(url, {
      method: 'POST', redirect: 'error', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}`, 'X-Firebase-AppCheck': appCheck },
      body: JSON.stringify({ data: { action: 'authorizeDiscovery', payload: contextFamilyId !== undefined ? { contextFamilyId } : {} } }),
    })
    const body = await response.json() as { result?: unknown; error?: { message?: string } }
    if (!response.ok || !body.result) throw new Error(body.error?.message ?? 'authorization_unavailable')
    return body.result
  } finally { clearTimeout(timer) }
}
