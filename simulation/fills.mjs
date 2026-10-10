// =============================================================================
//  TM TRADING — PAPER FILL LEDGER (roadmap v3 §18.5/§18.6/§26.5), PURE core.
//
//  Shapes ONE executed fill into the `paper_fills` document. No IO, no clock:
//  every time (signalTime, decisionTime, eventTime) is passed in, flawing
//  simulation/test.mjs golden closes. The EXECUTOR owns invocation (exec/paper
//  .mjs) and only ever records an execution that actually transitioned state —
//  a fill doc is a factual ledger row (D12), never a projection.
//
//  §18.6 latency fields: signalTime (when the alert fired), decisionTime (when
//  the fill model decided), eventTime (model reference clock); latencyMs rides
//  the quote-AGE the fill model measured (adverse-slip driver). A simulated
//  processing latency (simLatencyMs) is added on top, defaulting to 0 so the
//  ledger never fabricates delay the terminal did not configure (D12).
// =============================================================================

export const FILL_MODEL_VERSION = 'paper_fill.v1'

const round8 = (n) => Math.round(n * 1e8) / 1e8

/**
 * Build ONE paper-fill doc for the ledger.
 *
 * @param {object} i  {
 *   fillId: string,          // caller-assigned unique id (must be stable/uniqu
 *                            //   index-safe; the executor folds the attempt)
 *   orderId: string,         // the order's clientOrderId (D3 order anchor)
 *   alertKey: string|null,
 *   accountId?: string,
 *   symbol: string, side: 'BUY'|'SELL', type: 'market'|'limit'|'stop',
 *   qty: number,             // order intent qty (audit context)
 *   fillPrice: number,       // measured fill price (never the signal price)
 *   fillQty: number,         // what actually filled
 *   feeRateBps: number|null, // fee rate used (role-based, §18.5)
 *   feeAmount: number|null,  // = notional * feeRate / 1e4 (measured)
 *   spreadAbs: number|null,  // |ask - bid| at fill, when the quote had both
 *   slippageBps: number|null,
 *   latencyMs: number|null,  // quote age the fill model measured
 *   simLatencyMs?: number,   // configured simulated processing latency (>=0)
 *   signalTime: number|null, // alert fired time (epoch ms)
 *   decisionTime: number|string, // when the fill was decided
 *   eventTime: number|string,    // model reference clock (attemptFill now)
 *   simulateOnly?: boolean,  // 'replay' else live paper
 *   modelVersion?: string,   // simulationVersion stamp (D1)
 * }
 * @returns {{fillId:string, orderId:string, …}} flat ledger doc (all numbers
 *          finite-safe, nulls where absent — never fabricated).
 */
export function buildFillRecord(i) {
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  const numAbs = (v) => {
    const n = num(v)
    return n != null && n >= 0 ? n : null
  }
  const simLatencyMs = numAbs(i.simLatencyMs) ?? 0
  const latencyMs = numAbs(i.latencyMs) ?? 0
  return {
    fillId: String(i.fillId ?? `fill_${Math.random().toString(36).slice(2, 10)}`),
    orderId: String(i.orderId ?? ''),
    alertKey: i.alertKey == null ? null : String(i.alertKey),
    accountId: String(i.accountId ?? 'default'),
    source: String(i.source ?? 'paper'),
    symbol: String(i.symbol ?? ''),
    side: i.side === 'SELL' ? 'SELL' : 'BUY',
    type: ['market', 'limit', 'stop'].includes(i.type) ? i.type : 'market',
    qty: num(i.qty),
    fillPrice: num(i.fillPrice),
    fillQty: numAbs(i.fillQty) ?? 0,
    feeRateBps: numAbs(i.feeRateBps),
    feeAmount: numAbs(i.feeAmount),
    spreadAbs: numAbs(i.spreadAbs),
    slippageBps: numAbs(i.slippageBps),
    latencyMs: latencyMs + simLatencyMs,
    simLatencyMs: simLatencyMs,
    signalTime: num(i.signalTime),
    decisionTime: num(i.decisionTime),
    eventTime: num(i.eventTime),
    simulateOnly: i.simulateOnly === true,
    modelVersion: String(i.modelVersion ?? FILL_MODEL_VERSION),
    // §34: fidelity tier (F0..F4) that produced this fill.
    fidelity: i.fidelity == null ? null : String(i.fidelity),
  }
}