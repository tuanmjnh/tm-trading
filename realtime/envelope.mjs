// =============================================================================
//  TM TRADING — realtime envelope + per-channel sequencer (roadmap V3 §31.2).
//
//  A realtime envelope hoists the D16 metadata (`eventTime`, `ingestTime`,
//  `source`) to the top level and adds a per-channel monotonic `sequence` so a
//  client can detect a gap. `payload` is the canonical market event body with
//  that hoisted metadata removed — the event still owns those values (§7), the
//  envelope only carries them forward. Nothing is invented here (D1).
//
//  Pure + dependency-free: no WebSocket, no clock, no IO (D15). The transport
//  (owned by a later slice) subscribes to the in-process bus and seals events.
// =============================================================================

import { TOPICS } from '../market/events.mjs'

/** Fields the envelope hoists (and therefore strips from `payload`). */
export const ENVELOPE_FIELDS = Object.freeze(['type', 'sequence', 'eventTime', 'ingestTime', 'source'])

const finite = (v) => Number.isFinite(Number(v))

/**
 * Stable channel identity: `type|source|symbol|timeframe`. Both the subscribe
 * layer and the publish layer derive the SAME key, so a client's sequence
 * checkpoint always refers to the stream it subscribed to.
 * @param {{type?:string, source?:string, symbol?:string, timeframe?:string|null}} [parts]
 */
export function channelKeyOf({ type, source, symbol, timeframe } = {}) {
  const t = String(type || '')
  if (!t) throw new Error('channelKey: type required')
  return [t, String(source || ''), String(symbol || ''), timeframe ? String(timeframe) : ''].join('|')
}

/** Is this a known canonical topic (§7)? Used to reject unknown event types. */
export const isKnownTopic = (t) => Object.values(TOPICS).includes(String(t))

/**
 * Per-channel monotonic sequence numbers. Counting starts at 1 for every
 * channel so a client can detect a gap from the very first event.
 */
export function createSequencer() {
  /** @type {Map<string, number>} */
  const counters = new Map()
  const norm = (k) => {
    const s = String(k ?? '').trim()
    if (!s) throw new Error('sequencer: channel key required')
    return s
  }
  return {
    /** Next sequence for a channel (1, 2, 3, ...). */
    next(channelKey) {
      const k = norm(channelKey)
      const n = (counters.get(k) ?? 0) + 1
      counters.set(k, n)
      return n
    },
    /** Last sequence handed out for a channel (0 if none). */
    peek(channelKey) { return counters.get(norm(channelKey)) ?? 0 },
    /** Forget a channel's counter (a fresh stream restarts at 1). */
    reset(channelKey) { counters.delete(norm(channelKey)) },
    clear() { counters.clear() },
    stats() { return { channels: counters.size, total: [...counters.values()].reduce((a, b) => a + b, 0) } }
  }
}

/**
 * Build a `RealtimeEnvelope<T>` (§31.2) for one canonical market event.
 *
 * @param {object} event canonical event from `market/events.mjs`
 * @param {{sequence:number}} opts `sequence` from `createSequencer().next(key)`
 * @returns {{type:string, sequence:number, eventTime:number, ingestTime:number, source:string, payload:object}}
 */
export function envelopeFor(event, { sequence } = {}) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) throw new Error('envelope: event must be an object')
  const type = String(event.type || '')
  if (!type) throw new Error('envelope: event.type required')
  if (!Number.isInteger(sequence) || sequence < 1) throw new Error(`envelope: sequence must be an integer >= 1 (got ${sequence})`)
  const eventTime = Number(event.eventTime)
  const ingestTime = Number(event.ingestTime)
  const source = String(event.source || '')
  if (!finite(eventTime)) throw new Error('envelope: eventTime required (D16)')
  if (!finite(ingestTime)) throw new Error('envelope: ingestTime required (D16)')
  if (!source) throw new Error('envelope: source required (D16)')

  const payload = { ...event }
  for (const f of ENVELOPE_FIELDS) delete payload[f]
  return { type, sequence, eventTime, ingestTime, source, payload }
}

/**
 * Publish helper: sequence the event on its own channel and wrap it. Used by
 * the transport when an event arrives from the bus.
 */
export function seal(sequencer, event) {
  if (!sequencer || typeof sequencer.next !== 'function') throw new Error('envelope: sequencer required')
  const sequence = sequencer.next(channelKeyOf(event))
  return envelopeFor(event, { sequence })
}
