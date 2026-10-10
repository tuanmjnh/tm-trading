#!/usr/bin/env node
// =============================================================================
//  TM TRADING — simulation/ core tests (roadmap Phase 7P, pure, no IO).
//
//  Locks the fill model semantics the paper executor now depends on:
//    spread (BUY never fills at mid), slippage direction, latency slip +
//    stale-quote refusal, partial fills, maker/taker fees, limit/stop
//    triggering, weighted-average merges, SL/TP modification rules, exit
//    pricing (SL slips, TP is exact), TP ladder portions, account equity.
//
//  Run:  node simulation/test.mjs   (wired into npm test via test-summary)
// =============================================================================
import { attemptFill, loadFillConfig, normalizeQuote, FILL_DEFAULTS } from './fill.mjs'
import { buildFillRecord, FILL_MODEL_VERSION } from './fills.mjs'
import {
  openFromFill, applyFill, validateModify, modifyPosition, partialCloseQty,
  partialCloseFill,
  closeFill, tpPortion, markUnrealized, positionState, exitOrderFor,
} from './engine.mjs'
import { accountSummary, dayRealized } from './portfolio.mjs'
import { createReplayPlayer, normalizeReplayBars, intervalToMs, REPLAY_SPEEDS } from './replay.mjs'
import {
  MARGIN_DEFAULTS, loadMarginConfig, positionNotional, initialMarginFor,
  maintenanceMarginFor, leverageOf, accountMarginHealth,
} from './margin.mjs'
import {
  liquidationPrice, checkLiquidation, liquidationFill,
} from './liquidation.mjs'

let pass = 0
let fail = 0
const section = (t) => console.log(`\n${t}`)
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok   ${name}`) }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`) }
}
function finish() {
  console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} pass, ${fail} fail\n`)
  process.exit(fail === 0 ? 0 : 1)
}
process.on('uncaughtException', (e) => { fail++; console.log(`  FAIL (unexpected throw) — ${e?.message || e}`); finish() })
process.on('unhandledRejection', (e) => { fail++; console.log(`  FAIL (unhandled rejection) — ${e?.message || e}`); finish() })

const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps
const bps = (n) => n // readability in assertions

// A two-sided quote with displayed size — the shape a real bookTicker has.
const Q = (over = {}) => ({ bid: 100, ask: 100.1, bidQty: 2, askQty: 0.5, time: 1_000_000, ...over })
const NOW = 1_000_000

// =============================================================================
section('1. attemptFill — market orders: spread, slippage, fees, latency')

const mBuy = attemptFill({ type: 'market', side: 'BUY', qty: 0.1 }, Q(), FILL_DEFAULTS, NOW)
check('BUY fills at the ASK + slippage (never at mid)', mBuy.status === 'filled' && mBuy.price > 100.1, JSON.stringify(mBuy))
check('  price = ask * (1 + slippageBps/1e4)', near(mBuy.price, 100.1 * (1 + 2 / 1e4)), String(mBuy.price))
check('taker fee = notional * takerFeeBps / 1e4', near(mBuy.fee, mBuy.price * 0.1 * (4 / 1e4)), String(mBuy.fee))

const mSell = attemptFill({ type: 'market', side: 'SELL', qty: 0.1 }, Q(), FILL_DEFAULTS, NOW)
check('SELL fills at the BID - slippage', mSell.status === 'filled' && near(mSell.price, 100 * (1 - 2 / 1e4)), String(mSell.price))
check('SELL slip is adverse (price < bid)', mSell.price < 100)
check('BUY slip is adverse (price > ask)', mBuy.price > 100.1)

const aged = attemptFill({ type: 'market', side: 'BUY', qty: 0.1 }, Q({ time: NOW - 10_000 }), FILL_DEFAULTS, NOW)
check('latency: 10s old quote adds 10 * latencySlipPerSecBps', near(aged.slippageBps, 2 + 10 * 0.5), String(aged.slippageBps))
check('  and fills worse than a fresh quote', aged.price > mBuy.price)
check('latencyMs is reported', aged.latencyMs === 10_000)

const stale = attemptFill({ type: 'market', side: 'BUY', qty: 0.1 }, Q({ time: NOW - 16_000 }), FILL_DEFAULTS, NOW)
check('quote older than maxQuoteAgeMs -> stale, no fill', stale.status === 'stale' && stale.filledQty === 0 && stale.price === null, JSON.stringify(stale))

const bare = attemptFill({ type: 'market', side: 'BUY', qty: 0.1 }, 100, FILL_DEFAULTS, NOW)
check('bare last price fills (spread synthesized from spreadBps)', bare.status === 'filled' && bare.price > 100, JSON.stringify(bare))

check('qty <= 0 -> rejected', attemptFill({ type: 'market', side: 'BUY', qty: 0 }, Q(), FILL_DEFAULTS, NOW).status === 'rejected')
check('bad side -> rejected', attemptFill({ type: 'market', side: 'HOLD', qty: 1 }, Q(), FILL_DEFAULTS, NOW).status === 'rejected')
check('unknown type -> rejected', attemptFill({ type: 'trailing', side: 'BUY', qty: 1 }, Q(), FILL_DEFAULTS, NOW).status === 'rejected')
check('garbage quote -> rejected', attemptFill({ type: 'market', side: 'BUY', qty: 1 }, {}, FILL_DEFAULTS, NOW).status === 'rejected')

// =============================================================================
section('2. attemptFill — limit orders: marketable vs working')

const limCrossBuy = attemptFill({ type: 'limit', side: 'BUY', qty: 0.1, price: 100.2 }, Q(), FILL_DEFAULTS, NOW)
check('BUY limit ABOVE ask (marketable) fills at the BETTER ask price', limCrossBuy.status === 'filled' && near(limCrossBuy.price, 100.1 * (1 + 2 / 1e4)), String(limCrossBuy.price))

const limWorkBuy = attemptFill({ type: 'limit', side: 'BUY', qty: 0.1, price: 99.5 }, Q(), FILL_DEFAULTS, NOW)
check('BUY limit BELOW ask -> working (no phantom fill at signal price)', limWorkBuy.status === 'working' && limWorkBuy.filledQty === 0, JSON.stringify(limWorkBuy))

const limCrossSell = attemptFill({ type: 'limit', side: 'SELL', qty: 0.1, price: 99.9 }, Q(), FILL_DEFAULTS, NOW)
check('SELL limit BELOW bid (marketable) fills at the bid side', limCrossSell.status === 'filled' && near(limCrossSell.price, 100 * (1 - 2 / 1e4)), String(limCrossSell.price))

const limWorkSell = attemptFill({ type: 'limit', side: 'SELL', qty: 0.1, price: 101 }, Q(), FILL_DEFAULTS, NOW)
check('SELL limit ABOVE bid -> working', limWorkSell.status === 'working')

check('limit without price -> rejected', attemptFill({ type: 'limit', side: 'BUY', qty: 1 }, Q(), FILL_DEFAULTS, NOW).status === 'rejected')
check('maker role -> maker fee', (() => {
  const r = attemptFill({ type: 'limit', side: 'BUY', qty: 0.1, price: 100.2 }, Q(), FILL_DEFAULTS, NOW, { role: 'maker' })
  return near(r.fee, r.price * 0.1 * (1 / 1e4))
})())

// =============================================================================
section('3. attemptFill — stop orders: trigger, gaps, both directions')

const stopBuyWork = attemptFill({ type: 'stop', side: 'BUY', qty: 0.1, price: 101 }, Q(), FILL_DEFAULTS, NOW)
check('BUY stop above the market -> working', stopBuyWork.status === 'working', JSON.stringify(stopBuyWork))

const stopBuyGap = attemptFill({ type: 'stop', side: 'BUY', qty: 0.1, price: 100.05 }, Q(), FILL_DEFAULTS, NOW)
check('BUY stop triggered (ask >= stop) fills at the CURRENT ask, worse than stop', stopBuyGap.status === 'filled' && stopBuyGap.price > 100.05, String(stopBuyGap.price))

const stopSellTrig = attemptFill({ type: 'stop', side: 'SELL', qty: 0.1, price: 100.05 }, Q(), FILL_DEFAULTS, NOW)
check('SELL stop triggered (bid <= stop) fills at bid - slip', stopSellTrig.status === 'filled' && near(stopSellTrig.price, 100 * (1 - 2 / 1e4)), String(stopSellTrig.price))

const stopSellWork = attemptFill({ type: 'stop', side: 'SELL', qty: 0.1, price: 99 }, Q(), FILL_DEFAULTS, NOW)
check('SELL stop below market -> working', stopSellWork.status === 'working')

const stopGapWorse = attemptFill({ type: 'stop', side: 'BUY', qty: 0.1, price: 90 }, Q({ bid: 95, ask: 95.1 }), FILL_DEFAULTS, NOW)
check('a gapped market fills much worse than the stop level (never better)', stopGapWorse.status === 'filled' && stopGapWorse.price > 90 + 4, String(stopGapWorse.price))

// =============================================================================
section('4. attemptFill — partial fills (top-of-book size)')

const part = attemptFill({ type: 'market', side: 'BUY', qty: 1 }, Q({ askQty: 0.3 }), FILL_DEFAULTS, NOW)
check('order > displayed askQty -> partial', part.status === 'partial', JSON.stringify(part))
check('  fills exactly the available size', part.filledQty === 0.3, String(part.filledQty))
check('  remainder reported for retry', part.remainderQty === 0.7, String(part.remainderQty))

const partSell = attemptFill({ type: 'market', side: 'SELL', qty: 1 }, Q({ bidQty: 0.25 }), FILL_DEFAULTS, NOW)
check('SELL partial uses bidQty', partSell.status === 'partial' && partSell.filledQty === 0.25)

const whole = attemptFill({ type: 'market', side: 'BUY', qty: 0.4 }, Q({ askQty: 0.5 }), FILL_DEFAULTS, NOW)
check('qty <= available -> fully filled', whole.status === 'filled' && whole.remainderQty === 0)

const noSize = attemptFill({ type: 'market', side: 'BUY', qty: 0.4 }, Q({ askQty: null }), FILL_DEFAULTS, NOW)
check('no displayed size -> assume liquid, full fill', noSize.status === 'filled' && noSize.filledQty === 0.4)

// =============================================================================
section('5. loadFillConfig / normalizeQuote')

check('defaults load with no env', JSON.stringify(loadFillConfig({})) === JSON.stringify(FILL_DEFAULTS))
const envCfg = loadFillConfig({ SIM_SLIPPAGE_BPS: '7', SIM_TAKER_FEE_BPS: 'abc' })
check('valid env overrides slippage', envCfg.slippageBps === 7)
check('invalid env keeps the default (never crashes)', envCfg.takerFeeBps === FILL_DEFAULTS.takerFeeBPS || envCfg.takerFeeBps === FILL_DEFAULTS.takerFeeBps)
check('negative env ignored', loadFillConfig({ SIM_SPREAD_BPS: '-5' }).spreadBps === FILL_DEFAULTS.spreadBps)
const nq = normalizeQuote({ last: 100, time: 42 }, FILL_DEFAULTS)
check('normalizeQuote(last) derives bid/ask around mid', nq && near(nq.bid + nq.ask, 200) && nq.ask > nq.bid && nq.time === 42, JSON.stringify(nq))
check('normalizeQuote(no price) -> null', normalizeQuote({}, FILL_DEFAULTS) === null)

// =============================================================================
section('6. engine — open / partial-fill merge / fees')

const fill1 = attemptFill({ type: 'market', side: 'BUY', qty: 1 }, Q({ askQty: 5 }), FILL_DEFAULTS, NOW)
const pos0 = openFromFill(fill1, { account: 'paper', symbol: 'BTCUSDT', dir: 1, sl: 95, tps: [110], orderType: 'market', tf: '15' })
check('openFromFill: qty/price from the FILL, not the signal', pos0.qty === fill1.filledQty && pos0.entryPrice === fill1.price, JSON.stringify(pos0))
check('fees are a MEASURED number (never null on a modelled fill)', typeof pos0.fees === 'number' && pos0.fees === fill1.fee)
check('orderType recorded', pos0.orderType === 'market')
check('entry fill was full (askQty covered the order)', fill1.filledQty === 1)

const fill2 = { status: 'filled', filledQty: 1, price: 110, fee: 1 }
const merged = applyFill(pos0, fill2)
check('second fill merges by weighted average entry', near(merged.entryPrice, (fill1.price * 1 + 110 * 1) / 2), String(merged.entryPrice))
check('qty accumulates', near(merged.qty, fill1.filledQty + 1), String(merged.qty))
check('fees accumulate', near(merged.fees, fill1.fee + 1))
check('original position object untouched (pure)', pos0.qty === fill1.filledQty)

check('openFromFill refuses a non-fill', (() => { try { openFromFill({ status: 'working' }, {}); return false } catch { return true } })())
check('applyFill refuses a closed position', (() => { try { applyFill({ status: 'closed', qty: 1, entryPrice: 1 }, fill2); return false } catch { return true } })())

// =============================================================================
section('7. engine — modify SL/TP (fail closed, gate side rules)')

const longPos = { dir: 1, entryPrice: 100, sl: 95, tps: [110], qty: 1, status: 'open', fees: 0 }
check('tighten SL -> ok', validateModify(longPos, { sl: 97 }).ok === true)
check('widen SL past entry -> rejected', validateModify(longPos, { sl: 105 }).code === 'BAD_SL')
check('SL == entry -> rejected', validateModify(longPos, { sl: 100 }).code === 'BAD_SL')
check('new TP on target side -> ok', validateModify(longPos, { tps: [120, 130] }).ok === true)
check('TP below entry (long) -> rejected with index', validateModify(longPos, { tps: [110, 90]}).code === 'BAD_TPS')
check('defective TP level -> rejected, named', /tps\[1\]/.test(validateModify(longPos, { tps: [110, null] }).message || ''))
check('empty tps array -> rejected', validateModify(longPos, { tps: [] }).code === 'BAD_TPS')
check('empty patch -> rejected', validateModify(longPos, {}).code === 'EMPTY_PATCH')
check('short: SL must be ABOVE entry', validateModify({ dir: -1, entryPrice: 100, sl: 105, tps: [90] }, { sl: 99 }).code === 'BAD_SL')

const mod = modifyPosition(longPos, { sl: 97, tps: [115] })
check('modifyPosition returns new state', mod.sl === 97 && mod.tps[0] === 115 && longPos.sl === 95)
check('modifyPosition throws on invalid (fail closed)', (() => { try { modifyPosition(longPos, { sl: 200 }); return false } catch { return true } })())

// =============================================================================
section('8. engine — partial close validation')

check('close by pct -> share of qty', partialCloseQty({ qty: 2 }, { pct: 25 }).qty === 0.5)
check('close by abs qty -> as given', partialCloseQty({ qty: 2 }, { qty: 0.75 }).qty === 0.75)
check('qty > position -> rejected', partialCloseQty({ qty: 1 }, { qty: 2 }).code === 'TOO_LARGE')
check('pct > 100 -> rejected', partialCloseQty({ qty: 1 }, { pct: 150 }).code === 'BAD_PCT')
check('pct = 0 -> rejected', partialCloseQty({ qty: 1 }, { pct: 0 }).code === 'BAD_PCT')
check('qty AND pct -> ambiguous', partialCloseQty({ qty: 1 }, { qty: 1, pct: 50 }).code === 'AMBIGUOUS')
check('neither -> missing', partialCloseQty({ qty: 1 }, {}).code === 'MISSING')
check('clamps rounding dust to full close', partialCloseQty({ qty: 0.00000009 }, { pct: 100 }).qty === 0.00000009)

// =============================================================================
section('9. engine — closeFill: exits price through the model')

const longClose = closeFill(longPos, { kind: 'tp', price: 110 }, FILL_DEFAULTS)
check('TP exit fills EXACTLY at the level (no slippage)', longClose.ok && longClose.exitPrice === 110, JSON.stringify(longClose))
check('  maker fee on the TP', near(longClose.fee, 110 * 1 * (1 / 1e4)))
check('  net PnL = gross - open fees - exit fee', near(longClose.pnlAbs, 10 - 0 - longClose.fee), String(longClose.pnlAbs))

const longSl = closeFill(longPos, { kind: 'sl', price: 95 }, FILL_DEFAULTS)
check('SL exit pays taker slippage in the exit direction', longSl.exitPrice < 95, String(longSl.exitPrice))
check('  price = sl * (1 - slippageBps/1e4)', near(longSl.exitPrice, 95 * (1 - 2 / 1e4)))
check('  taker fee', near(longSl.fee, longSl.exitPrice * 1 * (4 / 1e4)))

const shortPos = { dir: -1, entryPrice: 100, qty: 1, fees: 0.04, status: 'open' }
const shortTp = closeFill(shortPos, { kind: 'tp', price: 90 }, FILL_DEFAULTS)
check('short TP: gross = (entry - exit) * qty', near(shortTp.gross, 10), String(shortTp.gross))
const shortSl = closeFill(shortPos, { kind: 'sl', price: 105 }, FILL_DEFAULTS)
check('short SL slips UPWARD (worse for a short)', shortSl.exitPrice > 105, String(shortSl.exitPrice))

check('open fees are deducted from PnL', near(closeFill({ ...longPos, fees: 2 }, { kind: 'tp', price: 110 }, FILL_DEFAULTS).pnlAbs, 10 - 2 - closeFill(longPos, { kind: 'tp', price: 110 }, FILL_DEFAULTS).fee))
check('bad exit price -> rejected', closeFill(longPos, { kind: 'sl', price: NaN }, FILL_DEFAULTS).ok === false)
check('exitOrderFor(TP) is a maker limit', (() => { const o = exitOrderFor(longPos, 'tp'); return o.type === 'limit' && o.side === 'SELL' && o.role === 'maker' && o.price === 110 })())
check('exitOrderFor(SL) is a taker market', (() => { const o = exitOrderFor(longPos, 'sl'); return o.type === 'market' && o.side === 'SELL' && o.role === 'taker' })())

// =============================================================================
section('9b. engine — partialCloseFill: realize part, keep the rest (Phase 7P)')

const pcPos = { dir: 1, entryPrice: 100, qty: 2, fees: 0.4, status: 'open', sl: 95, tps: [110] }
const pc = partialCloseFill(pcPos, { pct: 50 }, { kind: 'market', price: 110 }, FILL_DEFAULTS)
check('half the qty leaves, half stays', pc.ok && pc.qty === 1 && pc.remainingQty === 1, JSON.stringify(pc))
check('  not a full close', pc.ok && pc.isFull === false)
check('entry fee split pro-rata (0.4 * 1/2)', pc.ok && near(pc.feeShare, 0.2), String(pc?.feeShare))
check('  remainder keeps the rest (splits sum back to 0.4)', pc.ok && near(pc.remainingFees, 0.2) && near(pc.feeShare + pc.remainingFees, 0.4))
check('  slice priced by closeFill (market = taker slippage)', pc.ok && near(pc.fill.exitPrice, 110 * (1 - 2 / 1e4)), String(pc?.fill?.exitPrice))
check('  slice net = gross - feeShare - exit fee', pc.ok && near(pc.fill.net, (pc.fill.exitPrice - 100) * 1 - 0.2 - pc.fill.fee), String(pc?.fill?.net))
check('TOO_LARGE propagates from partialCloseQty', partialCloseFill(pcPos, { qty: 3 }, { kind: 'sl', price: 95 }).code === 'TOO_LARGE')
check('closed position -> NOT_OPEN', partialCloseFill({ ...pcPos, status: 'closed' }, { pct: 50 }, { kind: 'sl', price: 95 }).code === 'NOT_OPEN')
check('bad exit price -> rejected', partialCloseFill(pcPos, { pct: 50 }, { kind: 'sl', price: NaN }).ok === false)
const pcFull = partialCloseFill(pcPos, { pct: 100 }, { kind: 'market', price: 110 }, FILL_DEFAULTS)
check('pct 100 -> full close (isFull, zero remainder)', pcFull.ok && pcFull.isFull === true && pcFull.qty === 2 && pcFull.remainingQty === 0, JSON.stringify(pcFull))
check('  full close takes ALL entry fees', pcFull.ok && near(pcFull.feeShare, 0.4) && pcFull.remainingFees === 0)
check('legacy null entry fees stay unknown on BOTH sides', (() => {
  const r = partialCloseFill({ ...pcPos, fees: null }, { pct: 50 }, { kind: 'sl', price: 95 })
  return r.ok && r.feeShare === null && r.remainingFees === null
})())
check('input position is untouched (pure)', pcPos.qty === 2 && pcPos.fees === 0.4)

// =============================================================================
section('10. engine — TP ladder portions (multiple TP)')

const ladderPos = { qty: 10, tps: [110, 120, 130], dir: 1, entryPrice: 100, status: 'open' }
check('no tpPcts -> full close at every level (legacy)', tpPortion(ladderPos, 0).qty === 10 && tpPortion(ladderPos, 2).qty === 10)
check('tpPcts [50,30,20]: level 0 -> 50%', tpPortion(ladderPos, 0, [50, 30, 20]).qty === 5)
check('level 1 -> 30%', tpPortion(ladderPos, 1, [50, 30, 20]).qty === 3)
check('LAST level takes the remainder (no stranded dust)', tpPortion(ladderPos, 2, [50, 30, 20]).qty === 10)
check('mismatched pct array -> rejected', tpPortion(ladderPos, 0, [50]).code === 'BAD_PCTS')
check('index past the ladder -> rejected', tpPortion(ladderPos, 5).code === 'NO_TP')
check('negative index -> rejected', tpPortion(ladderPos, -1).code === 'BAD_INDEX')

// =============================================================================
section('11. engine — mark + realtime state')

const markLong = markUnrealized({ ...longPos, qty: 1, entryPrice: 100, fees: 0.1 }, Q(), FILL_DEFAULTS)
check('long marks at the BID (exit side)', markLong.ok && near(markLong.markPrice, 100), String(markLong.markPrice))
check('  net = gross - entry fees', near(markLong.net, 0 - 0.1), String(markLong.net))
const markShort = markUnrealized({ dir: -1, entryPrice: 100, qty: 1, fees: 0, status: 'open' }, Q(), FILL_DEFAULTS)
check('short marks at the ASK (buy back price)', markShort.ok && near(markShort.markPrice, 100.1), String(markShort.markPrice))
check('closed position -> NOT_OPEN', markUnrealized({ ...longPos, status: 'closed' }, Q()).ok === false)
check('garbage quote -> NO_QUOTE', markUnrealized(longPos, {}).ok === false)

const st = positionState(longPos, Q(), FILL_DEFAULTS)
check('positionState carries live unrealized for the UI', st.unrealized !== null && st.markPrice === 100 && st.symbol === undefined, JSON.stringify(st))
const st2 = positionState({ ...longPos, symbol: 'BTCUSDT' }, Q(), FILL_DEFAULTS)
check('  and the symbol when the doc has one', st2.symbol === 'BTCUSDT')

// =============================================================================
section('12. portfolio — account/equity')

const closed1 = { status: 'closed', pnlAbs: 100, fees: 0.5, exitTime: new Date('2026-10-07T01:00:00Z'), symbol: 'BTCUSDT' }
const closed2 = { status: 'closed', pnlAbs: -50, fees: 0.4, exitTime: new Date('2026-10-07T02:00:00Z'), symbol: 'ETHUSDT' }
const openPos = { status: 'open', qty: 1, entryPrice: 100, fees: 0.2, symbol: 'BTCUSDT', dir: 1, tps: [110] }
const quotes = new Map([['BTCUSDT', Q()]])
const acc = accountSummary({ base: 10_000, positions: [closed1, closed2, openPos], quotes })

check('equity = base + realized + unrealized', near(acc.equity, 10_000 + 50 + acc.unrealized), JSON.stringify({ e: acc.equity, u: acc.unrealized }))
check('realized = sum of closed pnlAbs', acc.realized === 50)
check('fees counted across closed + open', near(acc.fees, 0.5 + 0.4 + 0.2), String(acc.fees))
check('win/loss counts', acc.wins === 1 && acc.losses === 1 && near(acc.winRate, 0.5))
check('counts', acc.openCount === 1 && acc.closedCount === 2, JSON.stringify({ o: acc.openCount, c: acc.closedCount }))
check('exposure = |qty*entry| per symbol summed', acc.exposure === 100 && acc.bySymbol.BTCUSDT === 100)

const noQuotes = accountSummary({ base: 100, positions: [openPos] })
check('missing quotes: unrealized contributes 0 (never fabricated)', noQuotes.unrealized === 0 && noQuotes.equity === 100)

const day = dayRealized([closed1, closed2], '2026-10-07')
check('dayRealized groups by UTC day (D2)', day.pnl === 50 && day.trades === 2)
check('other days are excluded', dayRealized([closed1], '2026-10-08').trades === 0)

// =============================================================================
section('13. source guards (integration is real, not aspirational)')

const { readFileSync } = await import('node:fs')
const paperSrc = readFileSync(new URL('../exec/paper.mjs', import.meta.url), 'utf8')
check('exec/paper.mjs imports the simulation fill model', /from '\.\.\/simulation\/fill\.mjs'/.test(paperSrc))
check('paper prices entries through attemptFill (no phantom signal fills)', /attemptFill\(/.test(paperSrc))
check('paper prices exits through closeFill (fees + slippage)', /closeFill\(/.test(paperSrc))
check('the risk gate still runs BEFORE any fill', /checkOrder\(/.test(paperSrc) && paperSrc.indexOf('checkOrder(') < paperSrc.indexOf('attemptFill('))

const ordersSrc = readFileSync(new URL('../server/utils/orders.ts', import.meta.url), 'utf8')
check('ticket accepts an order type (market/limit/stop)', /ORDER_TYPES/.test(ordersSrc) && /'stop'/.test(ordersSrc))
check('ticket raw carries the type to the paper pipeline', /type/.test(ordersSrc))

// =============================================================================
section('14. replay — deterministic player, future data never leaks (Phase 7R2)')

const T0 = 1_780_000_000_000
const mkBar = (i, over = {}) => ({
  type: 'candle', source: 'test', symbol: 'BTCUSDT', timeframe: '1m',
  state: 'closed',
  open: 100 + i, high: 101 + i, low: 99 + i, close: 100.5 + i, volume: 10,
  openTime: T0 + i * 60_000,
  closeTime: T0 + i * 60_000 + 59_999,
  ...over
})
const rBars = Array.from({ length: 5 }, (_, i) => mkBar(i))

check('normalize: closed only, sorted, eventTime = closeTime (D16)',
  normalizeReplayBars(rBars).length === 5 && normalizeReplayBars(rBars)[0].eventTime === mkBar(0).closeTime)
check('normalize: a forming candle is future data and is dropped',
  normalizeReplayBars([mkBar(0), mkBar(1, { state: 'forming' })]).length === 1)
check('normalize: duplicate openTime is dropped (deterministic stream)',
  normalizeReplayBars([mkBar(0), mkBar(0)]).length === 1)
check('normalize: garbage rows are skipped, not fatal',
  normalizeReplayBars([null, 42, { openTime: 'x' }, mkBar(0)]).length === 1)

const rp = createReplayPlayer({ symbol: 'BTCUSDT', timeframe: '1m', bars: rBars })
check('fresh player: ready, cursor 0, clock starts at the first bar',
  rp.state().mode === 'ready' && rp.state().cursor === 0 && rp.state().total === 5 && rp.state().now === T0)
check('FUTURE HIDDEN: nothing emitted before the first step', rp.takeEvents(0).length === 0 && rp.playedCount() === 0)
check('FUTURE HIDDEN: the raw bar array is not reachable from outside', rp.bars === undefined)
check('quote() before any step is null (no quoting the future)', rp.quote() === null)

const ev1 = rp.step(1)
check('step(1) emits exactly one market.candle', ev1.length === 1 && ev1[0].type === 'market.candle' && ev1[0].state === 'closed')
check('clock advanced exactly to the emitted closeTime', rp.state().now === mkBar(0).closeTime)
check('D17 gate: next bar still in the future', rp.canUse(mkBar(1).closeTime) === false && rp.canUse(mkBar(0).closeTime) === true)
check('FUTURE HIDDEN: takeEvents only returns what was played', rp.takeEvents(0).length === 1 && rp.state().cursor === 1)
check('manual step parks ready -> paused (play can resume)', rp.state().mode === 'paused')

const ev2 = rp.step(2)
check('step(n) emits n bars and advances the cursor', ev2.length === 2 && rp.state().cursor === 3)
check('emitted eventTimes are monotonic (D18)', ev2[0].eventTime <= ev2[1].eventTime && ev2[1].eventTime <= rp.state().now)
check('clock gate opens exactly when the step reaches it', rp.canUse(mkBar(2).closeTime) === true && rp.canUse(mkBar(3).closeTime) === false)
check('quote() mirrors the paper executor shape { last, time }', rp.quote().last === mkBar(2).close && rp.quote().time === mkBar(2).closeTime)

check('play() -> playing', rp.play() === 'playing')
check('setSpeed accepts documented speeds', rp.setSpeed(10) === 10 && REPLAY_SPEEDS.includes(rp.state().speed))
check('§22.4 speeds include 0.25x…10x (0.25,0.5,1,2,5,10)', JSON.stringify([...REPLAY_SPEEDS]) === JSON.stringify([0.25, 0.5, 1, 2, 5, 10]))
let speedThrew = ''
try { rp.setSpeed(3) } catch (e) { speedThrew = e.message }
check('setSpeed rejects undocumented speeds', /speed must be one of/.test(speedThrew), speedThrew)
check('pause() -> paused', rp.pause() === 'paused')

const rp2 = createReplayPlayer({ symbol: 'BTCUSDT', timeframe: '1m', bars: rBars })
rp2.step(3)
check('DETERMINISM: same bars + same steps -> byte-identical events',
  JSON.stringify(rp2.takeEvents(0)) === JSON.stringify(rp.takeEvents(0)))

check('step through the end -> done', rp.step(10).length === 2 && rp.state().mode === 'done' && rp.state().cursor === 5)
check('stepping a finished session is idempotent (no throw, no event)', rp.step(1).length === 0 && rp.state().cursor === 5)
let doneThrew = ''
try { rp.play() } catch (e) { doneThrew = e.message }
check('play() on a finished session refuses', /finished/.test(doneThrew), doneThrew)
check('FUTURE HIDDEN after done: exactly total events, no more', rp.takeEvents(0).length === 5)

check('empty input refuses to create a player',
  (() => { try { createReplayPlayer({ symbol: 'BTCUSDT', timeframe: '1m', bars: [] }); return false } catch (e) { return /no closed bars/.test(e.message) } })())
check('forming-only input refuses (nothing replayable)',
  (() => { try { createReplayPlayer({ symbol: 'BTCUSDT', timeframe: '1m', bars: [mkBar(0, { state: 'forming' })] }); return false } catch (e) { return /no closed bars/.test(e.message) } })())

check('intervalToMs parses the trade timeframes', intervalToMs('1m') === 60_000 && intervalToMs('15m') === 900_000 && intervalToMs('1h') === 3_600_000)
check('intervalToMs refuses garbage', (() => { try { intervalToMs('x'); return false } catch { return true } })())
check('nextDelayMs divides the candle by the speed (1m @10x = 6s)', rp2.setSpeed(10) === 10 && rp2.nextDelayMs(intervalToMs('1m')) === 6_000 && rp2.setSpeed(1) === 1 && rp2.nextDelayMs(intervalToMs('1m')) === 60_000)

// =============================================================================
section('15. margin — margin used, leverage, account health (Phase 7P / v3 §17.1)')

const mLong = { dir: 1, qty: 0.5, entryPrice: 100, symbol: 'X', status: 'open' }
const mShort = { dir: -1, qty: 2, entryPrice: 50, symbol: 'Y', status: 'open' }

check('defaults: 20% initial margin = 5x leverage (matches gate maxLeverage)',
  MARGIN_DEFAULTS.initialMarginPct === 20 && leverageOf().ok === true && near(leverageOf().leverage, 5))
check('notional = |qty * entry|', near(positionNotional(mLong), 50) && near(positionNotional(mShort), 100))
check('margin locked = notional * 20%', near(initialMarginFor(mLong), 10) && near(initialMarginFor(mShort), 20))
check('maintenance = notional * 0.4%', near(maintenanceMarginFor(mLong), 0.2) && near(maintenanceMarginFor(mShort), 0.4))
check('model override: 10% initial -> 10x leverage, half the margin', near(initialMarginFor(mLong, { initialMarginPct: 10 }), 5) && near(leverageOf({ initialMarginPct: 10 }).leverage, 10))
check('bad notional never prices margin (qty 0 / entry<0)', positionNotional({ dir: 1, qty: 0, entryPrice: 100 }) === null && positionNotional({ dir: 1, qty: 1, entryPrice: -5 }) === null && initialMarginFor({ dir: 1, qty: 0, entryPrice: 100 }) === null)
check('leverageOf rejects out-of-range margin pct', leverageOf({ initialMarginPct: 0 }).ok === false)

const h1 = accountMarginHealth({ equity: 10_000, positions: [mLong] })
check('health: 10000 equity, one 10-margin position', h1.ok && near(h1.marginUsed, 10) && near(h1.freeMargin, 9990) && near(h1.utilizationPct, 0.1) && h1.liquidated === false, JSON.stringify(h1))
check('health: maintenance floor crossed -> liquidated', accountMarginHealth({ equity: 0.1, positions: [mLong] }).liquidated === true)
check('health: closed positions lock nothing', accountMarginHealth({ equity: 500, positions: [{ ...mLong, status: 'closed', pnlAbs: 4 }] }).marginUsed === 0)
check('health: unknown legacy docs are skipped, not fatal', accountMarginHealth({ equity: 500, positions: [{ status: 'open', qty: 'x', entryPrice: 'y' }] }).marginUsed === 0)
check('health: bad equity rejected', accountMarginHealth({ equity: 'oops', positions: [mLong] }).ok === false)

const envMargin = loadMarginConfig({ MRG_INITIAL_MARGIN_PCT: '50', MRG_MAINTENANCE_MARGIN_PCT: '1' })
check('env overrides margin pcts', envMargin.initialMarginPct === 50 && envMargin.maintenanceMarginPct === 1)
const badEnvMargin = loadMarginConfig({ MRG_INITIAL_MARGIN_PCT: '150' })
check('invalid env keeps the default', badEnvMargin.initialMarginPct === 20)

// =============================================================================
section('16. liquidation — liq price, triggers, forced-exit pricing (v3 §17.1)')

const liqLong = liquidationPrice(mLong)
check('LONG liq = entry * (1 - (init - mmr)/100)', liqLong.ok && near(liqLong.liqPrice, 80.4) && near(liqLong.marginUsed, 10) && near(liqLong.maintenanceMargin, 0.2), JSON.stringify(liqLong))
check('SHORT liq mirrors above the entry', near(liquidationPrice(mShort).liqPrice, 50 * (1 + (20 - 0.4) / 100)))
check('distance to the level from the safe side', near(liqLong.distancePctTo(90), (90 - 80.4) / 80.4 * 100, 1e-6), String(liqLong.distancePctTo(90)))
check('liquidationPrice rejects bad positions', liquidationPrice({ dir: 0, qty: 1, entryPrice: 100 }).ok === false && liquidationPrice({ dir: 1, qty: 0, entryPrice: 100 }).ok === false && liquidationPrice({ dir: 1, qty: 1, entryPrice: 0 }).ok === false)

check('LONG liquidated at/through the liq level', checkLiquidation(mLong, 80.4).liquidated === true && checkLiquidation(mLong, 79).liquidated === true)
check('LONG safe just above the level', checkLiquidation(mLong, 80.5).liquidated === false)
check('SHORT liquidated at/through, safe below', checkLiquidation(mShort, 59.8).liquidated === true && checkLiquidation(mShort, 59.7).liquidated === false)
check('number / {last} / two-sided quotes all give a mark', checkLiquidation(mLong, { last: 80 }).liquidated === true && checkLiquidation(mLong, { bid: 82, ask: 83 }).liquidated === false)
check('garbage quote -> NO_MARK', checkLiquidation(mLong, {}).ok === false)

const lfGap = liquidationFill(mLong, 79)
check('gapped LONG: fills at the WORSE current mark (min of liq/mark)', lfGap.ok && lfGap.kind === 'liquidation' && near(lfGap.exitPrice, 79 * (1 - 2 / 1e4)), JSON.stringify(lfGap))
check('  exit pays taker slippage + fee (same as a market exit)', lfGap.slippageBps === 2 && near(lfGap.fee, lfGap.exitPrice * 0.5 * (4 / 1e4)), String(lfGap.fee))
check('  realized = gross - open fees(0) - exit fee', near(lfGap.net, (lfGap.exitPrice - 100) * 0.5 - 0 - lfGap.fee, 1e-6), String(lfGap.net))

const lfTouch = liquidationFill(mLong, 80.4)
check('touch-level LONG: exits at the level, not better', lfTouch.ok && near(lfTouch.exitPrice, 80.4 * (1 - 2 / 1e4)), String(lfTouch.exitPrice))

const lfShort = liquidationFill(mShort, 70)
check('SHORT gapped UPWARD exits at the worse mark', lfShort.ok && near(lfShort.exitPrice, 70 * (1 + 2 / 1e4)), String(lfShort.exitPrice))
check('  short loss direction is negative PnL', lfShort.pnlAbs < 0 && near(lfShort.gross, (50 - lfShort.exitPrice) * 2, 1e-6))

check('mark not crossed -> NO_LIQUIDATION', liquidationFill(mLong, 100).ok === false)
check('open fees carry into the forced exit', near(liquidationFill({ ...mLong, fees: 0.4 }, 80.4).pnlAbs, liquidationFill(mLong, 80.4).pnlAbs - 0.4, 1e-6))
check('liquidationFill rejects garbage', liquidationFill({ dir: 0, qty: 1, entryPrice: 100 }, 80).ok === false && liquidationFill(mLong, {}).ok === false)

// =============================================================================
section('17. portfolio — account summary reports locked margin')

const sumP = accountSummary({
  base: 10_000,
  positions: [
    { ...mLong, status: 'open' },
    { dir: -1, qty: 1, entryPrice: 50, status: 'closed', pnlAbs: 5 },
  ],
  quotes: new Map([['X', { bid: 101, ask: 101.1 }]]),
})
check('accountSummary exposes marginUsed + freeMargin', sumP.marginUsed === 10 && sumP.freeMargin === sumP.equity - 10, JSON.stringify(sumP))
check('  equity includes realized + unrealized of the open leg', near(sumP.equity, 10_000 + 5 + (101 - 100) * 0.5, 1e-6), String(sumP.equity))

// =============================================================================
section('18. order — paper order state machine (§17.2, pure)')

import { createPaperOrder, transition, isActive, isTerminal, ORDER_STATES } from './order.mjs'

const o18 = createPaperOrder({
  clientOrderId: 'co_1', alertKey: 'ak_1', symbol: 'BTCUSDT', side: 'BUY',
  type: 'limit', qty: 2, price: 100, sl: 95, tps: [110], tf: '5m', account: 'default',
}, { now: 1000 })

const o18state = o18.status
check('createPaperOrder starts CREATED with intent fields', o18state === 'created' && o18.qty === 2 && o18.type === 'limit', o18state)
check('  idempotency key + dedupe back-ref ride the doc', o18.clientOrderId === 'co_1' && o18.alertKey === 'ak_1')
check('  empty ladder default is []; fill fields start clean', o18.filledQty === 0 && o18.fillPrice === null && o18.tps.length === 1)

const o18r1 = transition(o18, 'risk_approved', { now: 1100 })
check('created --risk_approved--> riskChecked', o18r1.ok && o18r1.order.status === 'riskChecked' && o18r1.order.riskCheckedAt === 1100, JSON.stringify(o18r1))

const o18r2 = transition(o18r1.order, 'queue', { now: 1200 })
check('riskChecked --queue--> pending (submittedAt stamped)', o18r2.ok && o18r2.order.status === 'pending' && o18r2.order.submittedAt === 1200)

const o18cancel = transition(o18r2.order, 'cancel', { by: 'terminal', reason: 'user', now: 1300 })
check('pending --cancel--> cancelled (by + reason + time)', o18cancel.ok && o18cancel.order.status === 'cancelled' && o18cancel.order.cancelBy === 'terminal' && o18cancel.order.cancelledAt === 1300)
check('  terminal refuses further moves (TERMINAL guard)', transition(o18cancel.order, 'fill', {}).code === 'TERMINAL')

const o18R = createPaperOrder({ ...o18, clientOrderId: 'co_2' }, { now: 1000 }) // second order, same logic
const o18p = transition(transition(o18R, 'risk_approved').order, 'queue')
const o18fill = transition(o18p.order, 'fill', { now: 1500, fill: { price: 101, qty: 2, fee: 0.8, slippageBps: 2 } })
check('pending --fill--> filled with measured fields', o18fill.ok && o18fill.order.status === 'filled' && o18fill.order.filledQty === 2 && o18fill.order.fillPrice === 101 && o18fill.order.fee === 0.8 && o18fill.order.filledAt === 1500)

const o18Rp = createPaperOrder({ ...o18, clientOrderId: 'co_3' }, { now: 1000 })
const o18pp = transition(transition(o18Rp, 'risk_approved').order, 'queue')
const o18part = transition(o18pp.order, 'partial', { fill: { price: 100.5, qty: 1.2 } })
check('pending --partial--> partiallyFilled, remainder stays live', o18part.ok && o18part.order.status === 'partiallyFilled' && o18part.order.filledQty === 1.2 && isActive(o18part.order.status))
const o18done = transition(o18part.order, 'fill', { now: 1600, fill: { price: 101, qty: 0.8, fee: 0.4 } })
check('  partiallyFilled --fill--> filled', o18done.ok && o18done.order.status === 'filled' && o18done.order.filledQty === 2 && o18done.order.filledAt === 1600)

const o18Re = createPaperOrder({ ...o18, clientOrderId: 'co_4' }, { now: 1000 })
const o18pe = transition(transition(o18Re, 'risk_approved').order, 'queue')
const o18exp = transition(o18pe.order, 'expire', { now: 9999 })
check('pending --expire--> expired (expiredAt stamped)', o18exp.ok && o18exp.order.status === 'expired' && o18exp.order.expiredAt === 9999)

const o18Rj = createPaperOrder({ ...o18, clientOrderId: 'co_5' }, { now: 1000 })
const o18rej = transition(o18Rj, 'reject', { reason: 'RISK_BUDGET' })
check('created --reject--> rejected (reason carried)', o18rej.ok && o18rej.order.status === 'rejected' && o18rej.order.rejectReason === 'RISK_BUDGET')

check('guards: fill needs positive price+qty (BAD_FILL)', transition(o18p.order, 'fill', { fill: { price: 101, qty: 0 } }).code === 'BAD_FILL')
check('guards: unknown event refused (ILLEGAL)', transition(o18p.order, 'flip').code === 'ILLEGAL')
check('guards: risk_approved is not legal from pending', transition(o18p.order, 'risk_approved').code === 'ILLEGAL')
check('guards: null order refused (NO_ORDER)', transition(null, 'fill').code === 'NO_ORDER')
check('helpers: ACTIVE = riskChecked/pending/partiallyFilled; terminal listed', isActive('pending') && !isActive('filled') && isTerminal('expired') && ORDER_STATES.length === 8)

// =============================================================================
section('19. paper fills — ledger record (v3 §18.5/§18.6/§26.5, pure)')

const lf1 = attemptFill(
  { type: 'market', side: 'BUY', qty: 2 },
  { bid: 100, ask: 100.5, bidQty: 5, askQty: 5, time: 0 },
  FILL_DEFAULTS, 1_000,
)
check('attemptFill exposes the fee RATE actually used', lf1.filledQty === 2 && lf1.feeRateBps === FILL_DEFAULTS.takerFeeBps && lf1.fee > 0, String(lf1.feeRateBps))
check('  eventTime carries the model reference clock (fresh quote, 0 age)', lf1.eventTime === 1_000 && lf1.latencyMs === 0)

const lf2 = attemptFill(
  { type: 'market', side: 'SELL', qty: 1 },
  { bid: 100, ask: 100.5, bidQty: 5, askQty: 5, time: 0 },
  FILL_DEFAULTS, 2_000, { role: 'maker' },
)
check('  maker role uses the maker rate', lf2.feeRateBps === FILL_DEFAULTS.makerFeeBps)

const fillDoc = buildFillRecord({
  fillId: 'fill_1', orderId: 'co_open_1', alertKey: 'ak_1', symbol: 'BTCUSDT',
  side: 'BUY', type: 'market', qty: 2, fillPrice: 100.52, fillQty: 2,
  feeRateBps: 4, feeAmount: 0.08, spreadAbs: 0.5, slippageBps: 2.5,
  latencyMs: 1_000, simLatencyMs: 150, signalTime: 500, decisionTime: 1_000, eventTime: 1_000,
})
check('buildFillRecord maps a measured execution into the ledger', fillDoc.fillId === 'fill_1' && fillDoc.orderId === 'co_open_1' && fillDoc.fillQty === 2 && fillDoc.feeAmount === 0.08)
check('  simulated latency (default 0) only ADDS, never invents', fillDoc.latencyMs === 1_150 && fillDoc.simLatencyMs === 150)
check('  model version stamps the doc (D1)', fillDoc.modelVersion === FILL_MODEL_VERSION && fillDoc.eventTime === 1_000)
check('  null-safe: absent measurements stay null, never a zero for price', (() => { const d = buildFillRecord({ fillId: 'fill_2', orderId: 'co_2', fillPrice: null, fillQty: null, latencyMs: null }); return d.fillPrice === null && d.slippageBps === null && d.feeAmount === null && d.latencyMs === 0 })())
check('  default fillId is a non-empty string when caller-supplied', typeof buildFillRecord({ orderId: 'co_3' }).fillId === 'string' && buildFillRecord({ orderId: 'co_3' }).fillId.length > 0)

// =============================================================================
section('20. paper account — §20 projection (pure, bites D12)')

import { accountProjection, utcDay } from './account.mjs'

const NOW20 = Date.parse('2026-10-09T15:00:00.000Z')
const pos = (over) => ({
  dir: 1, qty: 2, entryPrice: 100, entryTime: new Date('2026-10-08T10:00:00.000Z'),
  status: 'open', fees: 5, sl: 95, tps: [110], symbol: 'BTCUSDT', ...over,
})

check('utcDay is a UTC day string (D2)', utcDay(Date.parse('2026-10-09T23:00:00.000Z')) === '2026-10-09')

const a1 = accountProjection({
  base: 10_000, now: NOW20, accountId: 'default',
  positions: [
    { ...pos({ status: 'closed', exitTime: new Date('2026-10-09T11:00:00.000Z'), exitPrice: 110, pnlAbs: 18, pnlPct: 9 }) },
  ],
})
check('realized rides measured pnlAbs into balance', a1.balance === 10_018 && a1.realizedPnl === 18 && a1.initialBalance === 10_000, JSON.stringify(a1.balance))
check('  same-UTC-day closes land in dailyPnl', a1.dailyPnl === 18 && a1.lastActivityDay === '2026-10-09')
check('  no open positions -> unrealized null (nothing to mark)', a1.unrealized === null && a1.openPositions === 0)
check('  no losses yet -> drawdown 0 on the realized curve', a1.maxDrawdown === 0 && a1.drawdownBasis === 'realized')

const history = [
  { ...pos({ status: 'closed', exitTime: new Date('2026-10-09T10:00:00.000Z'), pnlAbs: 10 }) },
  { ...pos({ status: 'closed', exitTime: new Date('2026-10-09T12:00:00.000Z'), pnlAbs: -40 }) },
]
const a2 = accountProjection({ base: 10_000, now: NOW20, positions: history })
check('  losing curve: balance 9970, daily -30, maxDD 40 / 0.3996% of peak 10010', a2.balance === 9_970 && a2.dailyPnl === -30 && a2.maxDrawdown === 40 && a2.maxDrawdownPct === 0.3996, JSON.stringify(a2))

const a3 = accountProjection({
  base: 10_000, now: NOW20,
  positions: [
    { ...pos({}) }, // open LONG 2@100
  ],
  quoteFor: () => ({ bid: 101, ask: 101.5, last: 101.2, time: NOW20 }),
})
check('  open position with a quote marks unrealized (net of fees: -3)', a3.unrealized === -3 && a3.equity === a3.balance + a3.unrealized, JSON.stringify(a3))
check('  margin floor over the OPEN book (initial 20% -> 40 locked)', typeof a3.marginUsed === 'number' && a3.openPositions === 1 && a3.notional !== null)
check('  no quote for the OPEN position -> unrealized stays null (honest)', accountProjection({ base: 10_000, now: NOW20, positions: [{ ...pos({}) }] }).unrealized === null)

// =============================================================================
section('21. replay challenge — §22.5 scoring (pure, optional training mode)')

import { challengeLevels, challengeScore, scoreDecision, CHALLENGE_SIDES, CHALLENGE_MODEL_VERSION } from './challenge.mjs'

const rPos = (over) => ({ status: 'closed', dir: 1, qty: 1, entryPrice: 100, entryTime: 1_700_000_000_000, pnlAbs: 5, exitTime: 1_700_000_060_000, ...over })

check('challengeLevels LONG: SL below, TP above from the played close only', (() => {
  const r = challengeLevels('LONG', 100, { slPct: 2, tpPct: 4 })
  return r.ok === true && r.sl === 98 && r.tp === 104
})())
check('challengeLevels SHORT mirrors the levels', (() => {
  const r = challengeLevels('SHORT', 100, { slPct: 2, tpPct: 4 })
  return r.ok === true && r.sl === 102 && r.tp === 96
})())
check('challengeLevels rejects nonsense percentages (D12: nothing invented)', challengeLevels('LONG', 100, { slPct: 0 }).ok === false && challengeLevels('LONG', 100, { slPct: 101 }).ok === false && challengeLevels('LONG', 100, { slPct: 2, tpPct: 1 }).ok === false)
check('challengeLevels defaults to 2%/4% when percentages absent', (() => { const r = challengeLevels('LONG', 100, {}); return r.ok === true && r.sl === 98 && r.tp === 104 })())

const win = scoreDecision({ ts: 1_699_999_999_000, side: 'LONG' }, [rPos({})])
check('decision before an entryTime matches -> win from measured pnlAbs', win.outcome === 'win' && win.pnlAbs === 5, JSON.stringify(win))
check('open position -> pending (session still live)', scoreDecision({ ts: 1_699_999_999_000, side: 'LONG' }, [rPos({ status: 'open' })]).outcome === 'pending')
check('no matching position -> no_trade (rejected / not yet filled)', scoreDecision({ ts: 1_699_999_999_000, side: 'LONG' }, []).outcome === 'no_trade')
check('WAIT that preceded no position scores a clean wait', scoreDecision({ ts: 1_699_999_999_000, side: 'WAIT' }, []).outcome === 'no_trade')
check('WAIT that preceded a position stays pending', scoreDecision({ ts: 1_699_999_999_000, side: 'WAIT' }, [rPos({})]).outcome === 'pending')
check('scoreboard tallies wins/losses/waits + net pnl, stamped (D1)', (() => {
  const s = challengeScore([
    { ts: 1_699_999_999_000, side: 'LONG' },
    { ts: 1_700_000_200_000, side: 'SHORT' },
    { ts: 1_700_000_400_000, side: 'WAIT' },
  ], [
    rPos({ entryTime: 1_700_000_000_000, pnlAbs: 5 }),
    rPos({ entryTime: 1_700_000_300_000, dir: -1, pnlAbs: -3 }),
  ])
  // NOTE: no comma operator here — the boolean must be the value under test.
  return s.decisions === 3 && s.wins === 1 && s.losses === 1 && s.wait === 1 && s.pnlAbs === 2 && s.version === CHALLENGE_MODEL_VERSION && JSON.stringify(s)
})())
check('side registry is exactly LONG/SHORT/WAIT', JSON.stringify([...CHALLENGE_SIDES]) === JSON.stringify(['LONG', 'SHORT', 'WAIT']))

finish()
