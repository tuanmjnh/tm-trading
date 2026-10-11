// =============================================================================
//  TM TRADING — realtime client recovery state machine (roadmap V3 §31.3).
//
//  "On sequence gap: pause rendering, request state snapshot, reconcile,
//  resume. Never silently continue with an unknown gap."
//
//  This is the CLIENT-side policy object: feed it envelopes per stream and it
//  tells the renderer what to do. It is pure bookkeeping — no timers, no IO,
//  no WebSocket — so it is exhaustively testable and the transport just wires
//  its callbacks (`onGap`, `onStateChange`) to real messages.
// =============================================================================

export const RECOVERY_STATES = Object.freeze(['idle', 'live', 'paused', 'snapshot_requested', 'reconciling'])

const isPaused = (s) => s === 'paused' || s === 'snapshot_requested' || s === 'reconciling'

/**
 * @param {object} [opts]
 * @param {(gap:{stream:string,expected:number,received:number,missing:number}) => void} [opts.onGap]
 * @param {(stream:string,next:string,prev:string) => void} [opts.onStateChange]
 */
export function createRecovery({ onGap, onStateChange } = {}) {
  /** @type {Map<string, string>} */
  const states = new Map()
  /** @type {Map<string, number>} */
  const last = new Map()
  /** @type {Array<{stream:string,expected:number,received:number,missing:number}>} */
  const gaps = []

  const streamOf = (s) => {
    const k = String(s ?? '').trim()
    if (!k) throw new Error('recovery: stream required')
    return k
  }

  const setState = (stream, next) => {
    const prev = states.get(stream) ?? 'idle'
    if (prev === next) return
    states.set(stream, next)
    try { onStateChange?.(stream, next, prev) } catch { /* observers must not break the machine */ }
  }

  return {
    state: (stream) => states.get(streamOf(stream)) ?? 'idle',
    lastSeq: (stream) => last.get(streamOf(stream)) ?? 0,
    gaps: () => gaps.slice(),

    /**
     * Feed one envelope for a stream.
     * @returns {{action:string} & Record<string, unknown>}
     */
    accept(stream, envelope) {
      const s = streamOf(stream)
      const seq = Number(envelope?.sequence)
      if (!Number.isInteger(seq) || seq < 1) throw new Error('recovery: envelope.sequence must be an integer >= 1')

      const cur = states.get(s) ?? 'idle'
      const prevLast = last.get(s) ?? 0

      // Rendering is paused: never silently continue with an unknown gap.
      if (isPaused(cur)) return { action: 'paused', expected: prevLast + 1, received: seq }

      if (prevLast === 0) {
        last.set(s, seq)
        setState(s, 'live')
        return { action: 'first', sequence: seq }
      }
      if (seq === prevLast) return { action: 'duplicate', sequence: seq }
      if (seq < prevLast) return { action: 'stale', sequence: seq, last: prevLast }

      const expected = prevLast + 1
      if (seq !== expected) {
        const gap = { stream: s, expected, received: seq, missing: seq - expected }
        gaps.push(gap)
        setState(s, 'paused')
        try { onGap?.(gap) } catch { /* onGap must not break the machine */ }
        return { action: 'gap', ...gap }
      }

      last.set(s, seq)
      setState(s, 'live')
      return { action: 'ok', sequence: seq }
    },

    /** Step 2 of §31.3 — ask for a state snapshot (only meaningful once paused). */
    requestSnapshot(stream) {
      const s = streamOf(stream)
      const cur = states.get(s) ?? 'idle'
      if (cur !== 'paused') return { action: 'noop', state: cur }
      setState(s, 'snapshot_requested')
      return { action: 'request_snapshot', stream: s }
    },

    /** Step 3 of §31.3 — reconcile against a snapshot's sequence. */
    reconcile(stream, snapshotSeq) {
      const s = streamOf(stream)
      const n = Number(snapshotSeq)
      if (!Number.isInteger(n) || n < 0) throw new Error('recovery: snapshotSeq must be an integer >= 0')
      last.set(s, n)
      setState(s, 'reconciling')
      return { action: 'reconciled', sequence: n }
    },

    /** Step 4 of §31.3 — resume rendering after reconcile. */
    resume(stream) {
      const s = streamOf(stream)
      if (isPaused(states.get(s) ?? 'idle')) setState(s, 'live')
      return { action: 'resume', state: states.get(s) ?? 'idle' }
    },

    /** Drop all tracking for one stream, or every stream when called empty. */
    reset(stream) {
      if (stream === undefined) { states.clear(); last.clear(); gaps.length = 0; return }
      const s = streamOf(stream)
      states.delete(s)
      last.delete(s)
    },

    stats() {
      const byState = {}
      for (const st of RECOVERY_STATES) byState[st] = 0
      for (const st of states.values()) byState[st] = (byState[st] ?? 0) + 1
      return { streams: states.size, gaps: gaps.length, byState }
    }
  }
}
