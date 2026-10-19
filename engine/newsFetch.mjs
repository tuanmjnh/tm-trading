// engine/newsFetch.mjs
// Resilient connector fetch policy (V3.5 §60.5 / §60.16 Slice F) — PURE,
// offline-testable.
//
//  §60.5 asks for "bounded retries, exponential backoff with jitter,
//  provider-specific rate limits, request timeouts, circuit breakers, per-source
//  health and a dead-letter/review queue for malformed records". The connector
//  path previously had only a timeout; this module supplies the rest as pure
//  functions so the behaviour is testable without network or clock.
//
//  Two rules the roadmap states explicitly and this module enforces:
//   - permanent permission/credential/license errors are NEVER retried
//     ("do not retry permanent permission, invalid-credential or license errors
//     indefinitely"), and
//   - a payload that is not a feed is a dead letter, not a silent empty success.
import { createHash } from 'node:crypto'

export const NEWS_FETCH_DEFAULTS = Object.freeze({
  maxAttempts: 3,
  baseMs: 500,
  maxMs: 8000,
  jitterRatio: 0.2,
  breakerThreshold: 3,
  breakerCooldownMs: 5 * 60 * 1000,
  timeoutMs: 10000,
  // §60.15: a feed document is small; anything larger is a bomb, not news.
  maxBytes: 2_000_000,
  // §60.15: bounded redirect hops, each target re-validated before it is fetched.
  maxRedirects: 3,
})

export const BREAKER_STATES = Object.freeze(['closed', 'open', 'half_open'])

/** sha1 helper (shared with the ingest identity rules). */
export function sha1Hex(s) {
  return createHash('sha1').update(String(s)).digest('hex')
}

/**
 * Classify an HTTP status for retry purposes.
 * 2xx -> ok; 408/425/429 and 5xx -> retry; anything else (401/403/404/451…) ->
 * permanent. A missing status means the transport failed (network) and is
 * retryable, because nothing in the response said "stop".
 */
export function classifyStatus(status) {
  const s = Number(status)
  if (!Number.isFinite(s) || s <= 0) return 'network'
  if (s >= 200 && s < 300) return 'ok'
  if (s === 408 || s === 425 || s === 429) return 'retry'
  if (s >= 500) return 'retry'
  return 'permanent'
}

/** Only `retry` and `network` outcomes justify another attempt. */
export function isRetryable(kind) {
  return kind === 'retry' || kind === 'network'
}

/**
 * Exponential backoff with bounded jitter. `attempt` is 1-based, so the first
 * delay is `baseMs`. `jitter` is an injectable 0..1 draw (tests pass a fixed
 * number; production passes Math.random) which keeps the schedule symmetric
 * around the raw delay: delay = raw * (1 ± jitterRatio).
 */
export function backoffDelay(attempt, opts = {}) {
  const cfg = { ...NEWS_FETCH_DEFAULTS, ...opts }
  const n = Math.max(1, Math.floor(Number(attempt) || 1))
  // A caller that spreads an options object may carry `undefined` values through
  // it; every field falls back to the documented default rather than producing
  // NaN, because a NaN delay would silently skip the backoff entirely.
  const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback)
  const baseMs = num(cfg.baseMs, NEWS_FETCH_DEFAULTS.baseMs)
  const maxMs = num(cfg.maxMs, NEWS_FETCH_DEFAULTS.maxMs)
  const ratio = Math.max(0, Math.min(1, num(cfg.jitterRatio, NEWS_FETCH_DEFAULTS.jitterRatio)))
  const draw = Math.max(0, Math.min(1, num(cfg.jitter, 0.5)))
  const raw = Math.min(maxMs, baseMs * 2 ** (n - 1))
  return Math.round(raw * (1 + (draw * 2 - 1) * ratio))
}

/**
 * Per-source circuit breaker. While OPEN, a source is not attempted at all
 * (the cheapest possible protection against a hard 429 loop). After the
 * cooldown it becomes HALF_OPEN, which permits trials; a success closes it and a
 * failure restarts the cooldown. State is in-memory by design: it protects a
 * process, and the durable per-source health lives in the registry.
 */
export function createBreaker(opts = {}) {
  const cfg = { ...NEWS_FETCH_DEFAULTS, ...opts }
  const rows = new Map()
  const get = (name) => rows.get(String(name)) || { fails: 0, openedAt: null, lastError: null }
  const stateOf = (name, at = Date.now()) => {
    const r = get(name)
    if (r.openedAt == null) return 'closed'
    return Number(at) - Number(r.openedAt) >= Number(cfg.breakerCooldownMs) ? 'half_open' : 'open'
  }
  return {
    state: stateOf,
    /** May this source be attempted now? */
    allow(name, at = Date.now()) {
      return stateOf(name, at) !== 'open'
    },
    /** Record one attempt outcome. Returns the resulting state. */
    record(name, { ok, at = Date.now(), error = null } = {}) {
      const key = String(name)
      const r = get(key)
      if (ok) {
        rows.set(key, { fails: 0, openedAt: null, lastError: null })
        return 'closed'
      }
      const fails = r.fails + 1
      const openedAt = fails >= Number(cfg.breakerThreshold) ? Number(at) : null
      rows.set(key, { fails, openedAt, lastError: error ? String(error).slice(0, 200) : null })
      return openedAt != null ? 'open' : 'closed'
    },
    snapshot() {
      return Object.fromEntries([...rows].map(([k, v]) => [k, { fails: v.fails, openedAt: v.openedAt, lastError: v.lastError }]))
    },
    reset() {
      rows.clear()
    },
  }
}

/** True when a response body actually looks like an RSS/Atom/RDF document. */
export function looksLikeFeed(text) {
  // `[\s>:]` so RDF (`<rdf:RDF>`) counts as a feed document, not just `<rss>`.
  return /<(rss|feed|rdf)[\s>:]/i.test(String(text || '').slice(0, 2000))
}

// ---------------------------------------------------------------------------
//  §60.15 connector safety: SSRF / redirect / size / content-type guards.
//  A source registry URL is server-controlled, but a compromised or moved
//  source (or an operator edit) must not be able to turn the fetcher into an
//  SSRF gadget or a memory bomb. These are pure so they test without network.
// ---------------------------------------------------------------------------

const PRIVATE_HOST_RES = Object.freeze([
  /^localhost$/,
  /\.localhost$/,
  /\.local$/,
  /\.internal$/,
  /^127\./,
  /^0\./,
  /^10\./,
  /^169\.254\./, // link-local + cloud metadata (169.254.169.254)
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // CGNAT 100.64/10
])

/**
 * True for a host literal that must never be fetched (§60.15: defend against
 * redirects/DNS to private IPs and link-local metadata endpoints).
 */
export function isPrivateHost(host) {
  const h = String(host || '').toLowerCase().replace(/^\[|\]$/g, '')
  if (!h) return true
  if (PRIVATE_HOST_RES.some((re) => re.test(h))) return true
  // IPv6 loopback / ULA (fc00::/7) / link-local (fe80::/10)
  if (h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80')) return true
  return false
}

/**
 * Structural safety of a feed URL. `allowHosts` (optional, non-empty) turns it
 * into an explicit allowlist: a host is accepted only when it equals an entry
 * or is a subdomain of one (e.g. `www.sec.gov` allowed by `sec.gov`).
 */
export function isSafeFeedUrl(raw, { allowHosts = null } = {}) {
  let u
  try {
    u = new URL(String(raw || ''))
  } catch {
    return { ok: false, reason: 'invalid_url' }
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, reason: 'blocked_scheme' }
  if (u.username || u.password) return { ok: false, reason: 'blocked_credentials' }
  if (isPrivateHost(u.hostname)) return { ok: false, reason: 'blocked_private_host' }
  if (Array.isArray(allowHosts) && allowHosts.length) {
    const host = u.hostname.toLowerCase()
    const allowed = allowHosts.some((a) => {
      const x = String(a).trim().toLowerCase()
      return x && (host === x || host.endsWith(`.${x}`))
    })
    if (!allowed) return { ok: false, reason: 'host_not_allowed' }
  }
  return { ok: true, reason: 'ok' }
}

/**
 * Content types a feed connector may accept. A missing header is allowed
 * because many feeds omit it and the body-shape check is the real gate; an
 * explicitly binary/opaque type is refused instead of parsed.
 */
export function isFeedContentType(contentType) {
  if (!contentType) return true
  const ct = String(contentType).toLowerCase()
  return /(rss|atom|application\/xml|text\/xml|\bxml\b|text\/plain|text\/html|application\/json)/.test(ct)
}

/** Header reader that works with a real `Headers` and with a plain-object shim. */
export function headerOf(res, name) {
  const h = res?.headers
  if (!h) return null
  if (typeof h.get === 'function') return h.get(name)
  const key = Object.keys(h).find((k) => k.toLowerCase() === String(name).toLowerCase())
  return key ? h[key] : null
}

/**
 * Follow a bounded number of redirects, validating EVERY hop before fetching it
 * (§60.15). Returns `{ blocked }` when a target is unsafe, or `{ res, url }`.
 */
async function followRedirects({ doFetch, startUrl, allowHosts, maxRedirects, timeoutMs, headers }) {
  let url = String(startUrl)
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const check = isSafeFeedUrl(url, { allowHosts })
    if (!check.ok) return { blocked: check.reason }
    const res = await doFetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: 'manual', headers })
    const status = Number(res?.status)
    const loc = headerOf(res, 'location')
    const isRedirect = status === 301 || status === 302 || status === 303 || status === 307 || status === 308
    if (loc && isRedirect) {
      if (hop >= maxRedirects) return { blocked: 'too_many_redirects' }
      try {
        url = new URL(String(loc), url).toString()
      } catch {
        return { blocked: 'invalid_redirect' }
      }
      continue
    }
    return { res, url }
  }
  return { blocked: 'too_many_redirects' }
}


/**
 * One resilient fetch: bounded attempts, retry only for retryable outcomes,
 * backoff between attempts, and a circuit-breaker gate in front. Never throws —
 * the caller decides policy from the structured outcome, and a permanent failure
 * (`kind: 'permanent'`) must not be retried or escalated into an outage alarm
 * that pages a human for a credential problem.
 */
export async function fetchWithRetry(url, opts = {}) {
  const cfg = { ...NEWS_FETCH_DEFAULTS, ...(opts.policy || {}) }
  const doFetch = opts.fetchImpl || fetch
  const breaker = opts.breaker || null
  const name = String(opts.name || url)
  const now = () => (typeof opts.now === 'function' ? Number(opts.now()) : Date.now())
  const sleep = opts.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)))
  const delays = []
  const maxBytes = Number.isFinite(Number(cfg.maxBytes)) ? Number(cfg.maxBytes) : NEWS_FETCH_DEFAULTS.maxBytes
  const maxRedirects = Number.isFinite(Number(cfg.maxRedirects)) ? Math.floor(Number(cfg.maxRedirects)) : NEWS_FETCH_DEFAULTS.maxRedirects
  const allowHosts = Array.isArray(opts.allowHosts) && opts.allowHosts.length ? opts.allowHosts : null
  const headers = opts.headers || undefined

  // §60.15: reject an unsafe target BEFORE the breaker or any network call, so a
  // bad URL is a config error (permanent), never an outage that opens a breaker.
  const safe = isSafeFeedUrl(url, { allowHosts })
  if (!safe.ok) {
    return { ok: false, attempts: 0, status: null, kind: 'permanent', reason: safe.reason, error: `blocked url: ${safe.reason}`, breaker: breaker ? breaker.state(name, now()) : null, delays }
  }

  if (breaker && !breaker.allow(name, now())) {
    return { ok: false, attempts: 0, status: null, kind: 'retry', reason: 'breaker_open', error: `circuit open for ${name}`, breaker: breaker.state(name, now()), delays }
  }
  let attempts = 0
  const maxAttempts = Number.isFinite(Number(cfg.maxAttempts)) && Number(cfg.maxAttempts) > 0 ? Math.floor(Number(cfg.maxAttempts)) : NEWS_FETCH_DEFAULTS.maxAttempts
  let last = { kind: 'network', status: null, error: 'no attempt made' }
  while (attempts < maxAttempts) {
    attempts += 1
    try {
      const got = await followRedirects({ doFetch, startUrl: url, allowHosts, maxRedirects, timeoutMs: Number(cfg.timeoutMs), headers })
      if (got.blocked) {
        last = { kind: 'permanent', status: null, reason: `blocked_redirect:${got.blocked}`, error: `redirect blocked: ${got.blocked} (${got.url || url})` }
        break
      }
      const res = got.res
      // Real fetch always exposes `status`; a shim may expose only `ok`. Honour
      // whichever is present instead of inventing a network failure (and with it
      // a pointless retry storm) for a response that said it succeeded.
      const raw = Number(res?.status)
      const status = Number.isFinite(raw) && raw > 0 ? raw : res?.ok === true ? 200 : res?.ok === false ? 500 : NaN
      const kind = classifyStatus(status)
      if (kind === 'ok') {
        // §60.15: refuse an opaque/binary content type instead of parsing it.
        const ct = headerOf(res, 'content-type')
        if (!isFeedContentType(ct)) {
          last = { kind: 'permanent', status, reason: 'blocked_content_type', error: `content-type blocked: ${String(ct).slice(0, 80)}` }
          break
        }
        const cl = Number(headerOf(res, 'content-length'))
        if (Number.isFinite(cl) && cl > maxBytes) {
          last = { kind: 'permanent', status, reason: 'oversized', error: `oversized: ${cl} bytes` }
          break
        }
        let text = ''
        try {
          text = await res.text()
        } catch (e) {
          last = { kind: 'permanent', status, error: `unreadable body: ${String(e?.message || e).slice(0, 120)}` }
          break
        }
        if (text.length > maxBytes) {
          last = { kind: 'permanent', status, reason: 'oversized', error: `oversized body: ${text.length} bytes` }
          break
        }
        breaker?.record(name, { ok: true, at: now() })
        return { ok: true, attempts, status, kind: 'ok', text, url: got.url, breaker: breaker ? breaker.state(name, now()) : null, delays }
      }
      last = { kind, status, error: `HTTP ${status}` }
      // A permanent outcome ends the loop immediately (§60.5).
      if (!isRetryable(kind)) break
    } catch (e) {
      last = { kind: 'network', status: null, error: String(e?.message || e).slice(0, 200) }
    }
    if (attempts < maxAttempts) {
      const d = backoffDelay(attempts, { ...cfg, jitterRatio: opts.jitterRatio ?? cfg.jitterRatio, jitter: opts.jitter ?? 0.5 })
      delays.push(d)
      await sleep(d)
    }
  }
  breaker?.record(name, { ok: false, at: now(), error: last.error })
  return { ok: false, attempts, status: last.status, kind: last.kind, reason: last.reason || (last.kind === 'permanent' ? 'permanent_error' : 'exhausted'), error: last.error, breaker: breaker ? breaker.state(name, now()) : null, delays }
}

/**
 * Dead-letter record for a malformed or unusable payload (§60.5 review queue).
 * Rights-safe by construction: the body is NOT stored — only its hash, size and
 * content type — so the queue proves WHAT failed without becoming a second copy
 * of licensed text. `_id` is deterministic so a repeated failure updates one row
 * instead of flooding the queue.
 */
export function deadLetterRecord({ sourceId, url, at, reason, status = null, attempts = 0, text = '', contentType = null } = {}) {
  const body = String(text || '')
  const when = Number.isFinite(Number(at)) ? Number(at) : Date.now()
  const id = `ndl_${sha1Hex(`${sourceId}|${url}|${reason}`).slice(0, 24)}`
  return {
    _id: id,
    sourceId: String(sourceId || 'unknown'),
    url: String(url || ''),
    reason: String(reason || 'malformed'),
    httpStatus: Number.isFinite(Number(status)) ? Number(status) : null,
    attempts: Number(attempts) || 0,
    bytes: body.length,
    contentType: contentType ? String(contentType).slice(0, 120) : null,
    payloadHash: body ? sha1Hex(body) : null,
    firstFailedAt: new Date(when),
    lastFailedAt: new Date(when),
    fails: 1,
    schemaVersion: '1',
  }
}
