// =============================================================================
//  TM TRADING — V3.9 venue → canonical normalization (§63.6/§63.7/§64.6).
//
//  Exchange-specific payload shapes stay HERE (per venue); consumers only see
//  canonical structures. Every mapper preserves the RAW venue identifiers and
//  the venue's own event/transaction timestamps, and separates event time from
//  ingest time (D17). Nothing is synthesized: absent fields become null and the
//  caller labels the record MISSING/ESTIMATED (never $0.00).
// =============================================================================

const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))
const str = (v) => (v == null ? null : String(v))

/** Canonical side. */
export function sideFrom(venue, raw) {
  const s = String(raw ?? '').toLowerCase()
  if (venue === 'okx') return s === 'buy' ? 'BUY' : s === 'sell' ? 'SELL' : null
  return s === 'buy' || s === 'b' ? 'BUY' : s === 'sell' || s === 's' ? 'SELL' : null
}

// --- account snapshot --------------------------------------------------------
export function normalizeAccount(venue, payload, ctx = {}) {
  const base = { venue, environment: 'DEMO', accountId: ctx.accountId ?? null, asOf: ctx.ingestTime ?? Date.now(), source: 'venue', raw: undefined }
  if (venue === 'bybit') {
    const list = payload?.result?.list ?? []
    const coins = list.flatMap((a) => (a.coin ?? []).map((c) => ({ currency: str(c.coin), equity: num(c.equity), available: num(c.availableToWithdraw), walletBalance: num(c.walletBalance), unrealisedPnl: num(c.unrealisedPnl) })))
    return { ...base, totalEquity: num(list[0]?.totalEquity), coins }
  }
  if (venue === 'okx') {
    const d = payload?.data?.[0] ?? {}
    const coins = (d.details ?? []).map((c) => ({ currency: str(c.ccy), equity: num(c.eq), available: num(c.availBal), walletBalance: num(c.cashBal), unrealisedPnl: num(c.upl) }))
    return { ...base, totalEquity: num(d.totalEq), coins }
  }
  // binance
  if (ctx.marketType === 'spot') {
    const coins = (payload?.balances ?? []).filter((b) => num(b.free) || num(b.locked)).map((b) => ({ currency: str(b.asset), available: num(b.free), locked: num(b.locked) }))
    return { ...base, totalEquity: null, coins }
  }
  const coins = (payload?.assets ?? []).filter((a) => num(a.marginBalance) || num(a.availableBalance)).map((a) => ({ currency: str(a.asset), equity: num(a.marginBalance), available: num(a.availableBalance), unrealisedPnl: num(a.unrealizedProfit) }))
  return { ...base, totalEquity: num(payload?.totalWalletBalance) ?? num(payload?.totalMarginBalance), coins }
}

// --- positions ---------------------------------------------------------------
export function normalizePositions(venue, payload, ctx = {}) {
  const out = []
  if (venue === 'bybit') {
    for (const p of payload?.result?.list ?? []) {
      const size = num(p.size)
      if (!size) continue
      out.push({ venue, symbol: str(p.symbol), canonicalInstrumentId: ctx.canonical?.(p.symbol) ?? null, side: num(p.side) === 0 || String(p.side).toLowerCase() === 'buy' ? 'LONG' : 'SHORT', qty: Math.abs(size), entryPrice: num(p.entryPrice), markPrice: num(p.markPrice), unrealisedPnl: num(p.unrealisedPnl), leverage: num(p.leverage), positionSide: str(p.positionSide), raw: { positionId: str(p.positionId), positionStatus: str(p.positionStatus) } })
    }
  } else if (venue === 'okx') {
    for (const p of payload?.data ?? []) {
      const pos = num(p.pos)
      if (!pos) continue
      out.push({ venue, symbol: str(p.instId), canonicalInstrumentId: ctx.canonical?.(p.instId) ?? null, side: (num(p.posSide) === -1 || String(p.posSide).toLowerCase() === 'short') ? 'SHORT' : 'LONG', qty: Math.abs(pos), entryPrice: num(p.avgPx), markPrice: num(p.markPx), unrealisedPnl: num(p.upl), leverage: num(p.lever), raw: { posId: str(p.posId), mgnMode: str(p.mgnMode) } })
    }
  } else if (ctx.marketType === 'usdm') {
    for (const p of payload?.positions ?? payload ?? []) {
      const amt = num(p.positionAmt)
      if (!amt) continue
      out.push({ venue, symbol: str(p.symbol), canonicalInstrumentId: ctx.canonical?.(p.symbol) ?? null, side: amt > 0 ? 'LONG' : 'SHORT', qty: Math.abs(amt), entryPrice: num(p.entryPrice), markPrice: num(p.markPrice), unrealisedPnl: num(p.unrealizedProfit), leverage: num(p.leverage), raw: { positionSide: str(p.positionSide) } })
    }
  }
  return out
}

// --- orders ------------------------------------------------------------------
const ORDER_STATUS_CANON = {
  // bybit
  Created: 'pending', New: 'pending', PartiallyFilled: 'partiallyFilled', Filled: 'filled', Cancelled: 'cancelled', Rejected: 'rejected', Untriggered: 'pending', Triggered: 'pending', PartiallyFilledCanceled: 'cancelled',
  // okx
  live: 'pending', partially_filled: 'partiallyFilled', filled: 'filled', canceled: 'cancelled', cancelled: 'cancelled',
}
export function normalizeOrder(venue, o, ctx = {}) {
  if (venue === 'bybit') {
    return {
      venue, symbol: str(o.symbol), canonicalInstrumentId: ctx.canonical?.(o.symbol) ?? null,
      externalOrderId: str(o.orderId), clientOrderId: str(o.orderLinkId),
      side: sideFrom(venue, o.side), type: String(o.orderType ?? '').toLowerCase() === 'limit' ? 'limit' : 'market',
      qty: num(o.qty), price: num(o.price), filledQty: num(o.cumExecQty), avgFillPrice: num(o.avgPrice),
      status: ORDER_STATUS_CANON[o.orderStatus] ?? 'pending', statusRaw: str(o.orderStatus),
      eventTime: num(o.updatedTime) ?? num(o.createdTime), ingestTime: ctx.ingestTime ?? Date.now(),
      raw: { orderId: str(o.orderId), orderLinkId: str(o.orderLinkId), category: str(o.category) },
    }
  }
  if (venue === 'okx') {
    return {
      venue, symbol: str(o.instId), canonicalInstrumentId: ctx.canonical?.(o.instId) ?? null,
      externalOrderId: str(o.ordId), clientOrderId: str(o.clOrdId),
      side: sideFrom(venue, o.side), type: String(o.ordType ?? '').includes('market') ? 'market' : 'limit',
      qty: num(o.sz), price: num(o.px), filledQty: num(o.accFillSz), avgFillPrice: num(o.avgPx),
      status: ORDER_STATUS_CANON[o.state] ?? 'pending', statusRaw: str(o.state),
      eventTime: num(o.uTime) ?? num(o.cTime), ingestTime: ctx.ingestTime ?? Date.now(),
      raw: { ordId: str(o.ordId), clOrdId: str(o.clOrdId), tdMode: str(o.tdMode) },
    }
  }
  // binance (spot + usdm share field names closely)
  const statusMap = { NEW: 'pending', PARTIALLY_FILLED: 'partiallyFilled', FILLED: 'filled', CANCELED: 'cancelled', EXPIRED: 'expired', REJECTED: 'rejected', PENDING_CANCEL: 'pending' }
  return {
    venue, symbol: str(o.symbol), canonicalInstrumentId: ctx.canonical?.(o.symbol) ?? null,
    externalOrderId: str(o.orderId), clientOrderId: str(o.clientOrderId),
    side: sideFrom(venue, o.side), type: String(o.type ?? '').toLowerCase() === 'limit' ? 'limit' : 'market',
    qty: num(o.origQty), price: num(o.price), filledQty: num(o.executedQty), avgFillPrice: num(o.avgPrice),
    status: statusMap[o.status] ?? 'pending', statusRaw: str(o.status),
    eventTime: num(o.updateTime) ?? num(o.time), ingestTime: ctx.ingestTime ?? Date.now(),
    raw: { orderId: str(o.orderId), clientOrderId: str(o.clientOrderId) },
  }
}

// --- executions / fills ------------------------------------------------------
export function normalizeExecution(venue, e, ctx = {}) {
  if (venue === 'bybit') {
    return {
      venue, symbol: str(e.symbol), canonicalInstrumentId: ctx.canonical?.(e.symbol) ?? null,
      externalOrderId: str(e.orderId), clientOrderId: str(e.orderLinkId), execId: str(e.execId),
      side: sideFrom(venue, e.side), fillQty: num(e.execQty), fillPrice: num(e.execPrice),
      feeAmount: num(e.execFee), feeCurrency: str(e.feeCurrency), feeRate: num(e.feeRate), isMaker: e.isMaker === true || e.isMaker === 'true',
      eventTime: num(e.execTime), ingestTime: ctx.ingestTime ?? Date.now(),
      feeState: num(e.execFee) == null ? 'MISSING' : 'VERIFIED_VENUE',
      raw: { execId: str(e.execId), execType: str(e.execType) },
    }
  }
  if (venue === 'okx') {
    return {
      venue, symbol: str(e.instId), canonicalInstrumentId: ctx.canonical?.(e.instId) ?? null,
      externalOrderId: str(e.ordId), clientOrderId: str(e.clOrdId), execId: str(e.tradeId),
      side: sideFrom(venue, e.side), fillQty: num(e.fillSz), fillPrice: num(e.fillPx),
      feeAmount: num(e.fee), feeCurrency: str(e.feeCcy), feeRate: null, isMaker: str(e.execType) === 'M',
      eventTime: num(e.ts), ingestTime: ctx.ingestTime ?? Date.now(),
      feeState: num(e.fee) == null ? 'MISSING' : 'VERIFIED_VENUE',
      raw: { tradeId: str(e.tradeId), execType: str(e.execType) },
    }
  }
  return {
    venue, symbol: str(e.symbol), canonicalInstrumentId: ctx.canonical?.(e.symbol) ?? null,
    externalOrderId: str(e.orderId), clientOrderId: str(e.clientOrderId), execId: str(e.id),
    side: sideFrom(venue, e.side), fillQty: num(e.qty), fillPrice: num(e.price),
    feeAmount: num(e.commission), feeCurrency: str(e.commissionAsset), feeRate: null, isMaker: e.maker === true || e.maker === 'true',
    eventTime: num(e.time), ingestTime: ctx.ingestTime ?? Date.now(),
    feeState: num(e.commission) == null ? 'MISSING' : 'VERIFIED_VENUE',
    raw: { id: str(e.id), quoteQty: num(e.quoteQty) },
  }
}

// --- fee schedule ------------------------------------------------------------
export function normalizeFeeSchedule(venue, payload, ctx = {}) {
  if (venue === 'bybit') {
    const list = payload?.result?.list ?? []
    const row = list[0] ?? {}
    return { venue, symbol: str(row.symbol), makerRate: num(row.makerFeeRate), takerRate: num(row.takerFeeRate), state: row.makerFeeRate == null ? 'MISSING' : 'VERIFIED_VENUE', asOf: ctx.ingestTime ?? Date.now() }
  }
  if (venue === 'okx') {
    const d = payload?.data?.[0] ?? {}
    return { venue, symbol: str(d.instType), makerRate: num(d.maker), takerRate: num(d.taker), state: d.maker == null ? 'MISSING' : 'VERIFIED_VENUE', asOf: ctx.ingestTime ?? Date.now() }
  }
  const d = payload ?? {}
  return { venue, symbol: str(ctx.symbol), makerRate: num(d.makerRate ?? d.makerCommission), takerRate: num(d.takerRate ?? d.takerCommission), state: (d.makerRate ?? d.makerCommission) == null ? 'MISSING' : 'VERIFIED_VENUE', asOf: ctx.ingestTime ?? Date.now() }
}

// --- funding -----------------------------------------------------------------
/** fundingRateObservation (§63.11) — the published rate, never a cashflow. */
export function normalizeFundingObservation(venue, payload, ctx = {}) {
  if (venue === 'bybit') {
    const item = payload?.result?.list?.[0] ?? {}
    return { venue, symbol: str(item.symbol ?? ctx.symbol), rate: num(item.fundingRate), nextFundingTime: num(item.nextFundingTime), observedAt: ctx.ingestTime ?? Date.now(), kind: 'fundingRateObservation', state: num(item.fundingRate) == null ? 'MISSING' : 'VERIFIED_VENUE' }
  }
  if (venue === 'okx') {
    const d = payload?.data?.[0] ?? {}
    return { venue, symbol: str(d.instId ?? ctx.symbol), rate: num(d.fundingRate), nextFundingTime: num(d.nextFundingTime), observedAt: ctx.ingestTime ?? Date.now(), kind: 'fundingRateObservation', state: num(d.fundingRate) == null ? 'MISSING' : 'VERIFIED_VENUE' }
  }
  const item = Array.isArray(payload) ? payload[payload.length - 1] : payload
  return { venue, symbol: str(item?.symbol ?? ctx.symbol), rate: num(item?.fundingRate), nextFundingTime: num(item?.nextFundingTime ?? item?.fundingTime), observedAt: ctx.ingestTime ?? Date.now(), kind: 'fundingRateObservation', state: num(item?.fundingRate) == null ? 'MISSING' : 'VERIFIED_VENUE' }
}

// --- instruments -------------------------------------------------------------
export function normalizeInstrument(venue, raw, ctx = {}) {
  if (venue === 'bybit') {
    return { venue, venueInstrumentId: str(raw.symbol), canonicalInstrumentId: ctx.canonical?.(raw.symbol) ?? null, baseCurrency: str(raw.baseCoin), quoteCurrency: str(raw.quoteCoin), tickSize: num(raw.priceFilter?.tickSize), lotStep: num(raw.lotSizeFilter?.qtyStep), minQty: num(raw.lotSizeFilter?.minOrderQty), maxQty: num(raw.lotSizeFilter?.maxOrderQty), minNotional: num(raw.lotSizeFilter?.minNotionalValue), status: str(raw.status), contractSpecVersion: str(raw.version) ?? null }
  }
  if (venue === 'okx') {
    return { venue, venueInstrumentId: str(raw.instId), canonicalInstrumentId: ctx.canonical?.(raw.instId) ?? null, baseCurrency: str(raw.ctValCcy), quoteCurrency: str(raw.settleCcy), tickSize: num(raw.tickSz), lotStep: num(raw.lotSz), minQty: num(raw.minSz), contractValue: num(raw.ctVal), status: str(raw.state), contractSpecVersion: null }
  }
  const filters = Object.fromEntries((raw.filters ?? []).map((f) => [f.filterType, f]))
  return { venue, venueInstrumentId: str(raw.symbol), canonicalInstrumentId: ctx.canonical?.(raw.symbol) ?? null, baseCurrency: str(raw.baseAsset), quoteCurrency: str(raw.quoteAsset), tickSize: num(filters.PRICE_FILTER?.tickSize), lotStep: num(filters.LOT_SIZE?.stepSize), minQty: num(filters.LOT_SIZE?.minQty), maxQty: num(filters.LOT_SIZE?.maxQty), minNotional: num(filters.MIN_NOTIONAL?.minNotional ?? filters.NOTIONAL?.minNotional), status: str(raw.status), contractSpecVersion: null }
}
