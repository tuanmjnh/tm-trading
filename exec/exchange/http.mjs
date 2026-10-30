// =============================================================================
//  TM TRADING — V3.9 signed demo REST client (§63.6/§63.17/§64.7).
//
//  Wraps the tested V3.8 signer (exec/exchangeDemo.mjs signDemoRequest) with:
//   - demo-only allowlist + OKX simulated-header enforcement BEFORE any I/O,
//   - per-venue isolated throttle/backoff (throttle.mjs),
//   - clock-skew-corrected request timestamps,
//   - bounded retries for READ ops, and reconcile-before-resend for ORDER ops
//     (a timed-out order is NEVER blind-retried — it surfaces `order-uncertain`
//     so the adapter reconciles by client order id first, §63.17),
//   - sanitized, venue-namespaced errors with correlation ids (errors.mjs).
//
//  No secrets are ever placed in an error/message; `sanitizeText` scrubs slips.
// =============================================================================

import { signDemoRequest, DEMO_PROFILES } from '../exchangeDemo.mjs'
import { resolveProfile, assertDemoRestHost, assertSimulatedTradingHeader } from './profiles.mjs'
import { normalizeVenueError, correlationId, sanitizeText, venueError } from './errors.mjs'

const buildQuery = (params) => new URLSearchParams(
  Object.entries(params ?? {}).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => [k, String(v)]),
).toString()

/** Parse a venue error body into { rawCode, rawMessage } without leaking secrets. */
function parseVenueErrorPayload(venue, payload) {
  if (!payload || typeof payload !== 'object') return { rawCode: null, rawMessage: null }
  if (venue === 'bybit') return { rawCode: payload.retCode ?? null, rawMessage: payload.retMsg ?? null }
  if (venue === 'okx') {
    const item = Array.isArray(payload.data) ? payload.data[0] : null
    return { rawCode: payload.code ?? item?.sCode ?? null, rawMessage: payload.msg ?? item?.sMsg ?? null }
  }
  return { rawCode: payload.code ?? null, rawMessage: payload.msg ?? null }
}

/**
 * Create a demo REST client bound to one profile + credential set.
 * @param {object} cfg { profileId, credentials, throttle, fetchImpl, now, timeoutMs, maxReadRetries }
 */
export function createRestClient(cfg) {
  const profileId = String(cfg.profileId).toLowerCase()
  const profile = resolveProfile(profileId)
  const venue = profile.venue
  const fetchImpl = cfg.fetchImpl ?? globalThis.fetch
  const nowFn = cfg.now ?? (() => Date.now())
  const timeoutMs = cfg.timeoutMs ?? 8000
  const maxReadRetries = cfg.maxReadRetries ?? 2
  const throttle = cfg.throttle
  const credentials = cfg.credentials

  // Fail-closed: the resolved base URL must be an allowlisted demo host.
  assertDemoRestHost(venue, profile.rest.baseUrl)
  // The V3.8 signer must agree on the same host (single source of truth check).
  if (DEMO_PROFILES[profileId] && DEMO_PROFILES[profileId].baseUrl !== profile.rest.baseUrl) {
    throw venueError(venue, 'host-mismatch', `registry/signer host disagreement for ${profileId}`, { profileId })
  }

  async function once(method, path, { params, body, queryString, weight = 1, isOrderOp = false, op = '' } = {}) {
    const cid = correlationId()
    // Throttle (isolated per venue). Order ops are not delayed past their budget
    // window silently — the caller learns it must wait.
    if (throttle) {
      const r = throttle.reserve(weight)
      if (!r.ok) {
        throw venueError(venue, 'throttled', `${venue} rate budget exhausted (${r.reason}); retry in ${r.waitMs}ms`, { profileId, correlationId: cid, retryable: true })
      }
    }
    const qs = queryString ?? (params && venue !== 'binance' ? buildQuery(params) : undefined)
    const signed = signDemoRequest(profileId, credentials, {
      method, path, body, params: venue === 'binance' ? params : undefined, queryString: qs,
    }, { now: nowFn() + (throttle ? throttle.state.clockSkewMs : 0) })

    // Fail-closed header enforcement (OKX demo == header-gated on a shared host).
    if (profile.auth.requiresSimulatedHeader) assertSimulatedTradingHeader(venue, signed.headers)
    // Re-assert the signed URL still points at an allowlisted demo host.
    assertDemoRestHost(venue, new URL(signed.url).origin)

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    let response
    try {
      response = await fetchImpl(signed.url, { method: signed.method, headers: signed.headers, body: signed.body, signal: controller.signal })
    } catch (netErr) {
      const aborted = netErr?.name === 'AbortError'
      // A timed-out ORDER op is UNCERTAIN — never blind-retry (may have landed).
      if (isOrderOp) {
        throw venueError(venue, 'order-uncertain', `${op || 'order'} request timed out/failed before a definitive ack — reconcile by clientOrderId before any resend`, { profileId, correlationId: cid, retryable: false, cause: sanitizeText(netErr?.message) })
      }
      throw normalizeVenueError(venue, profileId, { rawMessage: aborted ? 'request timed out' : 'network error', correlationId: cid, retryable: true })
    } finally {
      clearTimeout(timer)
    }

    if (throttle) {
      const usedHdr = response.headers?.get?.(profile.rateLimit.weightHeader)
      if (usedHdr != null) {
        const n = Number(String(usedHdr).split(',').pop())
        if (Number.isFinite(n)) throttle.observeUsedWeight(n)
      }
    }

    const payload = await response.json().catch(() => null)
    if (!response.ok) {
      const { rawCode, rawMessage } = parseVenueErrorPayload(venue, payload)
      const retryAfter = Number(response.headers?.get?.('retry-after')) * 1000 || null
      const err = normalizeVenueError(venue, profileId, { httpStatus: response.status, rawCode, rawMessage, correlationId: cid })
      if (throttle && (response.status === 429 || response.status === 418)) throttle.backoff({ retryAfterMs: retryAfter })
      if (throttle) throttle.noteError(err.code)
      if (isOrderOp && response.status >= 500) {
        throw venueError(venue, 'order-uncertain', `${op || 'order'} got HTTP ${response.status} — reconcile by clientOrderId before any resend`, { profileId, correlationId: cid, httpStatus: response.status, retryable: false })
      }
      throw err
    }

    // Venue-level logical error inside a 200 body.
    const { rawCode, rawMessage } = parseVenueErrorPayload(venue, payload)
    const failed = venue === 'bybit' ? payload?.retCode !== undefined && payload.retCode !== 0
      : venue === 'okx' ? payload?.code !== undefined && String(payload.code) !== '0'
        : payload?.code !== undefined && Number(payload.code) < 0
    if (failed) {
      const err = normalizeVenueError(venue, profileId, { rawCode, rawMessage, correlationId: cid })
      if (throttle) throttle.noteError(err.code)
      throw err
    }
    return payload
  }

  async function request(method, path, opts = {}) {
    const isOrderOp = opts.isOrderOp === true
    // Order ops: single attempt (reconcile-before-resend). Reads: bounded retry.
    const attempts = isOrderOp ? 1 : maxReadRetries + 1
    let lastErr
    for (let i = 0; i < attempts; i++) {
      try {
        return await once(method, path, opts)
      } catch (err) {
        lastErr = err
        const retryable = err?.retryable === true && !isOrderOp && err?.code !== `exchange.${venue}.throttled` ? true : err?.retryable === true && !isOrderOp
        if (!retryable || i === attempts - 1) break
        const wait = throttle ? throttle.backoff({}) : 200 * (i + 1)
        await new Promise((r) => setTimeout(r, Math.min(wait, 2000)))
      }
    }
    throw lastErr
  }

  return {
    profileId, venue,
    get: (path, opts) => request('GET', path, opts),
    post: (path, opts) => request('POST', path, opts),
    put: (path, opts) => request('PUT', path, opts),
    del: (path, opts) => request('DELETE', path, opts),
    request,
    endpoint: (name) => profile.rest.endpoints[name],
  }
}
