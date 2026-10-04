#!/usr/bin/env node
// =============================================================================
//  TM TRADING - MT5 bridge client fixtures (roadmap Phase 12, checkpoint §7)
//
//  Pure transport test: a LOCAL MOCK HTTP SERVER stands in for server.py.
//  No MT5 terminal, no network, no external dependency.
//
//  Cases required by the checkpoint:
//    §4.2 idempotency      two placeOrder calls, same key -> exactly 1 ticket
//    §4.3 timeout          -> status 'unknown', NO immediate retry
//    §4.4 reconcile        found -> open/ok, no resend
//    §4.4 reconcile        not found + within RECONCILE_AFTER -> no resend
//    §4.4/5 reconcile      not found + past RECONCILE_AFTER -> resend, SAME key
//    §4   GET retry        connection error -> 2 retries with backoff; 4xx -> none
//    §6   fail-closed      missing token -> refuse, mock sees ZERO order requests
//    §6   demo-first       account_type !== 'demo' -> order refused
//    §2.1 key derivation   real engine/keys.mjs clientOrderId -> byte-identical key
//
//  Run:  node exec/mt5/test.mjs   (wired into `npm test` as test:mt5)
// =============================================================================
import { createServer } from 'node:http'
import { createMt5Client, MAX_ATTEMPTS, GET_TIMEOUT_MS } from './client.mjs'
import { alertKey, clientOrderId } from '../../engine/keys.mjs'

let pass = 0
let fail = 0
const section = (t) => console.log(`\n${t}`)
function check(name, cond, detail = '') {
  if (cond) {
    pass++
    console.log(`  ok   ${name}`)
  } else {
    fail++
    console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`)
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// =============================================================================
//  Mock bridge (stands in for exec/mt5/server.py)
// =============================================================================
/** MT5 position shape as returned by the official lib (for /positions). */
const mt5Position = (p) => ({
  ticket: p.ticket,
  symbol: p.symbol ?? 'XAUUSD',
  type: p.side === 'SELL' ? 1 : 0,
  volume: Number(p.qty ?? 0.1),
  price_open: Number(p.entryPrice ?? 2341.25),
  sl: p.sl ?? 2318.4,
  tp: p.tp ?? 2364.1,
  comment: p.comment ?? '',
  magic: p.magic ?? 0,
  externalId: p.ticket,
})

/**
 * Start a mock bridge. Always 200 + JSON (contract §2: never HTML).
 * @param {object} opt
 * @param {string} [opt.token]     expected bearer token ('' = accept any)
 * @param {'demo'|'real'|'contest'} [opt.accountType]
 * @param {number} [opt.orderDelayMs] delay before answering POST /order
 * @param {number} [opt.getStatus]    answer GETs with this non-2xx status
 * @param {boolean} [opt.breakSockets] destroy the socket on GET (connection error)
 * @param {number} [opt.positionsStatus]
 * @param {object[]} [opt.positions]
 * @param {boolean} [opt.rejectReal]  answer POST /order with 401 when token mismatches
 */
async function startMock(opt = {}) {
  const state = {
    requests: [],
    orders: new Map(), // Idempotency-Key -> { ticket, body, hash }
    created: 0, // REAL creations (the number that must be 1)
    nextTicket: 40311842,
    getAttempts: 0,
  }
  const positions = [] // live positions the mock reports on GET /positions

  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    const path = url.pathname
    let body = ''
    req.on('data', (c) => {
      body += c
    })
    req.on('error', () => {})
    req.on('end', async () => {
      const rec = { method: req.method, path, headers: req.headers, body: body ? safeJson(body) : null }
      state.requests.push(rec)
      if (res.writableEnded || res.destroyed) return // client already gave up

      const json = (code, obj) => {
        if (res.writableEnded) return
        res.writeHead(code, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(obj))
      }
      const auth = String(req.headers.authorization || '')
      const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
      const token = opt.token ?? 'mock-bridge-token'
      // /health is the unauthenticated probe the client uses for the demo gate;
      // an option `healthToken` lets a test keep auth on it too.
      const healthToken = opt.healthToken === undefined ? '' : opt.healthToken
      const isHealth = path === '/health'
      if ((isHealth ? healthToken : token) !== '' && bearer !== (isHealth ? healthToken : token)) {
        return json(401, { ok: false, error: 'token khong hop le' })
      }

      // --- GET -----------------------------------------------------------------
      if (req.method === 'GET') {
        state.getAttempts++
        if (opt.breakSockets) {
          req.socket.destroy() // connection error -> retryable per §4
          return
        }
        if (opt.getStatus && path === '/positions') return json(opt.getStatus, { ok: false, error: `boom ${opt.getStatus}` })
        if (path === '/health') {
          // opt.accountType === null emulates a degraded bridge that omits
          // account_type -> the client must refuse to order (demo-first gate).
          const accountType = opt.accountType === undefined ? 'demo' : opt.accountType
          const payload = {
            ok: true,
            mt5: { connected: true, terminal: 'MetaTrader 5', account: 12345678, company: 'Mock Broker' },
            uptime: 3612,
          }
          if (accountType !== null) payload.account_type = accountType
          return json(200, payload)
        }
        if (path === '/account') return json(200, { ok: true, balance: 10000, equity: 10000, margin: 0, currency: 'USD', account_type: opt.accountType ?? 'demo' })
        if (path === '/positions') {
          if (opt.positionsStatus) return json(opt.positionsStatus, { ok: false, error: 'positions error' })
          return json(200, positions.map(mt5Position))
        }
        if (path === '/history') return json(200, { ok: true, history: [] })
        return json(404, { ok: false, error: 'not found' })
      }

      // --- POST /order ---------------------------------------------------------
      if (req.method === 'POST' && path === '/order') {
        if (opt.orderDelayMs) await sleep(opt.orderDelayMs)
        const key = req.headers['idempotency-key'] || rec.body?.['Idempotency-Key'] || rec.body?.clientOrderId
        if (!key) return json(422, { ok: false, error: 'thieu Idempotency-Key' })
        // Canonical payload hash: the idempotency fields are removed and the rest
        // is key-sorted, so JSON key ORDER cannot fake a payload mismatch (§2.1).
        const fields = { ...(rec.body || {}) }
        delete fields['Idempotency-Key']
        delete fields.clientOrderId
        const hash = JSON.stringify(
          Object.fromEntries(
            Object.keys(fields)
              .sort()
              .map((k) => [k, fields[k]]),
          ),
        )
        const prev = state.orders.get(key)
        if (prev) {
          // §4.2: repeated key -> previous ticket, duplicate:true, nothing placed.
          const duplicate = prev.hash === hash
          if (!duplicate) {
            // §2.1: same key, different payload -> 409 with the original ticket.
            return json(409, { ok: false, error: 'idempotency-key trung nhung payload khac', original: { ticket: prev.ticket } })
          }
          return json(200, { ok: true, ticket: prev.ticket, clientOrderId: key, duplicate: true, filled: { price: prev.price, qty: prev.qty } })
        }
        // FIRST time this key is seen: this is the only place a ticket is minted.
        state.created++
        const ticket = state.nextTicket++
        state.orders.set(key, { ticket, hash, price: 2341.25, qty: rec.body?.qty ?? 0.1 })
        positions.push({
          ticket,
          symbol: rec.body?.symbol,
          side: rec.body?.side,
          qty: rec.body?.qty,
          entryPrice: 2341.25,
          sl: rec.body?.sl,
          tp: rec.body?.tp,
          comment: rec.body?.comment,
        })
        return json(200, { ok: true, ticket, clientOrderId: key, duplicate: false, filled: { price: 2341.25, qty: rec.body?.qty ?? 0.1 } })
      }

      // --- POST /order/close, /order/modify ------------------------------------
      if (req.method === 'POST' && (path === '/order/close' || path === '/order/modify')) {
        const ticket = rec.body?.ticket
        if (path === '/order/close') {
          const i = positions.findIndex((p) => String(p.ticket) === String(ticket))
          const wasOpen = i >= 0
          if (wasOpen) positions.splice(i, 1)
          return json(200, { ok: true, ticket, closed: wasOpen, note: wasOpen ? 'closed' : 'already-closed' })
        }
        const p = positions.find((x) => String(x.ticket) === String(ticket))
        if (p) {
          if (rec.body?.sl !== undefined) p.sl = rec.body.sl
          if (rec.body?.tp !== undefined) p.tp = rec.body.tp
        }
        return json(200, { ok: true, ticket, modified: !!p })
      }

      return json(404, { ok: false, error: 'not found' })
    })
  })

  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const port = server.address().port
  return {
    state,
    positions,
    url: `http://127.0.0.1:${port}`,
    async close() {
      server.closeAllConnections?.()
      await new Promise((r) => server.close(r))
    },
  }
}

function safeJson(s) {
  try {
    return JSON.parse(s)
  } catch {
    return { __raw: String(s).slice(0, 200) }
  }
}

const ORDER_KEYS = (s) => s.requests.filter((r) => r.method === 'POST' && r.path === '/order')
const keyOf = (r) => r.headers['idempotency-key'] || r.body?.clientOrderId

/** §2.1 payload built from the REAL key derivation (engine/keys.mjs). */
function orderFor(page, seq = 0) {
  const key = alertKey(page)
  const coid = clientOrderId(key, seq)
  return { key, coid, payload: { symbol: 'XAUUSD', side: 'BUY', type: 'market', qty: 0.1, sl: 2318.4, tp: 2364.1, comment: 'tm:sv:2026-10-02', clientOrderId: coid } }
}
const PAGE_A = { ts: '2026-10-02T03:17:21Z', symbol: 'XAUUSD', tf: '15', action: 'ENTRY', side: 'BUY', price: 2341.25, mode: 'live' }
const PAGE_B = { ...PAGE_A, ts: '2026-10-02T04:00:00Z' }

// =============================================================================
async function main() {
  section('1. §4.2 idempotency: two placeOrder calls with the SAME key -> exactly 1 ticket')

  const m1 = await startMock()
  const c1 = createMt5Client({ url: m1.url, token: 'mock-bridge-token' })
  const { coid: coidA, payload: payloadA } = orderFor(PAGE_A)

  const o1 = await c1.placeOrder(payloadA)
  const o2 = await c1.placeOrder(payloadA) // same clientOrderId -> same key
  check('first placeOrder -> ok + ticket', o1.status === 'ok' && Number.isFinite(o1.ticket), JSON.stringify(o1))
  check('second placeOrder -> duplicate:true', o2.status === 'duplicate' && o2.duplicate === true, JSON.stringify(o2))
  check('both calls return the SAME ticket', o1.ticket === o2.ticket, `${o1.ticket} vs ${o2.ticket}`)
  check('mock minted exactly ONE ticket (state.created === 1)', m1.state.created === 1, `created=${m1.state.created}`)
  check('mock saw exactly 2 /order requests (real double POST, deduped by key)', ORDER_KEYS(m1.state).length === 2, `n=${ORDER_KEYS(m1.state).length}`)
  check('both requests carried the same Idempotency-Key header', ORDER_KEYS(m1.state).every((r) => keyOf(r) === coidA), JSON.stringify(ORDER_KEYS(m1.state).map(keyOf)))
  check('Idempotency-Key === head of the real clientOrderId from engine/keys.mjs', o2.key === coidA && coidA === clientOrderId(alertKey(PAGE_A), 0), `${o2.key} vs ${coidA}`)
  check('ticket is an integer (MT5 position ticket)', Number.isInteger(o1.ticket), String(o1.ticket))
  check('duplicate answer placed nothing new (positions length 1)', m1.positions.length === 1, `positions=${m1.positions.length}`)

  // §2.1 conflict branch: same key, DIFFERENT payload -> 409, never a second ticket.
  // Same mock, so the key recorded by the first call is still there.
  const conflict = await c1.placeOrder({ ...payloadA, qty: 0.5 })
  check('same key + different payload -> conflict (409)', conflict.status === 'conflict' && conflict.original?.ticket === o1.ticket, JSON.stringify(conflict))
  check('conflict minted no extra ticket', m1.state.created === 1, `created=${m1.state.created}`)
  await m1.close()

  section('2. §4.3 timeout -> status unknown, NO automatic immediate retry')

  const m3 = await startMock({ orderDelayMs: 250 })
  const c3 = createMt5Client({ url: m3.url, token: 'mock-bridge-token', timeouts: { get: 400, post: 60 } })
  const t0 = Date.now()
  const u1 = await c3.placeOrder(payloadA)
  const elapsed = Date.now() - t0
  check("timeout -> status 'unknown'", u1.status === 'unknown', JSON.stringify(u1))
  check("kind is 'timeout'", u1.kind === 'timeout', String(u1.kind))
  check('unknown carries the key for later reconciliation', u1.key === coidA, String(u1.key))
  check('unknown carries attempt metadata (sentAt/comment)', Number.isFinite(u1.attempt?.sentAt) && u1.attempt?.comment === payloadA.comment, JSON.stringify(u1.attempt))
  check('NO immediate retry: exactly 1 POST /order request', ORDER_KEYS(m3.state).length === 1, `n=${ORDER_KEYS(m3.state).length}`)
  check('no ticket was invented client-side', u1.ticket === undefined || u1.ticket === null, JSON.stringify(u1.ticket))
  check('placeOrder returned on timeout, did not wait for the 250 ms answer', elapsed < 200, `elapsed=${elapsed}ms`)
  await sleep(300) // let the late mock answer land (it must not be treated as a result)
  check('late answer never became a result (still 1 request)', ORDER_KEYS(m3.state).length === 1, `n=${ORDER_KEYS(m3.state).length}`)
  await m3.close()

  section('3. §4.4 reconcile: unknown -> found by ticket/comment -> open/ok, no resend')

  const m4 = await startMock()
  const c4 = createMt5Client({ url: m4.url, token: 'mock-bridge-token', reconcileAfterMs: 0 })
  const { coid: coidB, payload: payloadB } = orderFor(PAGE_B)
  // The order DID reach MT5 (bridge answered); we "lost" the answer -> build an unknown by hand.
  const real = await c4.placeOrder(payloadB)
  // Timestamps deliberately differ from real.attempt so the payload replay is
  // what proves the resend is byte-identical (attempt.payload is the wire body).
  const unknown = {
    status: 'unknown',
    key: real.key,
    ticket: real.ticket,
    attempt: { clientOrderId: coidB, comment: payloadB.comment, symbol: payloadB.symbol, side: payloadB.side, type: payloadB.type, qty: payloadB.qty, sl: payloadB.sl, tp: payloadB.tp, sentAt: Date.now() - 60_000, payload: real.attempt.payload },
  }
  const rec4 = await c4.reconcile(unknown)
  check("found -> status 'ok'", rec4.status === 'ok', JSON.stringify(rec4))
  check('found ticket equals the placed ticket', rec4.ticket === real.ticket, `${rec4.ticket} vs ${real.ticket}`)
  check('reconcile did NOT resend (resent:false)', rec4.resent === false)
  check('mock still saw only the original POST /order', ORDER_KEYS(m4.state).length === 1, `n=${ORDER_KEYS(m4.state).length}`)
  check('mock minted exactly 1 ticket', m4.state.created === 1, `created=${m4.state.created}`)
  await m4.close()

  section('4. §4.4 reconcile: not found AND within RECONCILE_AFTER -> still NO resend')

  const m5 = await startMock()
  const c5 = createMt5Client({ url: m5.url, token: 'mock-bridge-token', reconcileAfterMs: 30_000 })
  // An order that never reached the bridge: EMPTY ticket, comment that matches nothing.
  const ghost = { status: 'unknown', key: coidB, attempt: { clientOrderId: coidB, comment: 'tm:ghost:2099-01-01', sentAt: Date.now() - 1_000, symbol: 'XAUUSD', side: 'BUY', type: 'market', qty: 0.1, sl: 2318.4, tp: 2364.1 } }
  const rec5 = await c5.reconcile(ghost)
  check("not found + young -> status 'still-unknown'", rec5.status === 'still-unknown', JSON.stringify(rec5))
  check('reason names RECONCILE_AFTER', String(rec5.reason).includes('RECONCILE_AFTER'), String(rec5.reason))
  check('waitedMs reported below the gate', rec5.waitedMs < 30_000 && rec5.resendAfterMs === 30_000, JSON.stringify({ waitedMs: rec5.waitedMs, gate: rec5.resendAfterMs }))
  check('NO resend: mock saw ZERO POST /order requests', ORDER_KEYS(m5.state).length === 0, `n=${ORDER_KEYS(m5.state).length}`)
  check('NO ticket created', m5.state.created === 0, `created=${m5.state.created}`)
  // Boundary: the client resends when already-elapsed >= RECONCILE_AFTER. Here
  // sentAt is exactly 30 s ago, so the gate must be considered crossed.
  const atGate = { ...ghost, attempt: { ...ghost.attempt, sentAt: Date.now() - 30_000 } }
  const c5b = createMt5Client({ url: m5.url, token: 'mock-bridge-token', reconcileAfterMs: 30_000, timeouts: { get: GET_TIMEOUT_MS, post: 1000 } })
  const rec5b = await c5b.reconcile(atGate)
  check('boundary: waitedMs >= RECONCILE_AFTER -> resend allowed', rec5b.waitedMs >= 30_000 && rec5b.resent === true && rec5b.sameKey === true, JSON.stringify({ waitedMs: rec5b.waitedMs, status: rec5b.status, sameKey: rec5b.sameKey }))
  await m5.close()

  section('5. §4.4/§4.5 reconcile: not found AND past RECONCILE_AFTER -> resend with the SAME key')

  const m6 = await startMock()
  const c6 = createMt5Client({ url: m6.url, token: 'mock-bridge-token', reconcileAfterMs: 5_000 })
  const real6 = await c6.placeOrder(orderFor(PAGE_B).payload) // a real ticket exists, so the lookup can only fail via the ghost comment
  const past = {
    status: 'unknown',
    key: real6.key,
    attempt: { clientOrderId: real6.key, comment: 'tm:ghost:2099-01-01', sentAt: Date.now() - 20_000, symbol: 'XAUUSD', side: 'BUY', type: 'market', qty: 0.1, sl: 2318.4, tp: 2364.1, payload: real6.attempt.payload },
  }
  const rec6 = await c6.reconcile(past)
  const posts6 = ORDER_KEYS(m6.state)
  check('past the gate -> a resend happened (resent:true)', rec6.resent === true && (rec6.status === 'resend-ok' || rec6.status === 'resend-duplicate'), JSON.stringify({ status: rec6.status, resent: rec6.resent }))
  check('resend used the SAME Idempotency-Key (INVARIANT against double orders)', rec6.sameKey === true && rec6.key === real6.key, `key=${rec6.key} expected=${real6.key}`)
  check('mock confirmed the resend as duplicate:true (no second ticket)', rec6.detail?.status === 'duplicate', JSON.stringify(rec6.detail?.status))
  check('resend payload is byte-equivalent across the wire (no 409 conflict)', posts6.length === 2 && JSON.stringify(posts6[0].body) === JSON.stringify(posts6[1].body), JSON.stringify(posts6.map((r) => r.body)))
  check('mock minted exactly 1 ticket despite 2 POSTs', m6.state.created === 1, `created=${m6.state.created}`)
  check('both POST bodies carried the same clientOrderId', posts6.length === 2 && posts6[0].body.clientOrderId === posts6[1].body.clientOrderId && posts6[0].body.clientOrderId === real6.key, JSON.stringify(posts6.map((r) => r.body?.clientOrderId)))
  check('both POST headers carried the same Idempotency-Key', posts6.length === 2 && keyOf(posts6[0]) === keyOf(posts6[1]) && keyOf(posts6[1]) === real6.key, JSON.stringify(posts6.map(keyOf)))
  await m6.close()

  section('6. §4 GET retry: connection error -> up to 2 retries with backoff; 4xx -> NO retry')

  const m7 = await startMock({ breakSockets: true })
  const c7 = createMt5Client({ url: m7.url, token: 'mock-bridge-token' })
  const off7 = await c7.getPositions()
  check("connection error -> status 'off' with kind 'network'", off7.status === 'off' && off7.kind === 'network', JSON.stringify(off7))
  check(`retried to the maximum: ${MAX_ATTEMPTS} attempts total (2 retries)`, m7.state.getAttempts === MAX_ATTEMPTS, `attempts=${m7.state.getAttempts}`)
  await m7.close()

  // Backoff timing: real timers, production backoff (200 ms -> 1 s).
  const m8 = await startMock({ breakSockets: true })
  const c8 = createMt5Client({ url: m8.url, token: 'mock-bridge-token' })
  const bt0 = Date.now()
  await c8.getPositions()
  const bt = Date.now() - bt0
  check('backoff actually waited 200 ms + 1 s (~1200 ms total)', bt >= 1_150 && bt < 6_000, `elapsed=${bt}ms`)
  await m8.close()

  const m9 = await startMock({ getStatus: 404 })
  const c9 = createMt5Client({ url: m9.url, token: 'mock-bridge-token' })
  const r9 = await c9.getPositions()
  check("404 -> status 'off', no retry", r9.status === 'off' && m9.state.getAttempts === 1, `attempts=${m9.state.getAttempts} status=${r9.status}`)
  check('404 surfaces the bridge error text', String(r9.error).includes('boom 404'), String(r9.error))
  await m9.close()

  const m10 = await startMock({ getStatus: 500 })
  const c10 = createMt5Client({ url: m10.url, token: 'mock-bridge-token' })
  const r10 = await c10.getPositions()
  check('5xx is also not retried (only connection errors are)', m10.state.getAttempts === 1 && r10.status === 'off', `attempts=${m10.state.getAttempts}`)
  await m10.close()

  section('7. §6 fail-closed: missing token -> refuse BEFORE sending (mock sees ZERO requests)')

  const m11 = await startMock({ token: '' }) // accepts ANY token: only fail-closed can stop the request
  const c11 = createMt5Client({ url: m11.url, token: '' })
  const noTok = await c11.placeOrder(payloadA)
  check("missing token -> status 'refused'", noTok.status === 'refused', JSON.stringify(noTok))
  check('reason names MT5_BRIDGE_TOKEN', String(noTok.error).includes('MT5_BRIDGE_TOKEN'), String(noTok.error))
  check('ZERO /order requests reached the mock', ORDER_KEYS(m11.state).length === 0, `n=${ORDER_KEYS(m11.state).length}`)
  check('ZERO requests of any kind reached the mock', m11.state.requests.length === 0, `n=${m11.state.requests.length}`)
  const noTokRead = await c11.getPositions()
  check('reads are fail-closed too (no token -> off/refused, no socket)', noTokRead.status === 'refused' && m11.state.requests.length === 0, JSON.stringify(noTokRead))
  check('no ticket created', m11.state.created === 0, `created=${m11.state.created}`)
  await m11.close()

  // Token is sent as a real Bearer header; a wrong token is rejected by the bridge.
  // /health stays open (healthToken '') so the 401 can only come from /order.
  const m12 = await startMock({ token: 'expected-token', healthToken: '' })
  const c12 = createMt5Client({ url: m12.url, token: 'wrong-token' })
  const bad12 = await c12.placeOrder(payloadA)
  check("wrong token -> bridge 401 -> status 'rejected' (not retried)", bad12.status === 'rejected' && bad12.httpStatus === 401, JSON.stringify({ status: bad12.status, http: bad12.httpStatus }))
  check('Authorization header is a Bearer header', String(m12.state.requests[0]?.headers?.authorization).startsWith('Bearer '), String(m12.state.requests[0]?.headers?.authorization))
  await m12.close()

  section("8. §6 demo-first gate: account_type !== 'demo' -> order refused")

  const m13 = await startMock({ accountType: 'real' })
  const c13 = createMt5Client({ url: m13.url, token: 'mock-bridge-token' })
  const real13 = await c13.placeOrder(payloadA)
  check("account_type 'real' -> order refused", real13.status === 'refused', JSON.stringify(real13))
  check('refusal names the demo-first policy', String(real13.error).includes('demo'), String(real13.error))
  check('ZERO /order requests reached the mock', ORDER_KEYS(m13.state).length === 0, `n=${ORDER_KEYS(m13.state).length}`)
  const h13 = await c13.getHealth()
  check("reads still work on a real account (/health ok, account_type 'real')", h13.status === 'ok' && h13.body.account_type === 'real', JSON.stringify(h13.body?.account_type))
  await m13.close()

  const m14 = await startMock({ accountType: 'contest' })
  const c14 = createMt5Client({ url: m14.url, token: 'mock-bridge-token' })
  const contest = await c14.placeOrder(payloadA)
  check("account_type 'contest' -> refused too (only 'demo' passes)", contest.status === 'refused' && ORDER_KEYS(m14.state).length === 0, JSON.stringify({ status: contest.status, orders: ORDER_KEYS(m14.state).length }))
  await m14.close()

  const m15 = await startMock({ accountType: 'demo' })
  const c15 = createMt5Client({ url: m15.url, token: 'mock-bridge-token' })
  const g15 = await c15.assertDemoAccount()
  const demoOrder = await c15.placeOrder(payloadA)
  check("account_type 'demo' -> gate open and order accepted", g15.allowed === true && demoOrder.status === 'ok', JSON.stringify({ gate: g15, order: demoOrder.status }))
  await m15.close()

  const m16 = await startMock({ accountType: null }) // bridge up, account_type missing
  const c16 = createMt5Client({ url: m16.url, token: 'mock-bridge-token' })
  c16._resetHealthCache()
  const down = await c16.placeOrder(payloadA)
  check("account_type missing (bridge degraded) -> refused, not sent blind", down.status === 'refused' && ORDER_KEYS(m16.state).length === 0, JSON.stringify(down))
  await m16.close()

  section('9. §2.1 key derivation from engine/keys.mjs (retry key invariance)')

  const keyA1 = clientOrderId(alertKey(PAGE_A), 0)
  const keyA2 = clientOrderId(alertKey(PAGE_A), 0)
  const keyA1b = clientOrderId(alertKey(PAGE_A), 1)
  const keyB1 = clientOrderId(alertKey(PAGE_B), 0)
  check('same alert payload -> byte-identical clientOrderId', keyA1 === keyA2, `${keyA1} vs ${keyA2}`)
  check('different seq -> different clientOrderId (1 entry vs add-on)', keyA1 !== keyA1b, `${keyA1} vs ${keyA1b}`)
  check('different alert -> different clientOrderId', keyA1 !== keyB1, `${keyA1} vs ${keyB1}`)
  check('key fits the MT5 limit (<= 31 chars)', keyA1.length <= 31, `len=${keyA1.length}`)
  check('key uses only [A-Za-z0-9_-] (§2.1)', /^[A-Za-z0-9_-]+$/.test(keyA1), keyA1)
  check('clientOrderId starts with tm-', keyA1.startsWith('tm-'), keyA1)

  // Same key -> identical wire bytes, twice (the invariant that prevents real double orders).
  const m17 = await startMock({ orderDelayMs: 300 })
  const c17 = createMt5Client({ url: m17.url, token: 'mock-bridge-token', reconcileAfterMs: 1_000, timeouts: { get: 400, post: 60 } })
  const first17 = await c17.placeOrder({ ...payloadA, clientOrderId: keyA1 })
  check("timeout on the first send -> status 'unknown' (nothing assumed)", first17.status === 'unknown', JSON.stringify(first17))
  // Deriving the wire body from the SAME clientOrderId again must be byte-identical.
  const again17 = await c17.placeOrder({ ...payloadA, clientOrderId: keyA1 })
  const wire17 = ORDER_KEYS(m17.state)
  check('re-deriving from the same clientOrderId -> identical key', first17.key === again17.key && first17.key === keyA1, `${first17.key} vs ${again17.key}`)
  check('re-deriving produces byte-identical wire payloads (§4.5)', wire17.length === 2 && JSON.stringify(wire17[0].body) === JSON.stringify(wire17[1].body), JSON.stringify(wire17.map((r) => r.body)))
  check('both wire requests carried identical Idempotency-Key bytes', wire17.length === 2 && keyOf(wire17[0]) === keyOf(wire17[1]) && keyOf(wire17[0]) === keyA1, JSON.stringify(wire17.map(keyOf)))
  await sleep(320) // let the delayed mock answers land (they created a real position)
  // That position is discoverable, so a reconcile here MUST find it instead of
  // resending -- the positive half of §4.4 on the same mock that timed out.
  const found17 = await c17.reconcile({ status: 'unknown', key: first17.key, attempt: { ...first17.attempt, sentAt: Date.now() - 60_000 } })
  check("§4.4 lookup finds the late order -> 'ok', NO resend", found17.status === 'ok' && found17.resent === false && found17.found === 'comment', JSON.stringify({ status: found17.status, found: found17.found, resent: found17.resent }))
  check('no third POST /order was sent once the ticket was found', ORDER_KEYS(m17.state).length === 2, `n=${ORDER_KEYS(m17.state).length}`)
  check('mock never saw a second idempotency key', [...new Set(ORDER_KEYS(m17.state).map(keyOf))].length === 1, JSON.stringify(ORDER_KEYS(m17.state).map(keyOf)))

  // Negative half: a bridge that never answered -> nothing to find -> the resend
  // path runs, and it must reuse the identical key AND the identical payload.
  const m17b = await startMock({ orderDelayMs: 300 })
  const c17b = createMt5Client({ url: m17b.url, token: 'mock-bridge-token', reconcileAfterMs: 1_000, timeouts: { get: 400, post: 60 } })
  const first17b = await c17b.placeOrder({ ...payloadA, clientOrderId: keyA1 })
  const past17 = { status: 'unknown', key: first17b.key, attempt: { ...first17b.attempt, sentAt: Date.now() - 60_000 } }
  const rec17 = await c17b.reconcile(past17)
  check('reconcile resend reuses the identical key (byte-identical)', rec17.key === keyA1 && rec17.sameKey === true && rec17.resent === true, `${rec17.key} vs ${keyA1}`)
  check('resend payload is the recorded wire payload, unchanged (no 409 conflict)', !!rec17.detail?.attempt?.payload && JSON.stringify(rec17.detail.attempt.payload) === JSON.stringify(first17b.attempt.payload), JSON.stringify(rec17.detail?.attempt?.payload))
  const wire17b = ORDER_KEYS(m17b.state)
  check('reconcile replay keeps the wire body byte-identical (no 409 conflict)', wire17b.length === 2 && JSON.stringify(wire17b[0].body) === JSON.stringify(wire17b[1].body), JSON.stringify(wire17b.map((r) => r.body)))
  check('every wire call used the same Idempotency-Key bytes', wire17b.length === 2 && keyOf(wire17b[0]) === keyOf(wire17b[1]) && keyOf(wire17b[1]) === keyA1, JSON.stringify(wire17b.map(keyOf)))
  await m17b.close()
  check('client-side validator accepts the real key', c17.idempotencyKeyFor({ clientOrderId: keyA1 }) === keyA1)
  check('client-side validator rejects an over-long key', (() => {
    try {
      c17.idempotencyKeyFor({ clientOrderId: 'x'.repeat(32) })
      return false
    } catch {
      return true
    }
  })())
  check('client-side validator rejects invalid characters', (() => {
    try {
      c17.idempotencyKeyFor({ clientOrderId: 'tm bad!' })
      return false
    } catch {
      return true
    }
  })())
  check('placeOrder without clientOrderId -> rejected (no anonymous order)', (await c17.placeOrder({ symbol: 'XAUUSD', side: 'BUY', qty: 0.1 })).status === 'rejected')
  await m17.close()

  section('10. §5 position sync + close/modify wiring (one-way: the bridge is truth)')

  const m18 = await startMock()
  const c18 = createMt5Client({ url: m18.url, token: 'mock-bridge-token' })
  const oc1 = await c18.placeOrder(orderFor(PAGE_A).payload)
  const oc2 = await c18.placeOrder(orderFor(PAGE_B).payload)
  const sync = await c18.syncPositions()
  check('sync sees both bridge positions', sync.status === 'ok' && sync.docs.length === 2, `n=${sync.docs.length}`)
  check("docs carry source 'mt5' (one-way, §5)", sync.docs.every((d) => d.source === 'mt5'))
  check('externalId = ticket for the unique sparse index', sync.docs.map((d) => d.externalId).sort().join(',') === [oc1.ticket, oc2.ticket].sort().join(','), JSON.stringify(sync.docs.map((d) => d.externalId)))
  check('symbol/qty/entryPrice mapped from the MT5 field names', sync.docs[0].symbol === 'XAUUSD' && sync.docs[0].qty === 0.1 && sync.docs[0].entryPrice === 2341.25, JSON.stringify(sync.docs[0]))
  check('close maps ticket -> ok', (await c18.closeOrder({ ticket: oc1.ticket })).status === 'ok')
  const afterClose = await c18.getPositions()
  check('closed position disappears from /positions', afterClose.positions.length === 1, `n=${afterClose.positions.length}`)
  check('closing an already-closed ticket is ok (idempotent, §2)', (await c18.closeOrder({ ticket: 999999 })).status === 'ok')
  check('modify maps sl/tp -> ok', (await c18.modifyOrder({ ticket: oc2.ticket, sl: 2300, tp: 2400 })).status === 'ok')
  const afterModify = await c18.getPositions()
  check('modified SL/TP are visible on the next poll', afterModify.positions[0].sl === 2300 && afterModify.positions[0].tp === 2400, JSON.stringify(afterModify.positions[0]))
  check('getHistory returns a list', (await c18.getHistory()).status === 'ok')
  check('getAccount returns balance/equity', (await c18.getAccount()).body.balance === 10000)
  check('getHealth is fail-soft and reports the account type', (await c18.getHealth()).body.account_type === 'demo')
  await m18.close()

  section('11. Reconcile safety: nothing to reconcile / no key -> no request at all')

  const m19 = await startMock()
  const c19 = createMt5Client({ url: m19.url, token: 'mock-bridge-token' })
  const notUnknown = await c19.reconcile({ status: 'ok', key: keyA1, ticket: 1 })
  check('reconciling a settled order -> not-unknown, no request', notUnknown.status === 'not-unknown' && m19.state.requests.length === 0, JSON.stringify({ status: notUnknown.status, reqs: m19.state.requests.length }))
  await m19.close()
}

// =============================================================================
//  Guard: an unexpected throw must NOT hide the summary line (test convention).
main()
  .then(() => {
    console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} pass, ${fail} fail\n`)
    process.exit(fail === 0 ? 0 : 1)
  })
  .catch((e) => {
    console.log(`  FAIL unexpected throw: ${e?.stack || e?.message || e}`)
    fail++
    console.log(`\nFAIL — ${pass} pass, ${fail} fail\n`)
    process.exit(1)
  })
