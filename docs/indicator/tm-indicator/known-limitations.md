# Known Limitations & Boundary Constraints — TM Indicator

This document enumerates the known architectural boundaries, technical limitations, and non-simulated dimensions in `TM Indicator` and `TM Indicator Strategy Lab`.

---

## 1. TradingView & Pine Script v6 Constraints

1. **Static Analysis vs. Realtime Execution**:
   - Offline verification via `npm run verify` ensures lexical, syntactic, type-signature, and structural correctness against `tools/pine-ref.json`.
   - Realtime compilation in TradingView occurs in a cloud runtime and depends on Pine credit quotas and account limits (max 500 boxes/lines/labels).
2. **Dynamic Request Latency**:
   - MTF data fetches utilize `request.security()`. In historical bars, HTF bars are static snapshots (`barstate.isconfirmed`). In realtime tick evaluation, HTF calculations depend on server update intervals.
3. **Absence of Native Live Funding Rate Feeds**:
   - Pine Script v6 does not expose live exchange perpetual funding rates via standard price series. Funding cost drag in the risk model is an analytical estimate ($0.01\%$/8h) rather than a live exchange query.

---

## 2. Order Execution & Slippage Realities

1. **Intra-Bar High/Low Sequence Uncertainty**:
   - In standard historical bars where a bar's Range touches both SL and TP, the state machine adopts a strictly conservative policy prioritizing **Stop-Loss first**. Live market microstructures may occasionally hit TP first, but assuming TP first would introduce optimistic survivorship bias.
2. **Liquidity Cascades & Gapping**:
   - Stop-loss execution in Strategy Lab assumes execution at the exact stop price or next-bar open. In flash crashes or illiquid altcoins, real market stop orders slip substantially below the stop trigger.
3. **No Direct Broker/Exchange Execution**:
   - The indicator and strategy lab are analytical decision-support tools emitting alerts. They do not execute real market trades or manipulate exchange accounts.

---

## 3. Statistical & Methodological Boundaries

1. **Indicator State Machine vs. Strategy Tester**:
   - The indicator dashboard displays simulated trade statistics (`W-L-TO`) computed sequentially on bar close. Strategy Lab leverages TradingView's proprietary `strategy()` engine with separate accounting for margin and cash. Minor divergence in trade counts may occur due to tick-level order matching.
2. **Non-Guarantee of Future Alpha**:
   - Past performance across historical samples does not guarantee future market behavior. Market regime shifts can degrade technical edge over time.
