// =============================================================================
//  TM TRADING — provider adapter contract (D15: `market/` = transport +
//  provider + aggregation; Phase 7R "provider adapter contract").
//
//  A provider turns an exchange's transport + payloads into canonical events
//  (§7). Consumers assert the contract, never touch raw payloads.
//
//  Contract — a provider object MUST expose:
//    id              string            stable provider name (e.g. 'binance')
//    markets         string[]          market kinds it can serve
//    streams()       () => string[]    stream keys currently configured
//    connect(hooks)  ({onEvent, onStatus}) => void   starts (or restarts) the feed
//    close()         () => void        stops the feed AND any reconnect timer
//    status()        () => {state:'idle'|'connecting'|'connected'|'disconnected', attempt:number, url?:string}
//
//  Hooks contract:
//    onEvent(event, topic)  canonical events only (event.type === topic)
//    onStatus(status)       connection lifecycle (topic TOPICS.STATUS)
// =============================================================================

/**
 * Fail-fast structural check — throws with a precise message listing what is
 * missing so a broken adapter never reaches a consumer.
 */
export function assertProvider(provider) {
  if (!provider || typeof provider !== 'object') throw new Error('provider contract: provider must be an object')
  const missing = []
  if (typeof provider.id !== 'string' || provider.id.length === 0) missing.push('id')
  if (!Array.isArray(provider.markets) || provider.markets.length === 0) missing.push('markets')
  if (typeof provider.streams !== 'function') missing.push('streams()')
  if (typeof provider.connect !== 'function') missing.push('connect(hooks)')
  if (typeof provider.close !== 'function') missing.push('close()')
  if (typeof provider.status !== 'function') missing.push('status()')
  if (missing.length) throw new Error(`provider contract: missing ${missing.join(', ')}`)
  const streams = provider.streams()
  if (!Array.isArray(streams)) throw new Error('provider contract: streams() must return an array')
  return provider
}

/** Validate a hook pair before connect (both must be functions). */
export function assertHooks(hooks) {
  if (!hooks || typeof hooks !== 'object') throw new Error('provider contract: hooks object required')
  if (typeof hooks.onEvent !== 'function') throw new Error('provider contract: hooks.onEvent must be a function')
  if (typeof hooks.onStatus !== 'function') throw new Error('provider contract: hooks.onStatus must be a function')
  return hooks
}
