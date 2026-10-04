#!/usr/bin/env node
// =============================================================================
//  TM TRADING - MT5 BRIDGE CLIENT (roadmap Phase 12)
//
//  Pure TRANSPORT for docs/mt5-ipc.md. It knows nothing about risk: the risk
//  gate (exec/risk.mjs, D7) decides, this module only carries the decision to
//  the Python bridge. It never calls the risk gate either (layering).
//
//  Contract sections implemented here:
//    §2   endpoints: GET /health /account /positions /history,
//         POST /order /order/close /order/modify
//    §3   timeouts: GET 2 s, POST /order|/order/close|/order/modify 10 s
//    §4.2 the Idempotency-Key header (never invented here: it comes from
//         engine/keys.mjs -> clientOrderId)
//    §4.3 timeout / connection reset -> status 'unknown', and NO automatic
//         immediate retry
//    §4.4+5 reconcile(): look up by comment/ticket first; only when the order
//         is not found AND RECONCILE_AFTER (default 30 s) has elapsed is it
//         resent -- with the SAME Idempotency-Key, byte for byte
//    §4   last paragraph: idempotent GET retry, max 2 retries, 200 ms -> 1 s
//         backoff, connection errors only, NEVER on 4xx
//    §6   Authorization: Bearer <MT5_BRIDGE_TOKEN>, fail-closed (no token ->
//         refuse to send) + demo-first gate (account_type !== 'demo' -> refuse)
// =============================================================================
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { createHash, timingSafeEqual } from 'node:crypto'

// The env loader is the project's single loader (exec/env.mjs); this module
// does not invent a second one.
export { loadEnv } from '../env.mjs'

// --- Config (env, all optional: fail-closed / fail-soft at call time) -------
const DEFAULTS = Object.freeze({
  url: 'http://127.0.0.1:8790', // §2: base http://127.0.0.1:8790
  reconcileAfterMs: 30_000, // §4.4: RECONCILE_AFTER, default 30 s
  retryBackoffMs: [200, 1_000], // §4 last paragraph: 200 ms -> 1 s
  orderTimeoutMs: 10_000, // §3: POST /order, /order/close, /order/modify
})
/** §3: GET /health /account /positions /history time out after 2 s. */
export const GET_TIMEOUT_MS = 2_000
/** §4 last paragraph: max 2 RETRIES => 3 attempts in total. */
export const MAX_ATTEMPTS = 3

/** Per-endpoint timeout from §3. */
export function timeoutFor(method, path) {
  return method === 'GET' ? GET_TIMEOUT_MS : DEFAULTS.orderTimeoutMs
}

/**
 * Bridge config from env. Unknown values fall back to the contract defaults
 * instead of throwing -- a broken .env must not take the pipeline down.
 * @returns {{url:string, token:string, reconcileAfterMs:number, retryBackoffMs:number[], timeouts:{get:number,post:number}}}
 */
export function loadMt5Config(env = process.env) {
  const num = (raw, fallback) => {
    const n = Number(raw)
    return Number.isFinite(n) && n >= 0 ? n : fallback
  }
  const to = num(env.MT5_TIMEOUT_MS, 0) // 0 = "not set" -> §3 per-endpoint values
  return {
    url: String(env.MT5_BRIDGE_URL || DEFAULTS.url).replace(/\/+$/, ''),
    token: String(env.MT5_BRIDGE_TOKEN || ''),
    reconcileAfterMs: num(env.MT5_RECONCILE_AFTER_MS, DEFAULTS.reconcileAfterMs),
    retryBackoffMs: DEFAULTS.retryBackoffMs,
    timeouts: { get: to > 0 ? to : GET_TIMEOUT_MS, post: to > 0 ? to : DEFAULTS.orderTimeoutMs },
  }
}

// --- Errors ------------------------------------------------------------------
/** Transport-level error. `kind` is the only thing retry logic looks at. */
export class Mt5Error extends Error {
  constructor(kind, message, extra = {}) {
    super(message)
    this.name = 'Mt5Error'
    this.kind = kind // 'timeout' | 'network' | 'http' | 'refused' | 'protocol'
    Object.assign(this, extra)
  }
}
/** Fail-closed: we never opened a socket, so there is nothing to reconcile. */
export const isConfigError = (e) => !!e && e.kind === 'refused'
/** No answer / dead socket: the order state is unknowable -> §4 'unknown'. */
export const isUnknownCause = (e) => !!e && (e.kind === 'timeout' || e.kind === 'network')
/** §4 last paragraph: only connection errors are retried, never 4xx. */
export const isRetryable = (e) => !!e && e.kind === 'network'

/** Constant-time token compare (mirrors server/webhook.mjs sameToken()). */
export function sameToken(a, b) {
  const ab = Buffer.from(String(a ?? ''), 'utf8')
  const bb = Buffer.from(String(b ?? ''), 'utf8')
  if (ab.length === 0 || ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

// --- Low-level HTTP (node:http, no dependencies) -----------------------------
function once(cfg, { method, path, body, timeoutMs }) {
  const url = new URL(cfg.url + path)
  const isHttps = url.protocol === 'https:'
  const payload = body === undefined ? null : Buffer.from(JSON.stringify(body), 'utf8')

  return new Promise((resolve, reject) => {
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), timeoutMs)
    timer.unref?.()

    const fail = (kind, message, extra) =>
      reject(new Mt5Error(kind, message, { ...extra, method, path }))

    const req = (isHttps ? httpsRequest : httpRequest)(
      url,
      {
        method,
        signal: ac.signal,
        headers: {
          // §6: every request carries the bearer token. There is no code path
          // that sends a request without it (see tokenError()).
          Authorization: `Bearer ${cfg.token}`,
          Accept: 'application/json',
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': String(payload.length) } : {}),
        },
      },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('error', (e) => fail('network', `response stream error: ${e.message}`))
        res.on('end', () => {
          clearTimeout(timer)
          const text = Buffer.concat(chunks).toString('utf8')
          let parsed = null
          try {
            parsed = text ? JSON.parse(text) : null
          } catch {
            // §2: "no HTML" -- a non-JSON body is a protocol violation, not a result.
            return fail('protocol', `non-JSON response (HTTP ${res.statusCode})`, { status: res.statusCode, text: text.slice(0, 200) })
          }
          const status = res.statusCode || 0
          if (status >= 200 && status < 300) return resolve({ status, body: parsed ?? {} })
          const msg = parsed && typeof parsed.error === 'string' ? parsed.error : `HTTP ${status}`
          return fail('http', msg, { status, body: parsed })
        })
      },
    )
    // Node still emits an error after abort() (ABORT_ERR). The classification
    // below turns it into 'timeout' instead of 'network'.
    req.on('error', (e) => {
      clearTimeout(timer)
      if (ac.signal.aborted) return fail('timeout', `timed out after ${timeoutMs} ms`, { cause: e })
      return fail('network', e?.message || 'network error', { cause: e })
    })
    if (payload) req.write(payload)
    req.end()
  })
}

/**
 * One request, with the §4 retry policy for idempotent GETs.
 * `retry` defaults to true for GET and false for POST: POST /order must never
 * be retried automatically (§4.3) -- reconciliation decides, not this loop.
 */
export async function send(cfg, { method, path, body, timeoutMs, retry = method === 'GET' }) {
  const backoff = cfg.retryBackoffMs || DEFAULTS.retryBackoffMs
  const per = timeoutMs || (method === 'GET' ? cfg.timeouts.get : cfg.timeouts.post)
  let last
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await once(cfg, { method, path, body, timeoutMs: per })
    } catch (e) {
      last = e
      const canRetry = retry && isRetryable(e) && attempt < MAX_ATTEMPTS
      if (!canRetry) throw e
      // §4/§3: "do not retry within the same request" applies to endpoints whose
      // timeout is a failure (health/account); positions/history are read for
      // reconciliation and may retry. Both are GET, so the retry flag decides.
      await new Promise((r) => setTimeout(r, backoff[attempt - 1] ?? backoff[backoff.length - 1]))
    }
  }
  throw last
}

/**
 * Create a bridge client bound to one config + clock.
 *
 * `now()` is injectable so the reconcile time gate (RECONCILE_AFTER) is testable
 * without sleeping 30 s. Production uses Date.now.
 */
export function createMt5Client(overrides = {}, deps = {}) {
  const cfg = { ...loadMt5Config(), ...overrides }
  const now = deps.now || (() => Date.now())
  let healthCache = null // last /health payload (drives the §6 demo gate)

  /** Fail-closed: no token -> refuse BEFORE any socket is opened. */
  function tokenError() {
    if (!cfg.token) {
      return new Mt5Error('refused', 'MT5_BRIDGE_TOKEN is not set - refusing to send (fail-closed, §6)')
    }
    return null
  }

  // --- Idempotency-Key ------------------------------------------------------
  /**
   * Derive the key from the real clientOrderId. engine/keys.mjs is
   * deterministic, so a retry of the same alert+seq reproduces the key byte for
   * byte (§4.5). A key that is not stable would allow a real double order.
   */
  function idempotencyKeyFor(order = {}) {
    const raw = order.clientOrderId ?? order['Idempotency-Key'] ?? order.idempotencyKey
    const key = String(raw ?? '').trim()
    if (!key) throw new Mt5Error('protocol', 'order.clientOrderId is required (Idempotency-Key, §2.1)')
    // §2.1: <= 31 chars, [A-Za-z0-9_-] only.
    if (key.length > 31) throw new Mt5Error('protocol', `Idempotency-Key too long (${key.length} > 31): ${key}`)
    if (!/^[A-Za-z0-9_-]+$/.test(key)) throw new Mt5Error('protocol', `Idempotency-Key has invalid characters: ${key}`)
    return key
  }

  // --- §6 demo-first gate ---------------------------------------------------
  /**
   * Read /health (cached; `refresh` forces) and decide whether placing an order
   * is allowed under the demo-first policy.
   *
   * @param {boolean} refresh re-read /health instead of using the cache
   * @returns {Promise<{allowed:boolean, account_type:string|null, status:string, reason?:string, error?:string}>}
   */
  async function assertDemoAccount(refresh = false) {
    const err = tokenError()
    if (err) return { allowed: false, account_type: null, status: 'refused', reason: err.message }
    if (refresh || !healthCache) {
      const probe = await getHealth()
      if (probe.status === 'off' || probe.status === 'down') {
        return { allowed: false, account_type: probe.body?.account_type ?? null, status: probe.status, error: probe.error }
      }
      healthCache = probe.body || {}
    }
    const at = healthCache?.account_type ?? null
    if (at !== 'demo') {
      return {
        allowed: false,
        account_type: at,
        status: 'refused',
        reason: `account_type !== 'demo' (${JSON.stringify(at)}) - demo-first policy (§6)`,
      }
    }
    return { allowed: true, account_type: at, status: 'demo' }
  }

  // --- Read endpoints (idempotent: retry allowed per §4) --------------------
  /** §2.2 GET /health. Never retried (its 2 s timeout is already a verdict). */
  async function getHealth() {
    const err = tokenError()
    if (err) return { status: 'refused', body: null, error: err.message }
    try {
      const { body } = await send(cfg, { method: 'GET', path: '/health', retry: false })
      healthCache = body
      return { status: body?.ok === false ? 'degraded' : 'ok', body }
    } catch (e) {
      return { status: 'off', body: null, error: e.message, kind: e.kind }
    }
  }

  /** §2 GET /account. */
  async function getAccount({ retry = true } = {}) {
    const err = tokenError()
    if (err) return { status: 'refused', body: null, error: err.message }
    try {
      const { body } = await send(cfg, { method: 'GET', path: '/account', retry })
      return { status: 'ok', body }
    } catch (e) {
      return { status: 'off', body: null, error: e.message, kind: e.kind }
    }
  }

  /**
   * §2/§5 GET /positions - also the reconciliation source of truth. GET is
   * idempotent, so the 2-retry policy applies.
   */
  async function getPositions({ retry = true } = {}) {
    const err = tokenError()
    if (err) return { status: 'refused', positions: [], error: err.message }
    try {
      const { body } = await send(cfg, { method: 'GET', path: '/positions', retry })
      const positions = Array.isArray(body) ? body : Array.isArray(body?.positions) ? body.positions : []
      return { status: 'ok', positions, body }
    } catch (e) {
      return { status: 'off', positions: [], error: e.message, kind: e.kind }
    }
  }

  /** §2 GET /history (command history; spans closed positions). */
  async function getHistory({ retry = true } = {}) {
    const err = tokenError()
    if (err) return { status: 'refused', history: [], error: err.message }
    try {
      const { body } = await send(cfg, { method: 'GET', path: '/history', retry })
      const history = Array.isArray(body) ? body : Array.isArray(body?.history) ? body.history : []
      return { status: 'ok', history, body }
    } catch (e) {
      return { status: 'off', history: [], error: e.message, kind: e.kind }
    }
  }

  // --- Write endpoints ------------------------------------------------------
  /**
   * §2.1 POST /order.
   *
   * Returns `unknown` -- never a throw -- when the answer never arrived (§4.3):
   * the caller must reconcile, not guess. The key field is echoed so the caller
   * can reconcile and, if needed, resend with the SAME key (§4.5).
   *
   * @returns {Promise<{status:'ok'|'duplicate'|'conflict'|'rejected'|'unknown'|'refused',
   *                    ticket?:number|null, key?:string, duplicate?:boolean,
   *                    error?:string, attempt?:object}>}
   */
  async function placeOrder(order = {}) {
    const err = tokenError()
    if (err) return { status: 'refused', error: err.message }

    let key
    try {
      key = idempotencyKeyFor(order)
    } catch (e) {
      return { status: 'rejected', error: e.message }
    }

    const gate = await assertDemoAccount()
    if (!gate.allowed) {
      return { status: 'refused', key, account_type: gate.account_type, error: gate.reason || gate.error }
    }

    // The EXACT wire payload is recorded on the attempt. A resend (§4.4) must be
    // byte-equivalent to the first attempt: the bridge compares payloads per key
    // and answers 409 on a mismatch, so a re-derived (even semantically equal)
    // body could turn a safe retry into a perceived conflict.
    const payload = { ...order, 'Idempotency-Key': key, clientOrderId: key }
    const attempt = {
      clientOrderId: key,
      symbol: order.symbol,
      side: order.side,
      type: order.type ?? 'market',
      qty: order.qty,
      sl: order.sl,
      tp: order.tp ?? null,
      comment: order.comment ?? null,
      sentAt: now(),
      payload, // replayed verbatim by reconcile()
    }

    try {
      const { body } = await send(cfg, {
        method: 'POST',
        path: '/order',
        // §2.1: the key travels in the HEADER, and the bridge mirrors it in the
        // body. The spread comes first so a caller cannot overwrite the key with
        // a different one (that would be a real double order, §4.5).
        body: payload,
        retry: false, // §4.3: never an automatic immediate retry
      })
      return {
        status: body?.duplicate === true ? 'duplicate' : 'ok',
        ticket: body?.ticket ?? null,
        duplicate: body?.duplicate === true,
        key,
        filled: body?.filled ?? null,
        attempt,
        body,
      }
    } catch (e) {
      if (e.kind === 'http' && e.status === 409) {
        // §2.1: same key, different payload -> the bridge refuses. Never resend.
        return { status: 'conflict', error: e.message, original: e.body?.original ?? null, key, attempt }
      }
      if (e.kind === 'http') {
        // A definite answer (4xx/5xx). Not 'unknown': the order was not accepted,
        // and retrying it would need a NEW idempotency decision, not a blind resend.
        return { status: 'rejected', error: e.message, httpStatus: e.status, key, attempt }
      }
      if (isUnknownCause(e)) {
        // §4.3: timeout / reset -> unknown. No retry here, on purpose.
        return { status: 'unknown', error: e.message, kind: e.kind, key, attempt }
      }
      return { status: 'rejected', error: e.message, kind: e.kind, key, attempt }
    }
  }

  /** §2 POST /order/close - idempotent (closing a closed order = ok). */
  async function closeOrder({ ticket, clientOrderId, ...rest } = {}) {
    const err = tokenError()
    if (err) return { status: 'refused', error: err.message }
    let key = null
    try {
      key = clientOrderId ? idempotencyKeyFor({ clientOrderId }) : null
    } catch (e) {
      return { status: 'rejected', error: e.message }
    }
    try {
      const { body } = await send(cfg, {
        method: 'POST',
        path: '/order/close',
        body: { ticket, ...(key ? { 'Idempotency-Key': key, clientOrderId: key } : {}), ...rest },
        retry: false,
      })
      return { status: 'ok', ticket: body?.ticket ?? ticket, duplicate: body?.duplicate === true, key, body }
    } catch (e) {
      if (isUnknownCause(e)) return { status: 'unknown', error: e.message, kind: e.kind, ticket, key }
      return { status: 'rejected', error: e.message, kind: e.kind, httpStatus: e.status, ticket, key }
    }
  }

  /** §2 POST /order/modify - SL/TP by ticket, idempotent. */
  async function modifyOrder({ ticket, sl, tp, clientOrderId, ...rest } = {}) {
    const err = tokenError()
    if (err) return { status: 'refused', error: err.message }
    let key = null
    try {
      key = clientOrderId ? idempotencyKeyFor({ clientOrderId }) : null
    } catch (e) {
      return { status: 'rejected', error: e.message }
    }
    try {
      const { body } = await send(cfg, {
        method: 'POST',
        path: '/order/modify',
        body: { ticket, sl, tp, ...(key ? { 'Idempotency-Key': key, clientOrderId: key } : {}), ...rest },
        retry: false,
      })
      return { status: 'ok', ticket: body?.ticket ?? ticket, duplicate: body?.duplicate === true, key, body }
    } catch (e) {
      if (isUnknownCause(e)) return { status: 'unknown', error: e.message, kind: e.kind, ticket, key }
      return { status: 'rejected', error: e.message, kind: e.kind, httpStatus: e.status, ticket, key }
    }
  }

  // --- §4.4/§4.5 reconciliation ---------------------------------------------
  /**
   * Resolve an `unknown` order. This is the ONLY path that may send a /order
   * request a second time, and it reuses the recorded key unchanged.
   *
   * @param {object} order an `unknown` result (or anything with status+key+attempt)
   * @returns {Promise<{status:string, ...}>} 'ok' found by ticket, 'open' found by
   *          comment, 'unknown' no answer, 'still-unknown' waiting/found-nothing,
   *          'resend-ok'/'resend-duplicate'/'resend-unknown'/'resend-rejected'.
   */
  async function reconcile(order = {}, { positions } = {}) {
    if (order.status !== 'unknown') {
      return { status: 'not-unknown', detail: `status is '${order.status}', nothing to reconcile` }
    }
    const key = order.key
    const sentAt = order.attempt?.sentAt ?? order.sentAt ?? 0
    const waitedMs = Math.max(0, now() - sentAt)

    // Step 1 - look up, never retry blind (§4.4).
    // NOTE: `order.ticket` is the ticket we EXPECT (the attempt's), not a ticket
    // already found -- a found position also carries `ticket`. The three lookups
    // are kept separate so an expected ticket can never be mistaken for a match.
    const pos = positions ?? (await getPositions()).positions ?? []
    const list = Array.isArray(pos) ? pos : []
    const wantedComment = order.attempt?.comment ?? order.comment ?? null
    const expectedTicket = order.attempt?.ticket ?? order.ticket ?? null
    const byTicket = expectedTicket === null ? null : list.find((p) => p && String(p.ticket) === String(expectedTicket))
    // Same-key match: the bridge echoes clientOrderId (or magic) on the position.
    const byKey = key ? list.find((p) => p && p.clientOrderId && String(p.clientOrderId) === String(key)) : null
    const byComment = wantedComment ? list.find((p) => p && p.comment === wantedComment) : null
    const found = byTicket || byKey || byComment
    if (found) {
      const how = found === byTicket ? 'ticket' : found === byKey ? 'clientOrderId' : 'comment'
      return {
        status: 'ok',
        found: how,
        ticket: found.ticket ?? expectedTicket ?? null,
        position: found,
        key,
        resent: false,
        waitedMs,
      }
    }

    // Step 2 - only past RECONCILE_AFTER is a resend even considered (§4.4).
    if (waitedMs < cfg.reconcileAfterMs) {
      return { status: 'still-unknown', reason: 'below RECONCILE_AFTER', waitedMs, resendAfterMs: cfg.reconcileAfterMs, key, resent: false }
    }

    // Step 3 - resend with the SAME key. §4.5: never a new key (the payload is
    // replayed verbatim from the attempt so the bridge still sees one request).
    const replay = order.attempt?.payload ?? order.payload ?? null
    const again = replay
      ? await placeOrder({ ...replay })
      : await placeOrder({
          // No recorded payload (an unknown built by hand): rebuild from the
          // attempt fields. The key is the part that must be invariant.
          clientOrderId: key,
          symbol: order.attempt?.symbol,
          side: order.attempt?.side,
          type: order.attempt?.type,
          qty: order.attempt?.qty,
          sl: order.attempt?.sl,
          tp: order.attempt?.tp,
          comment: order.attempt?.comment,
        })
    return {
      status: again.status === 'ok' ? 'resend-ok' : again.status === 'duplicate' ? 'resend-duplicate' : again.status === 'unknown' ? 'resend-unknown' : 'resend-rejected',
      key,
      // §4.5 invariant, asserted explicitly: the retry key must equal the first key.
      sameKey: again.key === key,
      resent: true,
      waitedMs,
      ticket: again.ticket ?? null,
      detail: again,
    }
  }

  /**
   * §5: one-way position sync. Maps bridge positions onto `positions`
   * documents with source 'mt5' and externalId = ticket.
   */
  async function syncPositions() {
    const res = await getPositions()
    if (res.status !== 'ok') return { status: res.status, error: res.error, docs: [] }
    const docs = res.positions.map((p) => ({
      source: 'mt5',
      externalId: p?.ticket ?? null,
      symbol: p?.symbol ?? null,
      side: p?.side ?? (p?.type === 1 ? 'SELL' : 'BUY'),
      qty: Number(p?.qty ?? p?.volume ?? 0),
      entryPrice: Number(p?.entryPrice ?? p?.price_open ?? 0),
      sl: p?.sl ?? null,
      tp: p?.tp ?? null,
      comment: p?.comment ?? null,
      clientOrderId: p?.clientOrderId ?? p?.magic ?? null,
      syncedAt: new Date(now()).toISOString(),
      raw: p,
    }))
    return { status: 'ok', docs }
  }

  /** SHA-256 of the key, for audit logs that must not store raw keys twice. */
  function keyFingerprint(key = '') {
    return createHash('sha256').update(String(key)).digest('hex').slice(0, 12)
  }

  return {
    config: cfg,
    // reads
    getHealth,
    getAccount,
    getPositions,
    getHistory,
    // writes
    placeOrder,
    closeOrder,
    modifyOrder,
    // §4 / §6
    reconcile,
    assertDemoAccount,
    syncPositions,
    // helpers (exported for tests + callers)
    idempotencyKeyFor,
    keyFingerprint,
    /** @internal test seam: forget the cached /health payload */
    _resetHealthCache: () => {
      healthCache = null
    },
  }
}

export default createMt5Client

// =============================================================================
//  One-shot probe for Node's aggregate /health (D9, checkpoint section 7)
// =============================================================================

/**
 * Probe the bridge ONCE, without keeping a client or retrying.
 *
 * Used by server/webhook.mjs so the aggregate /health surfaces the MT5 bridge
 * as a component. Fail-closed and fail-soft: a missing token or a dead bridge
 * becomes a status, never a throw. `env` is injectable for tests.
 *
 * @returns {Promise<{status:'ok'|'degraded'|'off'|'refused', url:string, body:object|null, error:string|null}>}
 */
export async function mt5Health(env = process.env) {
  const cfg = loadMt5Config(env)
  if (!cfg.token) {
    return { status: 'off', url: cfg.url, body: null, error: 'MT5_BRIDGE_TOKEN is not set' }
  }
  const client = createMt5Client({ url: cfg.url, token: cfg.token })
  const res = await client.getHealth()
  return { status: res.status, url: cfg.url, body: res.body ?? null, error: res.error ?? null }
}
