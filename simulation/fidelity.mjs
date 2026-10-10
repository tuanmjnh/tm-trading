// simulation/fidelity.mjs
// Execution / Market Simulation Fidelity Levels (roadmap §34).
//
// Levels (§34):
//   F0 = candle-only simulation (OHLCV backtest without quotes)
//   F1 = quote-aware spread/slippage (simulation/fill.mjs bid/ask or mid+spread)
//   F2 = trade-stream + quote-aware (fill model + live trade tape)
//   F3 = depth-aware orderbook simulation (market/depthSync.mjs L2 book)
//   F4 = broker-specific demo reconciliation (MT5 / exchange demo sync)
//
// A result should NEVER be interpreted as more precise than its fidelity level
// (D12). This pure module derives the label from the active environment / options
// and formats the terminal banner string (§34): e.g. "PAPER · F1 · BINANCE FUTURES".

export const FIDELITY_LEVELS = Object.freeze({
  F0: { code: 'F0', name: 'Candle-only', description: 'OHLCV simulation without live quotes' },
  F1: { code: 'F1', name: 'Quote-aware', description: 'Modelled spread/slippage against bid/ask or mid' },
  F2: { code: 'F2', name: 'Trade-stream aware', description: 'Fill model with live trade tape events' },
  F3: { code: 'F3', name: 'Depth-aware', description: 'Orderbook L2 depth simulation' },
  F4: { code: 'F4', name: 'Broker demo', description: 'Broker/exchange demo account reconciliation' },
})

export const FIDELITY_CODES = Object.freeze(Object.keys(FIDELITY_LEVELS))

/**
 * Determine the active fidelity level from execution context flags.
 * Defaults: paper executor is F1 today (`simulation/fill.mjs` quote-aware);
 * backtests without quotes are F0; depth Sync active = F3; broker sync = F4.
 */
export function resolveFidelity({
  mode = 'paper', // 'paper' | 'backtest' | 'mt5' | 'exchange' | 'replay'
  depthActive = false,
  tradeStreamActive = false,
  quoteAware = true,
  brokerSync = false,
} = {}) {
  if (brokerSync || mode === 'mt5' || mode === 'exchange') return 'F4'
  if (depthActive) return 'F3'
  if (tradeStreamActive) return 'F2'
  if (quoteAware && mode !== 'backtest') return 'F1'
  return 'F0'
}

/**
 * Format the §34 terminal string: e.g. "PAPER · F1 · BINANCE FUTURES".
 * Venue falls back to market-specific default when not explicitly provided.
 */
export function formatFidelityBanner({
  mode = 'PAPER',
  fidelity = 'F1',
  venue, // undefined = derive from market
  market = 'fapi',
} = {}) {
  const code = FIDELITY_CODES.includes(fidelity) ? fidelity : 'F1'
  const m = String(mode).toUpperCase()
  const v = venue
    ? String(venue).toUpperCase()
    : (market === 'spot' ? 'BINANCE SPOT' : 'BINANCE FUTURES')
  return `${m} · ${code} · ${v}`
}

/** Attach fidelity info to a position/fill/decision doc. */
export function fidelityRecord(opts = {}) {
  const code = resolveFidelity(opts)
  return {
    code,
    ...FIDELITY_LEVELS[code],
    banner: formatFidelityBanner({ ...opts, fidelity: code }),
  }
}
