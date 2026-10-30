// =============================================================================
//  TM TRADING — V3.9 EXCHANGE_DEMO order-intent pipeline (§63.9/§63.10/§64.5B,
//  goal F). ONE shared, deterministic path that both indicator bots and AI bots
//  use to turn a validated order intent into a crypto-exchange DEMO order.
//
//  Order of operations (never short-circuited):
//   1. Session execution binding — mode must be EXCHANGE_DEMO and the adapter's
//      venue must equal the session's IMMUTABLE executionVenue. AI/bots cannot
//      pick or change the venue (assertExecutionVenueImmutable).
//   2. Deterministic Risk Gate (exec/risk.mjs checkOrder) — server-side, always.
//      A rejection stops here; nothing reaches the venue.
//   3. Capability gate — inside adapter.placeDemoOrder, which fails closed until
//      the venue's execution capabilities are VERIFIED by a live probe (§64.8).
//   4. Idempotent submit — clientOrderId anchors intent↔venue order; a timeout
//      surfaces UNCERTAIN and is NEVER blind-resent (reconcile-before-resend).
//   5. Persist every step (risk decision, order mapping, ack) to the evidence
//      ledger with full venue/session/strategy lineage (goal G).
//
//  AI output is a PROPOSAL. This pipeline is the only thing that can submit an
//  order, and it can only ever reach an allowlisted DEMO endpoint (adapter.mjs).
// =============================================================================

import { checkOrder as defaultCheckOrder, loadRiskConfig } from '../risk.mjs'
import { clientOrderId as defaultClientOrderId } from '../../engine/keys.mjs'
import { assertExecutionVenueImmutable } from './failover.mjs'
import { persistEvent, upsertOrderMapping } from './eventStore.mjs'
import { classifyError } from './errors.mjs'

export const INTENT_RESULTS = Object.freeze([
  'REJECTED_NOT_EXCHANGE_DEMO', 'REJECTED_IMMUTABLE_VENUE', 'REJECTED_BY_RISK',
  'REJECTED_CAPABILITY', 'ACCEPTED', 'UNCERTAIN', 'FAILED',
])

const dirFromSide = (side) => (String(side).toUpperCase() === 'BUY' || String(side).toUpperCase() === 'LONG' ? 1 : -1)

/**
 * @param {object} p {
 *   ownerId, session, intent, adapter,
 *   checkOrder=exec/risk.checkOrder, riskConfig, clientOrderId=engine/keys.clientOrderId,
 *   persist={persistEvent,upsertOrderMapping}, now, models
 * }
 * intent: { symbol, side, qty, price?, sl?, tps?, type?, clientOrderId?, alertKey?,
 *           sessionId?, botInstanceId?, agentId?, strategyVersionId?, canonicalInstrumentId? }
 */
export async function executeExchangeDemoIntent(p = {}) {
  const {
    ownerId, session, intent, adapter,
    checkOrder = defaultCheckOrder, riskConfig = undefined,
    clientOrderId = defaultClientOrderId,
    persist = { persistEvent, upsertOrderMapping },
    now = Date.now(), models = undefined,
  } = p
  const opts = models ? { _models: models } : {}
  const venue = adapter?.venue
  const base = { ownerId, venue, accountId: session?.accountId ?? 'default', sessionId: session?.sessionId ?? null, botInstanceId: intent.botInstanceId ?? null, agentId: intent.agentId ?? null }

  // 1. Execution binding + immutable venue.
  if (session?.executionMode !== 'EXCHANGE_DEMO') {
    return { status: 'REJECTED_NOT_EXCHANGE_DEMO', message: 'session is not an EXCHANGE_DEMO session; refusing to route to a venue' }
  }
  const immutable = assertExecutionVenueImmutable({ session, requestedVenue: venue, now })
  if (!immutable.ok) {
    await persist.persistEvent(ownerId, { ...base, kind: 'venue_switch', eventTime: now, ingestTime: now, data: immutable.audit, accountingState: null }, opts).catch(() => {})
    return { status: 'REJECTED_IMMUTABLE_VENUE', message: immutable.message, code: immutable.code }
  }

  // 2. Deterministic Risk Gate (server-side, mandatory).
  const riskOrder = {
    symbol: intent.symbol, dir: dirFromSide(intent.side), side: intent.side,
    entry: intent.price ?? intent.entry, entryPrice: intent.price ?? intent.entry,
    sl: intent.sl, tps: intent.tps ?? [], qty: Number(intent.qty), source: intent.agentId ? 'ai_agent' : 'bot',
  }
  let decision
  try {
    decision = await checkOrder(riskOrder, riskConfig ?? loadRiskConfig())
  } catch (err) {
    return { status: 'FAILED', stage: 'risk', message: classifyError(err).code }
  }
  await persist.persistEvent(ownerId, { ...base, kind: 'risk_decision', eventTime: now, ingestTime: now, correlationId: null, data: { ok: decision.ok, code: decision.code ?? null, message: decision.message ?? null, qty: decision.qty ?? null, notional: decision.notional ?? null }, strategyVersionId: intent.strategyVersionId ?? null }, opts).catch(() => {})
  if (!decision.ok) {
    return { status: 'REJECTED_BY_RISK', code: decision.code, message: decision.message, decision }
  }

  // 4a. Idempotency anchor (order-layer). Reuse intent.clientOrderId if present.
  const cli = intent.clientOrderId ?? clientOrderId(intent.alertKey ?? `intent_${now}_${Math.random().toString(36).slice(2, 8)}`, 0)
  const finalQty = Number(decision.qty ?? intent.qty)
  const orderIntent = { symbol: intent.symbol, side: String(intent.side).toUpperCase() === 'LONG' ? 'BUY' : String(intent.side).toUpperCase() === 'SHORT' ? 'SELL' : String(intent.side).toUpperCase(), qty: finalQty, price: intent.price, type: intent.type ?? 'market', clientOrderId: cli, sessionId: session.sessionId, tdMode: intent.tdMode }

  // 5a. Persist the intent↔venue mapping BEFORE submission (submitted state).
  const mappingId = await persist.upsertOrderMapping(ownerId, {
    ...base, venue, clientOrderId: cli, canonicalInstrumentId: intent.canonicalInstrumentId ?? null, venueInstrumentId: intent.symbol,
    productCategory: adapter?.profileId, side: orderIntent.side, type: orderIntent.type, qty: finalQty,
    status: 'submitted', strategyVersionId: intent.strategyVersionId ?? null, riskDecisionId: null, submittedAt: now,
  }, opts).catch(() => null)

  // 3 + 4b. Capability-gated submission (fails closed); never blind-retried.
  try {
    const ack = await adapter.placeDemoOrder(orderIntent)
    await persist.upsertOrderMapping(ownerId, { ...base, venue, clientOrderId: cli, externalOrderId: ack.externalOrderId, venueInstrumentId: intent.symbol, productCategory: adapter?.profileId, side: orderIntent.side, type: orderIntent.type, qty: finalQty, status: 'accepted', strategyVersionId: intent.strategyVersionId ?? null, submittedAt: now, ackAt: now }, opts).catch(() => {})
    await persist.persistEvent(ownerId, { ...base, kind: 'order', externalOrderId: ack.externalOrderId, clientOrderId: cli, venueInstrumentId: intent.symbol, canonicalInstrumentId: intent.canonicalInstrumentId ?? null, eventTime: ack.ackAt ?? now, ingestTime: now, data: { status: 'accepted', qty: finalQty, side: orderIntent.side }, strategyVersionId: intent.strategyVersionId ?? null }, opts).catch(() => {})
    return { status: 'ACCEPTED', clientOrderId: cli, externalOrderId: ack.externalOrderId, mappingId, decision }
  } catch (err) {
    const c = classifyError(err)
    if (c.code.endsWith('capability-unverified')) {
      await persist.upsertOrderMapping(ownerId, { ...base, venue, clientOrderId: cli, venueInstrumentId: intent.symbol, productCategory: adapter?.profileId, side: orderIntent.side, type: orderIntent.type, qty: finalQty, status: 'rejected', strategyVersionId: intent.strategyVersionId ?? null, submittedAt: now }, opts).catch(() => {})
      return { status: 'REJECTED_CAPABILITY', clientOrderId: cli, code: c.code, message: 'venue execution capability not verified; order not submitted' }
    }
    if (c.code.endsWith('order-uncertain')) {
      // Timed out / 5xx before a definitive ack: mark UNCERTAIN, do NOT resend.
      await persist.upsertOrderMapping(ownerId, { ...base, venue, clientOrderId: cli, venueInstrumentId: intent.symbol, productCategory: adapter?.profileId, side: orderIntent.side, type: orderIntent.type, qty: finalQty, status: 'uncertain', strategyVersionId: intent.strategyVersionId ?? null, submittedAt: now }, opts).catch(() => {})
      await persist.persistEvent(ownerId, { ...base, kind: 'order', clientOrderId: cli, venueInstrumentId: intent.symbol, eventTime: now, ingestTime: now, correlationId: err.correlationId ?? null, data: { status: 'uncertain', reason: c.code }, accountingState: 'UNRECONCILED' }, opts).catch(() => {})
      return { status: 'UNCERTAIN', clientOrderId: cli, code: c.code, message: 'order ack uncertain — reconcile by clientOrderId before any resend' }
    }
    await persist.upsertOrderMapping(ownerId, { ...base, venue, clientOrderId: cli, venueInstrumentId: intent.symbol, productCategory: adapter?.profileId, side: orderIntent.side, type: orderIntent.type, qty: finalQty, status: 'rejected', strategyVersionId: intent.strategyVersionId ?? null, submittedAt: now }, opts).catch(() => {})
    return { status: 'FAILED', clientOrderId: cli, code: c.code, message: c.code }
  }
}
