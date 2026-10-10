// =============================================================================
//  TM TRADING — in-process event bus (Phase 7R: "Redis/event bus nếu cần" —
//  in-process first, swap the implementation behind this contract later).
//
//  Fan-out by topic (TOPICS.*). A throwing handler is isolated: it is
//  reported through onError and NEVER breaks the emit loop or other
//  subscribers (a broken chart must not kill the candle builder).
// =============================================================================

/**
 * @param {object} [opts]
 * @param {(err: Error, topic: string, event: object) => void} [opts.onError]
 */
export function createEventBus({ onError } = {}) {
  /** @type {Map<string, Set<Function>>} */
  const subs = new Map()
  let delivered = 0
  let handlerErrors = 0

  const on = (topic, handler) => {
    if (!topic) throw new Error('bus: topic required')
    if (typeof handler !== 'function') throw new Error('bus: handler must be a function')
    let set = subs.get(topic)
    if (!set) { set = new Set(); subs.set(topic, set) }
    set.add(handler)
    return () => { set.delete(handler) }
  }

  return {
    on,
    once(topic, handler) {
      const off = on(topic, (ev) => { off(); handler(ev) })
      return off
    },
    emit(topic, event) {
      const set = subs.get(topic)
      if (!set || set.size === 0) return 0
      let n = 0
      for (const fn of [...set]) {
        try { fn(event); delivered++; n++ }
        catch (err) {
          handlerErrors++
          try { onError?.(err instanceof Error ? err : new Error(String(err)), topic, event) } catch { /* onError must not break emit */ }
        }
      }
      return n
    },
    subscriberCount: (topic) => subs.get(topic)?.size ?? 0,
    clear: () => subs.clear(),
    stats: () => ({ topics: subs.size, delivered, handlerErrors })
  }
}
