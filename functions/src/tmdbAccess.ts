/** Delegate policy to the Player backend: one subscription/profile/catalog policy. */
export interface MetadataGrant { kind: 'movie' | 'series'; title: string; year: string | number | null }
export type AccessResult = { ok: true; item: MetadataGrant } | { ok: false; status: 401 | 403 | 429 | 503; error: string }
export function createTmdbAccess(callPlayer: (bearer: string, sourceId: string, itemId: string) => Promise<MetadataGrant>) {
  return async (authorization: string | undefined, query: URLSearchParams): Promise<AccessResult> => {
    const bearer = /^Bearer (.+)$/.exec(authorization ?? '')?.[1]
    if (!bearer) return { ok: false, status: 401, error: 'unauthenticated' }
    const sourceId = query.get('sourceId') ?? '', itemId = query.get('itemId') ?? ''
    if (![sourceId, itemId].every(id => /^[A-Za-z0-9_-]{1,128}$/.test(id))) return { ok: false, status: 403, error: 'catalog_item_required' }
    try {
      const item = await callPlayer(bearer, sourceId, itemId)
      if (!['movie', 'series'].includes(item?.kind) || typeof item.title !== 'string') throw new Error('invalid_response')
      return { ok: true, item }
    } catch (e) {
      const code = e instanceof Error ? e.message : ''
      if (code === 'rate-limited') return { ok: false, status: 429, error: 'rate_limited' }
      if (['unauthenticated', 'device-revoked', 'device-required'].includes(code)) return { ok: false, status: 401, error: 'device_revoked' }
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
