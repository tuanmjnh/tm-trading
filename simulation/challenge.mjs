// =============================================================================
//  TM TRADING — REPLAY CHALLENGE SCORING (roadmap v3 §22.5), PURE core.
//
//  Challenge mode is an OPTIONAL training/review feature on the replay page:
//    - signal overlays are hidden (the UI simply shows no method setups),
//    - future bars stay hidden (D17 — enforced by the replay cursor),
//    - the user chooses LONG / SHORT / WAIT at each decision point,
//    - replay continues and the system SCORES the decision.
//
//  This module owns ONLY the scoring + level derivation. It is pure (no IO, no
//  clock): decisions and the replayed position book are passed in. One decision
//  maps to the FIRST position opened at-or-after its timestamp (entryTime >= ts),
//  so a WAIT that preceded a broker-chosen signal never credits the user, and a
//  decision whose order was rejected (no position) is counted 'rejected' — never
//  silently ignored.
//
//  DISCLAIMER (per roadmap): this is a simulation / review feature, not
//  financial advice.
//
//  Tests: tests/challenge.test.ts (golden) + simulation/test.mjs §21 (pure).
// =============================================================================

export const CHALLENGE_MODEL_VERSION = 'replay_challenge.v1'

/** User's call at one decision point. side: 'LONG' | 'SHORT' | 'WAIT'. */
export const CHALLENGE_SIDES = Object.freeze(['LONG', 'SHORT', 'WAIT'])

const _fin = (v) => typeof v === 'number' && Number.isFinite(v)

/**
 * Protective levels for the challenge ticket, derived from the CURRENT played
 * bar only (never the future): side LONG stops below, targets above; SHORT is
 * mirrored. Percentages are explicit user inputs bounding the derivations —
 * nothing here is invented (D12).
 *
 * @returns {{ok:true, sl:number, tp:number} | {ok:false, code:string}}
 */
export function challengeLevels(side, price, { slPct = 2, tpPct = 4 } = {}) {
  const p = Number(price)
  if (!_fin(p) || p <= 0) return { ok: false, code: 'NO_PRICE' }
  const sl = Number(slPct)
  const tp = Number(tpPct)
  if (!_fin(sl) || sl <= 0 || sl >= 100) return { ok: false, code: 'BAD_SL_PCT' }
  if (!_fin(tp) || tp <= 0 || tp >= 100) return { ok: false, code: 'BAD_TP_PCT' }
  if (tp <= sl) return { ok: false, code: 'BAD_RR' } // below 1R never passes the gate
  if (side === 'SHORT') return { ok: true, sl: +(p * (1 + sl / 100)).toFixed(8), tp: +(p * (1 - tp / 100)).toFixed(8) }
  return { ok: true, sl: +(p * (1 - sl / 100)).toFixed(8), tp: +(p * (1 + tp / 100)).toFixed(8) }
}

/**
 * Score one decision against the replayed position book.
 *
 * @param {object}  d         { ts, side } — ts = decision clock ms (the played
 *                            bar's eventTime), side in CHALLENGE_SIDES.
 * @param {Array}   positions replayed positions (open + closed), entryTime ms.
 * @returns {{decision, outcome:'pending'|'win'|'loss'|'no_trade'|'rejected', pnlAbs?:number}}
 *
 * Outcome rules (exact, no guessing):
 *   - LONG/SHORT: the FIRST position with entryTime >= ts (the broker may need
 *     a later bar to fill a limit, and a rejected order creates no position).
 *     matched & closed -> 'win'/'loss' by pnlAbs; open -> 'pending'; no match
 *     -> 'no_trade' (gate rejected, or the book hasn't filled it yet).
 *   - WAIT: 'pending' while the session lives; the aggregate counts a WAIT as a
 *     correct call only when it did NOT match any position (no_trade).
 */
export function scoreDecision(d, positions) {
  const ts = Number(d?.ts)
  const side = String(d?.side || '').toUpperCase()
  if (!_fin(ts)) return { decision: d, outcome: 'no_trade' }
  if (side === 'WAIT') {
    const matched = (positions || []).some((p) => Number.isFinite(Number(p.entryTime)) && Number(p.entryTime) >= ts)
    return { decision: d, outcome: matched ? 'pending' : 'no_trade' }
  }
  const pos = (positions || [])
    .filter((p) => Number.isFinite(Number(p.entryTime)) && Number(p.entryTime) >= ts)
    .sort((a, b) => Number(a.entryTime) - Number(b.entryTime))[0]
  if (!pos) return { decision: d, outcome: 'no_trade' }
  if (pos.status !== 'closed' || !_fin(Number(pos.pnlAbs))) return { decision: d, outcome: 'pending' }
  return { decision: d, outcome: Number(pos.pnlAbs) > 0 ? 'win' : Number(pos.pnlAbs) < 0 ? 'loss' : 'no_trade', pnlAbs: Number(pos.pnlAbs) }
}

/** Aggregate a decision list into the challenge scoreboard. */
export function challengeScore(decisions, positions) {
  const rows = (decisions || []).map((d) => scoreDecision(d, positions))
  const tally = { decisions: rows.length, wins: 0, losses: 0, wait: 0, pending: 0, noTrade: 0, pnlAbs: 0 }
  for (const r of rows) {
    if (r.outcome === 'win') { tally.wins += 1; tally.pnlAbs += r.pnlAbs ?? 0 }
    else if (r.outcome === 'loss') { tally.losses += 1; tally.pnlAbs += r.pnlAbs ?? 0 }
    else if (r.outcome === 'pending') tally.pending += 1
    else if (r.outcome === 'no_trade') tally.noTrade += 1
    if (r.decision?.side === 'WAIT' && r.outcome === 'no_trade') tally.wait += 1
  }
  tally.pnlAbs = Math.round(tally.pnlAbs * 1e8) / 1e8
  return { version: CHALLENGE_MODEL_VERSION, ...tally }
}