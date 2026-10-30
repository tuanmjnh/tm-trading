// =============================================================================
//  TM TRADING — V3.9 exchange DEMO error isolation (§63.17/§64.7).
//
//  Every error is NAMESPACED to its venue/profile so one venue's failure can
//  never be mistaken for another's, and is SANITIZED so credentials, signatures,
//  passphrases, auth headers and credential-bearing URLs never leak into logs,
//  error messages, the browser or AI context. A correlation id ties a thrown
//  error to its request without exposing secrets.
// =============================================================================

import { randomUUID } from 'node:crypto'

/** Substrings that must never appear in a surfaced error/message. */
const SECRET_PATTERNS = [
  /api[-_]?key/gi, /api[-_]?secret/gi, /secret/gi, /passphrase/gi, /signature/gi,
  /x-mbx-apikey/gi, /ok-access-[a-z]+/gi, /x-bapi-[a-z-]+/gi, /x-simulated-trading/gi,
  /authorization/gi, /token/gi,
]

/** Query params that can carry a signature/key when a full URL is present. */
const SECRET_PARAMS = ['signature', 'apiKey', 'api_key', 'X-MBX-APIKEY']

/**
 * Redact secrets from an arbitrary string (message, URL, payload dump).
 * Best-effort, defence-in-depth: we already avoid putting secrets in errors,
 * this scrubs anything that slips through.
 */
export function sanitizeText(input) {
  let text = String(input ?? '')
  // Strip signature-bearing query params from any embedded URL.
  for (const p of SECRET_PARAMS) {
    text = text.replace(new RegExp(`([?&])${p}=[^&\\s"']+`, 'gi'), '$1[REDACTED]')
  }
  // Mask long base64/hex tokens (>=32 chars) that look like signatures/keys.
  text = text.replace(/\b[A-Za-z0-9+/=_-]{32,}\b/g, (m) => (/^[0-9a-fA-F]{32,}$/.test(m) || /[+/=]/.test(m) ? '[REDACTED]' : m))
  return text
}

/** True when a string appears to contain secret material (used by tests). */
export function looksSecret(text) {
  const s = String(text ?? '')
  return SECRET_PATTERNS.some((re) => re.test(s))
}

/** New correlation id for a request/attempt. */
export function correlationId() {
  return `corr_${randomUUID().replace(/-/g, '').slice(0, 20)}`
}

/**
 * Build a venue-namespaced, sanitized error.
 * @param {string} venue  venue id (bybit|okx|binance)
 * @param {string} code   stable machine code (no secrets)
 * @param {string} message human message (will be sanitized)
 * @param {object} [meta] { profileId, correlationId, httpStatus, retryable, cause }
 */
export function venueError(venue, code, message, meta = {}) {
  const err = new Error(sanitizeText(message))
  err.code = `exchange.${venue}.${code}`
  err.venue = venue
  err.profileId = meta.profileId ?? null
  err.correlationId = meta.correlationId ?? null
  err.httpStatus = meta.httpStatus ?? null
  err.retryable = meta.retryable === true
  if (meta.cause) err.cause = meta.cause
  return err
}

/**
 * Normalize a raw venue error/HTTP response into a namespaced error WITHOUT
 * cross-contaminating other venues. `rawCode` is the venue's own code (e.g.
 * Bybit retCode, OKX code, Binance code/-1003).
 */
export function normalizeVenueError(venue, profileId, { httpStatus, rawCode, rawMessage, correlationId: cid, retryable }) {
  const code = rawCode == null ? `http-${httpStatus ?? 'error'}` : `${rawCode}`
  // Rate-limit / banned / gateway classes are retryable with backoff.
  const isRetryable = retryable === true
    || httpStatus === 429 || httpStatus === 418 || httpStatus >= 500
    || String(rawCode) === '-1003' || String(rawCode) === '-1004' || String(rawCode) === '-1015'
    || String(rawCode) === '50011' || String(rawCode) === '429'
  return venueError(venue, code, rawMessage || `venue returned ${code}`, { profileId, correlationId: cid, httpStatus, retryable: isRetryable })
}

/**
 * Classify a thrown error for failover decisions WITHOUT mutating other venues'
 * state. Returns a small, secret-free descriptor the policy engine can use.
 */
export function classifyError(err) {
  const code = String(err?.code ?? 'exchange.unknown')
  const venue = err?.venue ?? null
  const retryable = err?.retryable === true
  const auth = /auth|sign|apikey|api-key|permission|401|403|-1021|-1022|okx-50\d\d\d/i.test(code) || err?.httpStatus === 401 || err?.httpStatus === 403
  const rateLimited = /-1003|-1015|429|418|rate|too many|50011/i.test(code)
  const hostRejected = code === 'exchange.demo-host-required' || code === 'exchange.demo-ws-host-required' || code === 'exchange.simulated-header-required'
  return { code: sanitizeText(code), venue, retryable, auth: auth === true, rateLimited: rateLimited === true, hostRejected: hostRejected === true }
}
