import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { engineDb } from './engineModel'
import { listExchangeDemoConnections } from './exchangeDemo'

// =============================================================================
//  Server-side access to the V3.9 exchange DEMO venue layer (exec/exchange/*).
//  The engine/exec modules are plain-Node ESM loaded from disk (same pattern as
//  server/utils/exchangeDemo.ts) so Nitro never bundles them. A single runtime
//  instance owns the per-venue isolated health + throttle registries for this
//  process; credentials never leave the server and are never sent to the browser.
// =============================================================================

type Exchange = any
type Prefs = any

let exchangePromise: Promise<Exchange> | null = null
let prefsPromise: Promise<Prefs> | null = null
let runtime: any = null

async function loadExchange(): Promise<Exchange> {
  if (!exchangePromise) {
    exchangePromise = import(/* @vite-ignore */ pathToFileURL(join(process.cwd(), 'exec', 'exchange', 'index.mjs')).href)
      .catch((e) => { exchangePromise = null; throw e })
  }
  return exchangePromise
}

async function loadPrefs(): Promise<Prefs> {
  if (!prefsPromise) {
    prefsPromise = import(/* @vite-ignore */ pathToFileURL(join(process.cwd(), 'exec', 'exchange', 'venuePreferenceStore.mjs')).href)
      .catch((e) => { prefsPromise = null; throw e })
  }
  return prefsPromise
}

async function withDb<T>(fn: () => Promise<T>): Promise<T> {
  const db = await engineDb()
  if (!await db.connectMongo()) throw createError({ statusCode: 503, statusMessage: 'error.db_unavailable', message: 'MongoDB is not available' })
  return fn()
}

/** Process-singleton runtime (isolated per-venue health + throttle registries). */
export async function exchangeRuntime() {
  const ex = await loadExchange()
  if (!runtime) runtime = ex.createExchangeRuntime({})
  return { ex, runtime }
}

/**
 * Venue overview for the selector/health UI. Merges:
 *  - the three supported venues + their profiles (declared capabilities),
 *  - the owner's configured demo connections (masked, status),
 *  - live per-profile health from the runtime registry (when probed),
 *  - executionReady = false until a live probe VERIFIES required capabilities.
 * Never exposes secrets. Market-data vs execution roles are kept distinct.
 */
export async function listVenues(ownerId: string) {
  const { ex, runtime } = await exchangeRuntime()
  const connections: any[] = await withDb(() => listExchangeDemoConnections(ownerId)).catch(() => [])
  const connByProfile = new Map(connections.map((c: any) => [c.profile, c]))
  const health: any[] = runtime.healthSnapshot()
  const healthByProfile = new Map(health.map((h: any) => [h.profileId, h]))

  const venues = ex.VENUES.map((venue: string) => {
    const profiles = ex.profilesForVenue(venue).map((id: string) => {
      const prof = ex.resolveProfile(id)
      const conn: any = connByProfile.get(id) ?? null
      const live: any = healthByProfile.get(id) ?? null
      return {
        profileId: id,
        label: prof.label,
        marketType: prof.marketType,
        region: (prof as { region?: string }).region ?? null,
        environment: 'DEMO',
        endpoints: { rest: prof.rest.baseUrl, privateWs: prof.ws.privateUrl, publicWs: prof.ws.publicUrl, publicIsMainnet: prof.ws.publicIsMainnet },
        declaredCapabilities: prof.capabilities,
        executionRequiredCaps: ex.EXECUTION_REQUIRED_CAPS,
        // Fail-closed: not execution-ready until a live probe verified the caps.
        executionReady: live?.executionReady ?? false,
        executionGaps: ex.capabilityGaps(live?.capabilities ?? {}, ex.EXECUTION_REQUIRED_CAPS),
        connection: conn ? { configured: true, enabled: conn.enabled, status: conn.status, keyMask: conn.keyMask, lastTestedAt: conn.lastTestedAt, lastLatencyMs: conn.lastLatencyMs, lastErrorCode: conn.lastErrorCode } : { configured: false },
        health: live ? { status: live.status, restAccount: live.restAccount, privateStream: live.privateStream, publicStream: live.publicStream, clockSkewMs: live.clockSkewMs, rateLimit: live.rateLimit, lastReconcileAt: live.lastReconcileAt } : { status: conn?.status === 'up' ? 'READY' : 'DISCONNECTED' },
        wsTradeSupported: prof.wsTradeSupported,
        retentionDays: prof.retentionDays,
      }
    })
    return { venue, profiles }
  })
  return { venues, productionBlocked: true }
}

/** Declared + (if probed) verified capabilities for one connection/profile. */
export async function capabilitiesFor(ownerId: string, profileId: string) {
  const { ex, runtime } = await exchangeRuntime()
  const prof = ex.resolveProfile(profileId)
  const live: any = runtime.health.getHealth(profileId)
  const connections: any[] = await withDb(() => listExchangeDemoConnections(ownerId)).catch(() => [])
  const conn: any = connections.find((c: any) => c.profile === profileId) ?? null
  return {
    venue: prof.venue, profileId, environment: 'DEMO', marketType: prof.marketType,
    configured: !!conn, connectionStatus: conn?.status ?? 'untested',
    declared: prof.capabilities,
    verified: Object.fromEntries(ex.EXECUTION_REQUIRED_CAPS.map((k: string) => [k, live.verified?.[k]?.level ?? 'UNKNOWN'])),
    executionReady: live.executionReady ?? false,
    executionGaps: ex.capabilityGaps(live.verified ?? {}, ex.EXECUTION_REQUIRED_CAPS),
    endpoints: { rest: prof.rest.baseUrl, privateWs: prof.ws.privateUrl, publicWs: prof.ws.publicUrl },
  }
}

export async function getVenuePreference(ownerId: string, accountId = 'default') {
  const prefs = await loadPrefs()
  return withDb(() => prefs.getVenuePreference(ownerId, accountId))
}

export async function saveVenuePreference(ownerId: string, input: Record<string, unknown>, accountId = 'default') {
  const prefs = await loadPrefs()
  return withDb(() => prefs.saveVenuePreference(ownerId, input, accountId))
}

export async function requestVenueSwitch(ownerId: string, input: { accountId?: string, targetVenue: string, reason?: string | null }) {
  const prefs = await loadPrefs()
  return withDb(() => prefs.requestVenueSwitch(ownerId, input))
}
