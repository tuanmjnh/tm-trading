// =============================================================================
//  TM TRADING — realtime subscribe protocol (roadmap V3 §31.1).
//
//  Validates and NORMALIZES a client `subscribe` message into channels the
//  publish side can match against canonical market events. The client speaks
//  `instrumentId`/`venue`; events speak `symbol`/`source`. Resolution between
//  the two is an injected seam (`resolve`) so this module stays pure: the
//  default is identity (usable standalone / in tests), the transport injects
//  the real instrument registry resolver.
//
//  Dependency-free: no WebSocket, no IO.
// =============================================================================

import { TOPICS } from '../market/events.mjs'
import { channelKeyOf } from './envelope.mjs'

/** Client topic vocabulary (§31.1) -> canonical event type (§7). */
export const TOPIC_ALIASES = Object.freeze({
  candle: TOPICS.CANDLE,
  quote: TOPICS.QUOTE,
  orderbook: TOPICS.BOOK,
  trade: TOPICS.TRADE,
  status: TOPICS.STATUS
})

const KNOWN_TYPES = new Set(Object.values(TOPICS))

/** A subscription/format problem — transports map `code` to an error frame. */
export class SubscriptionError extends Error {
  constructor(message, code = 'invalid_channel') {
    super(`subscribe: ${message}`)
    this.name = 'SubscriptionError'
    this.code = code
  }
}

/** Map a client topic (alias or canonical) to a canonical event type. */
export function canonicalTopic(topic) {
  const t = String(topic || '').trim()
  if (KNOWN_TYPES.has(t)) return t
  if (TOPIC_ALIASES[t]) return TOPIC_ALIASES[t]
  throw new SubscriptionError(`unknown topic: ${t || '(empty)'}`, 'unknown_topic')
}

/** Default resolver: the instrument id IS the event symbol, the venue IS the source. */
export const identityResolver = (instrumentId, venue) => ({ symbol: instrumentId, source: venue })

/**
 * Normalize one channel. Candle channels require a timeframe; other channels
 * carry `timeframe: null` so their key is stable regardless of client noise.
 * @param {object} raw
 * @param {{resolve?:(instrumentId:string, venue:string)=>{symbol:string,source:string}}} [opts]
 */
export function normalizeChannel(raw, { resolve = identityResolver } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new SubscriptionError('channel must be an object')
  const eventType = canonicalTopic(raw.topic)

  const instrumentId = String(raw.instrumentId || '').trim()
  if (!instrumentId) throw new SubscriptionError('instrumentId required')
  const venue = String(raw.venue || '').trim()
  if (!venue) throw new SubscriptionError('venue required')

  const isCandle = eventType === TOPICS.CANDLE
  const timeframe = isCandle ? String(raw.timeframe || '').trim() : ''
  if (isCandle && !timeframe) throw new SubscriptionError('timeframe required for candle')

  const resolved = resolve(instrumentId, venue) || {}
  const symbol = String(resolved.symbol || '')
  const source = String(resolved.source || '')
  if (!symbol || !source) throw new SubscriptionError('resolver must return { symbol, source }', 'unresolvable_instrument')

  const channel = {
    topic: String(raw.topic),
    eventType,
    instrumentId,
    venue,
    timeframe: isCandle ? timeframe : null,
    symbol,
    source
  }
  channel.key = channelKeyOf({ type: eventType, source, symbol, timeframe: channel.timeframe })
  return channel
}

/**
 * Parse a full §31.1 subscribe message.
 * @param {object} msg
 * @param {{resolve?:Function, allowEmpty?:boolean}} [opts]
 * @returns {{requestId:string, channels:object[]}}
 */
export function parseSubscribe(msg, { resolve = identityResolver, allowEmpty = true } = {}) {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) throw new SubscriptionError('message must be an object')
  if (msg.type !== 'subscribe') throw new SubscriptionError(`expected type 'subscribe' (got ${msg.type})`, 'bad_type')

  const requestId = String(msg.requestId ?? '').trim()
  if (!requestId) throw new SubscriptionError('requestId required')

  if (!Array.isArray(msg.channels)) throw new SubscriptionError('channels must be an array')
  if (!allowEmpty && msg.channels.length === 0) throw new SubscriptionError('at least one channel required', 'no_channels')

  const channels = msg.channels.map((c) => normalizeChannel(c, { resolve }))
  const seen = new Set()
  for (const c of channels) {
    if (seen.has(c.key)) throw new SubscriptionError(`duplicate channel: ${c.key}`, 'duplicate_channel')
    seen.add(c.key)
  }
  return { requestId, channels }
}

/**
 * Which of `channels` does this canonical event belong to? Matching is exact on
 * the derived key (type + source + symbol + timeframe), so it can never deliver
 * a stream the client did not ask for.
 * @param {object} event canonical market event
 * @param {object[]} channels normalized channels
 */
export function matchChannels(event, channels) {
  if (!event || !Array.isArray(channels) || channels.length === 0) return []
  let key
  try { key = channelKeyOf(event) } catch { return [] }
  return channels.filter((c) => c.key === key)
}

/** The channel key an event would publish on (publish-side symmetry check). */
export { channelKeyOf }
