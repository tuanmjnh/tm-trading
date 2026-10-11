#!/usr/bin/env node
// =============================================================================
//  TM TRADING — test:realtime: roadmap V3 §31 realtime core acceptance.
//
//  Covers the transport-agnostic core with ZERO network/dependency:
//    * envelope + per-channel sequencer (§31.2) — hoisting, payload shape,
//      strict validation, per-channel independence, publish helper
//    * subscribe protocol (§31.1) — topic aliases, candle timeframe rule,
//      requestId/type/channels validation, instrument resolver seam, exact
//      channel matching
//    * client recovery state machine (§31.3) — gap detection pauses rendering,
//      snapshot request, reconcile, resume; never silently continue
//    * end-to-end — subscribe -> seal -> match -> recover, including one
//      dropped sequence forcing the pause/snapshot/reconcile/resume cycle
//
//  Run: node realtime/test.mjs   (wired into `npm test`)
// =============================================================================

import {
  TOPICS, candleEvent, quoteEvent
} from '../market/events.mjs'
import {
  ENVELOPE_FIELDS, channelKeyOf, isKnownTopic, createSequencer, envelopeFor, seal,
  TOPIC_ALIASES, canonicalTopic, SubscriptionError, identityResolver, normalizeChannel,
  parseSubscribe, matchChannels,
  RECOVERY_STATES, createRecovery
} from './index.mjs'

let pass = 0
let fail = 0
const section = (t) => console.log(`\n${t}`)
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok   ${name}`) }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`) }
}
function throws(name, fn, matcher) {
  try { fn(); check(name, false, 'expected a throw') }
  catch (e) {
    const ok = matcher ? matcher(e) : true
    check(name, ok, ok ? '' : `wrong error: ${e?.message || e}`)
  }
}
function finish() {
  console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} pass, ${fail} fail\n`)
  process.exit(fail === 0 ? 0 : 1)
}
process.on('uncaughtException', (e) => { fail++; console.log(`  FAIL (unexpected throw) — ${e?.message || e}`); finish() })
process.on('unhandledRejection', (e) => { fail++; console.log(`  FAIL (unexpected rejection) — ${(e && e.message) || e}`); finish() })

// --- fixtures ---------------------------------------------------------------
const candle = (over = {}) => candleEvent({
  source: 'binance', symbol: 'BTCUSDT', timeframe: '15m', state: 'closed',
  open: 100, high: 110, low: 90, close: 105, volume: 5,
  openTime: 1_000, closeTime: 2_000, eventTime: 2_000, ...over
}, 2_500)
const quote = (over = {}) => quoteEvent({
  source: 'binance', symbol: 'BTCUSDT', bid: 100, ask: 101, eventTime: 2_000, ...over
}, 2_500)

// =============================================================================
section('1. channel keys (§7 vocabulary ↔ §31 channels)')
// =============================================================================
check('channelKeyOf joins type|source|symbol|timeframe', channelKeyOf({ type: TOPICS.CANDLE, source: 'binance', symbol: 'BTCUSDT', timeframe: '15m' }) === `${TOPICS.CANDLE}|binance|BTCUSDT|15m`)
check('channelKeyOf omits an empty timeframe', channelKeyOf({ type: TOPICS.QUOTE, source: 'binance', symbol: 'BTCUSDT' }) === `${TOPICS.QUOTE}|binance|BTCUSDT|`)
throws('channelKeyOf requires a type', () => channelKeyOf({ source: 'x' }))
check('isKnownTopic accepts canonical topics', isKnownTopic(TOPICS.BOOK) && isKnownTopic(TOPICS.CANDLE))
check('isKnownTopic rejects a client alias', !isKnownTopic('orderbook'))

// =============================================================================
section('2. envelope + per-channel sequencer (§31.2)')
// =============================================================================
const seq = createSequencer()
check('sequencer starts at 1 per channel', seq.next('a') === 1 && seq.next('a') === 2 && seq.next('b') === 1)
check('peek reflects last handed out', seq.peek('a') === 2 && seq.peek('b') === 1)
check('reset restarts a channel at 1', (seq.reset('a'), seq.next('a') === 1))
check('stats counts channels + total', (() => { const s = seq.stats(); return s.channels === 2 && s.total === 2 })())

const ev = candle()
const env = envelopeFor(ev, { sequence: 7 })
check('envelope.type mirrors the event type', env.type === TOPICS.CANDLE)
check('envelope.sequence is the given value', env.sequence === 7)
check('envelope hoists eventTime/ingestTime/source (D16)', env.eventTime === ev.eventTime && env.ingestTime === ev.ingestTime && env.source === 'binance')
check('payload strips the hoisted fields', ENVELOPE_FIELDS.every((f) => !(f in env.payload)))
check('payload keeps the event-specific data', env.payload.close === 105 && env.payload.timeframe === '15m' && env.payload.state === 'closed')
check('payload does not alias the source event', env.payload !== ev && ev.type === TOPICS.CANDLE)

throws('envelopeFor requires a positive integer sequence', () => envelopeFor(ev, { sequence: 0 }))
throws('envelopeFor rejects a non-integer sequence', () => envelopeFor(ev, { sequence: 1.5 }))
throws('envelopeFor requires an event object', () => envelopeFor(null, { sequence: 1 }))
throws('envelopeFor requires eventTime', () => envelopeFor({ type: TOPICS.QUOTE, source: 'x', ingestTime: 1 }, { sequence: 1 }))
throws('envelopeFor requires source', () => envelopeFor({ type: TOPICS.QUOTE, eventTime: 1, ingestTime: 1 }, { sequence: 1 }))

const pub = createSequencer()
const e1 = seal(pub, candle())
const e2 = seal(pub, candle({ closeTime: 3_000, openTime: 2_000, eventTime: 3_000 }))
const q1 = seal(pub, quote())
check('seal sequences candle channel 1,2 and quote channel 1', e1.sequence === 1 && e2.sequence === 2 && q1.sequence === 1)
check('seal derives the channel from the event itself', e1.type === TOPICS.CANDLE && q1.type === TOPICS.QUOTE)
throws('seal requires a sequencer', () => seal(null, candle()))

// =============================================================================
section('3. subscribe protocol (§31.1)')
// =============================================================================
check('topic aliases map to canonical event types',
  TOPIC_ALIASES.candle === TOPICS.CANDLE && TOPIC_ALIASES.quote === TOPICS.QUOTE &&
  TOPIC_ALIASES.orderbook === TOPICS.BOOK && TOPIC_ALIASES.trade === TOPICS.TRADE)
check('canonicalTopic accepts canonical names too', canonicalTopic(TOPICS.BOOK) === TOPICS.BOOK)
throws('canonicalTopic rejects an unknown topic', () => canonicalTopic('nope'), (e) => e instanceof SubscriptionError && e.code === 'unknown_topic')

const roadmapMsg = {
  type: 'subscribe',
  requestId: 'r1',
  channels: [
    { topic: 'candle', instrumentId: 'crypto:perp:BTC/USDT', venue: 'binance', timeframe: '15m' },
    { topic: 'quote', instrumentId: 'crypto:perp:BTC/USDT', venue: 'binance' },
    { topic: 'orderbook', instrumentId: 'crypto:perp:BTC/USDT', venue: 'binance' }
  ]
}
const parsed = parseSubscribe(roadmapMsg)
check('parseSubscribe returns requestId + 3 channels', parsed.requestId === 'r1' && parsed.channels.length === 3)
check('candle channel keeps its timeframe', parsed.channels[0].eventType === TOPICS.CANDLE && parsed.channels[0].timeframe === '15m')
check('quote channel has a null timeframe', parsed.channels[1].eventType === TOPICS.QUOTE && parsed.channels[1].timeframe === null)
check('identity resolver keeps instrumentId as symbol', parsed.channels[0].symbol === 'crypto:perp:BTC/USDT' && parsed.channels[0].source === 'binance')
check('each channel carries a stable key', parsed.channels.every((c) => typeof c.key === 'string' && c.key.includes('|')))

const realResolver = (instrumentId, venue) => ({ symbol: instrumentId.split(':').pop().replace('/', ''), source: venue })
check('a custom resolver translates instrumentId -> symbol',
  parseSubscribe(roadmapMsg, { resolve: realResolver }).channels[0].symbol === 'BTCUSDT')

throws('non-object message rejected', () => parseSubscribe('nope'))
throws('wrong type rejected', () => parseSubscribe({ type: 'ping', requestId: 'r', channels: [] }), (e) => e.code === 'bad_type')
throws('missing requestId rejected', () => parseSubscribe({ type: 'subscribe', channels: [] }))
throws('non-array channels rejected', () => parseSubscribe({ type: 'subscribe', requestId: 'r', channels: 'x' }))
throws('candle without a timeframe rejected', () => parseSubscribe({ type: 'subscribe', requestId: 'r', channels: [{ topic: 'candle', instrumentId: 'x', venue: 'binance' }] }))
throws('missing instrumentId rejected', () => parseSubscribe({ type: 'subscribe', requestId: 'r', channels: [{ topic: 'quote', venue: 'binance' }] }))
throws('missing venue rejected', () => parseSubscribe({ type: 'subscribe', requestId: 'r', channels: [{ topic: 'quote', instrumentId: 'x' }] }))
throws('empty channel list rejected when allowEmpty is false', () => parseSubscribe({ type: 'subscribe', requestId: 'r', channels: [] }, { allowEmpty: false }), (e) => e.code === 'no_channels')
throws('duplicate channel rejected', () => parseSubscribe({ type: 'subscribe', requestId: 'r', channels: [
  { topic: 'quote', instrumentId: 'x', venue: 'binance' },
  { topic: 'quote', instrumentId: 'x', venue: 'binance' }
] }), (e) => e.code === 'duplicate_channel')

const channels = parseSubscribe(roadmapMsg, { resolve: realResolver }).channels
check('matchChannels delivers a candle to only the candle channel',
  matchChannels(candle(), channels).length === 1 && matchChannels(candle(), channels)[0].eventType === TOPICS.CANDLE)
check('matchChannels respects the timeframe',
  matchChannels(candle({ timeframe: '1m' }), channels).length === 0)
check('matchChannels routes quote to the quote channel only',
  matchChannels(quote(), channels).length === 1 && matchChannels(quote(), channels)[0].eventType === TOPICS.QUOTE)
check('matchChannels never delivers an unsubscribed instrument',
  matchChannels(candle({ symbol: 'ETHUSDT' }), channels).length === 0)
check('matchChannels on no channels is empty', matchChannels(candle(), []).length === 0)

// =============================================================================
section('4. client recovery state machine (§31.3)')
// =============================================================================
check('RECOVERY_STATES lists the documented states',
  RECOVERY_STATES.includes('idle') && RECOVERY_STATES.includes('live') && RECOVERY_STATES.includes('paused') &&
  RECOVERY_STATES.includes('snapshot_requested') && RECOVERY_STATES.includes('reconciling'))

{
  const seen = []
  const gapEvents = []
  const rec = createRecovery({ onGap: (g) => gapEvents.push(g), onStateChange: (s, n, p) => seen.push(`${s}:${p}->${n}`) })
  const st = 'market.candle|binance|BTCUSDT|15m'

  check('first envelope is accepted and goes live', (() => { const r = rec.accept(st, { sequence: 1 }); return r.action === 'first' && rec.state(st) === 'live' })())
  check('contiguous envelope is ok', rec.accept(st, { sequence: 2 }).action === 'ok' && rec.lastSeq(st) === 2)
  check('duplicate is detected and does not advance', rec.accept(st, { sequence: 2 }).action === 'duplicate' && rec.lastSeq(st) === 2)
  check('out-of-order (stale) is detected', rec.accept(st, { sequence: 1 }).action === 'stale')

  const g = rec.accept(st, { sequence: 5 }) // expected 3
  check('a gap pauses rendering', g.action === 'gap' && g.expected === 3 && g.received === 5 && g.missing === 2)
  check('a gap fires onGap once', gapEvents.length === 1 && gapEvents[0].missing === 2)
  check('state is paused after a gap', rec.state(st) === 'paused')
  check('further envelopes are dropped while paused (never silently continue)', rec.accept(st, { sequence: 6 }).action === 'paused')
  check('onStateChange recorded the transitions', seen.includes(`${st}:idle->live`) && seen.includes(`${st}:live->paused`))

  check('requestSnapshot only works from paused', rec.requestSnapshot(st).action === 'request_snapshot' && rec.state(st) === 'snapshot_requested')
  check('requestSnapshot is a noop once requested', rec.requestSnapshot(st).action === 'noop')

  check('reconcile adopts the snapshot sequence', rec.reconcile(st, 40).action === 'reconciled' && rec.lastSeq(st) === 40 && rec.state(st) === 'reconciling')
  check('resume returns to live', rec.resume(st).action === 'resume' && rec.state(st) === 'live')
  check('the stream continues strictly after the snapshot', rec.accept(st, { sequence: 41 }).action === 'ok')
  check('stats reports one stream and one gap', rec.stats().streams === 1 && rec.stats().gaps === 1)

  // Streams are independent — a gap on one must not pause another.
  check('a second stream starts fresh and stays live', rec.accept('other', { sequence: 1 }).action === 'first' && rec.state('other') === 'live')

  throws('accept requires an integer sequence', () => rec.accept(st, { sequence: 0 }))
  throws('accept requires a stream', () => rec.accept('', { sequence: 1 }))
  throws('reconcile requires a non-negative snapshot', () => rec.reconcile(st, -1))

  rec.reset(st)
  check('reset forgets a single stream', rec.state(st) === 'idle' && rec.lastSeq(st) === 0)
}

// =============================================================================
section('5. end-to-end — subscribe -> seal -> match -> recover (one drop)')
// =============================================================================
{
  const subs = parseSubscribe({
    type: 'subscribe', requestId: 'chart-1',
    channels: [{ topic: 'candle', instrumentId: 'crypto:perp:BTC/USDT', venue: 'binance', timeframe: '15m' }]
  }, { resolve: realResolver }).channels

  const pub = createSequencer()
  const delivered = []
  for (let i = 0; i < 5; i++) {
    const event = candle({ openTime: i * 1_000, closeTime: (i + 1) * 1_000, eventTime: (i + 1) * 1_000 })
    const env = seal(pub, event)
    for (const c of matchChannels(event, subs)) delivered.push({ key: c.key, env })
  }
  check('every sealed event matched its channel', delivered.length === 5 && delivered.every((d) => d.key === delivered[0].key))
  check('sequences ascend 1..5 on the single channel', delivered.map((d) => d.env.sequence).join(',') === '1,2,3,4,5')

  // Simulate a transport drop of sequence 3.
  const client = createRecovery()
  const st = delivered[0].key
  const actions = []
  for (const d of delivered) {
    if (d.env.sequence === 3) continue
    actions.push(client.accept(st, d.env).action)
  }
  check('client renders 1,2, detects the gap at 4 and drops the rest', actions.join(',') === 'first,ok,gap,paused')
  check('client is paused after the drop', client.state(st) === 'paused')

  // Recover: snapshot at the server's latest, then resume and continue.
  client.requestSnapshot(st)
  client.reconcile(st, 3) // server snapshot already includes 3
  client.resume(st)
  const resume = client.accept(st, { sequence: 4 })
  check('after recovery the client resumes cleanly at 4', resume.action === 'ok' && client.state(st) === 'live')
  check('the recovery recorded exactly one gap', client.stats().gaps === 1 && client.gaps()[0].missing === 1)
}

finish()
