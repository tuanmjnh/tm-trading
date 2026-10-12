# Changelog — TM Indicator

All notable changes to the TM Indicator project are documented in this file.
The project adheres to the roadmap established in `docs/indicator/tm-indicator/TM_Indicator_Roadmap.md`.

---

## [0.1.0] - Phase 0: Baseline Freeze & Code Audit
### Added
- Created `docs/indicator/tm-indicator/audit-baseline.md` documenting deep static audit findings of the baseline indicator `pine/dist/TM XAU Signals 2.pine`.
- Documented 3 P0 issues:
  1. **P0-01 (Signal Suppression via RR Bug):** `x2_rrMin = 1.5` vs `x2_rr1 = 1.0` blocking all signals by default.
  2. **P0-02 (Cross-Timeframe Mismatch):** LTF chart close compared against HTF EMA without tuple synchronisation.
  3. **P0-03 (State Machine Accounting Error):** Timeout after 300 bars erroneously credited as TP1 win.
- Active feature catalog mapping all 13 layers (L0 to L12).
- Non-claim disclaimer: Static review only, zero live compiles/backtests claimed.

### Preserved
- The baseline source in `pine/parts-xau2/` and `pine/dist/TM XAU Signals 2.pine` is frozen intact.

---

## [0.2.0] - Phase 1: Correctness Patches (RR, MTF, State Machine)
### Added
- Created `pine/parts-tm/` module containing updated source files for `TM Indicator.pine`:
  - `pine/parts-tm/00_header.pine`
  - `pine/parts-tm/10_config.pine`
  - `pine/parts-tm/20_core.pine`
  - `pine/parts-tm/30_structure.pine`
  - `pine/parts-tm/40_liquidity.pine`
  - `pine/parts-tm/50_zones.pine`
  - `pine/parts-tm/60_candle.pine`
  - `pine/parts-tm/70_indicators.pine`
  - `pine/parts-tm/75_mtf.pine`
  - `pine/parts-tm/80_scoring_risk.pine`
  - `pine/parts-tm/90_state.pine`
  - `pine/parts-tm/95_viz.pine`
  - `pine/parts-tm/99_alerts.pine`
- Registered build target `tm` in `tools/build.mjs` generating `pine/dist/TM Indicator.pine`.
- Added scripts `"pine:tm"` and `"pine:copy:tm"` to `package.json`.
- Added regression tests in `tools/smoke.mjs` for `TM Indicator.pine`.
- Created `docs/indicator/tm-indicator/regression-checklist.md` tracking all verification gates.

### Fixed
- **P0-01 (RR / Plan Validity):** Added `tm_rrTarget` ("TP2" default), evaluating `targetRR >= tm_rrMin`. Default TP2 (2.0R) >= 1.5R allows signals to be valid by default. Added side and non-zero distance checks for LONG and SHORT.
- **P0-02 (MTF Context & Hierarchy):** Replaced single value requests with tuple requests `[close[1], ta.ema(close, len)[1]]`. Context trend evaluated as `htfClose > htfEma`. Added timeframe hierarchy guard (`chart <= setup <= context`) with visual warning `TF_WARN` on invalid hierarchies.
- **P0-03 (State Machine & Position Lifecycle):** Fixed timeout exit price to use current bar `close` and compute actual realized R instead of falling back to TP1. Separated exit reasons: `EXIT_SL`, `EXIT_TP1`, `EXIT_TP2`, `EXIT_TP3`, `EXIT_TIMEOUT`. Counted timeouts separately from wins and losses.

---

## [0.3.0] - Phase 2: Asset & Timeframe Profiles
### Added
- Created `docs/indicator/tm-indicator/asset-profiles.md` detailing multi-asset profiles, crypto session neutrality, and timeframe validation rules.
- Implemented `tm_assetMode` with 7 modes: `Auto`, `XAU`, `BTC`, `ETH`, `Liquid Altcoin`, `High-Risk Altcoin`, `Custom`.
- Added automatic profile detection based on ticker symbols (`f_detectAsset()`).
- Added Crypto 24/7 Session Neutrality: `tm_cryptoSessionNeutral = true` avoids unfair session penalties on BTC/ETH/Altcoin trading.
- Added low-liquidity filter for `High-Risk Altcoin` blocking signals on zero or corrupted volume.
- Expanded timeframe options for Setup TF (`15, 30, 60, 240`) and Context TF (`60, 240, D, W, M`).
- Dashboard display updated to show active asset profile: `TM [<Profile>] <Ticker>`.
- Alert payload updated with `"profile": tm_activeProfile`.

---

## [0.4.0] - Phase 3: Price Action, Indicators & 3-Layer Scoring Eligibility
### Added
- Separated decision pipeline into 3 distinct layers:
  1. `Signal Score`: Heuristic 0–100 score + quality band (`WEAK`, `SETUP`, `STRONG`, `A+`).
  2. `Trade Eligibility`: Direction, min quality gate, MTF confirmation, cooldown, day limit, volume verification.
  3. `Risk Eligibility`: Valid Entry, SL, TP, non-zero risk distance, and target RR check.
- Added configurable quality gating input `tm_minQuality` (default `"SETUP"`), actively preventing `WEAK` signals from triggering trades unless explicitly permitted.
- Added granular `tm_noTradeReason` reporting why trade was rejected (visible directly on dashboard row 2: `NO_DIRECTION`, `QUALITY_BELOW_MIN`, `HTF_VETO`, `MTF_HIERARCHY`, `COOLDOWN_ACTIVE`, `MAX_DAY_LIMIT`, `LOW_LIQUIDITY`, etc.).
- Normalized all momentum and volume indicator groups via internal averaging before applying scoring weights to prevent double-counting collinear signals.

---

## [0.5.0] - Phase 4: Futures Risk Model & Liquidation Safety
### Added
- Created `docs/indicator/tm-indicator/futures-risk-model.md` specifying quantitative formulations for Linear USDT-Margined perpetual futures.
- Added position sizing based on risk amount: $Q = (E \times R_{\%}) / \Delta P_{\text{sl}}$.
- Added maximum leverage ceiling check (`tm_risk_maxLev`) rejecting over-leveraged orders (`MAX_LEV_EXCEEDED`).
- Implemented estimated liquidation price calculations for Long and Short positions.
- Added `SL_PAST_LIQ` safety gate ensuring stop-loss triggers with buffer before bankruptcy/liquidation.
- Factored roundtrip maker/taker fee and slippage into net risk-reward calculation (`netRR`), gating unviable trades (`LOW_NET_RR`).
- Implemented state machine consecutive loss tracker and Circuit Breaker (`CIRCUIT_BREAKER`).
- Extended dashboard to display leverage, estimated liquidation price, and net RR on row 23.

---

## [0.6.0] - Phase 5: Strategy Lab Dedicated Backtest Engine
### Added
- Created `pine/parts-tm/91_strategy.pine` and build target `'tm-strategy'` generating `pine/dist/TM Indicator Strategy Lab.pine`.
- Added scripts `"pine:tm-strat"` and `"pine:copy:tm-strat"` in `package.json`.
- Synchronized strategy engine directly with core indicator signal and risk calculations without redundant logic or lookahead leakage.
- Added strategy controls: Long Only, Short Only, Long + Short.
- Implemented flexible profit taking: TP1 (Conservative), TP2 (Balanced), TP3 (Runner), or Full Ladder (1/3 split across TP1, TP2, TP3).
- Added commission (0.06%) and slippage (1 tick) simulation.
- Added timeout exit logic after `tm_maxHoldBars` bars.

---

## [0.7.0] - Phase 6: Ablation Testing & Walk-Forward Protocol
### Added
- Created `docs/indicator/tm-indicator/ablation-walkforward-protocol.md` formalizing empirical testing methodology.
- Defined 5 ablation configurations: A (Baseline), B (Trend/Mom), C (Liq/Vol), D (MTF/Risk), E (Profiles).
- Enforced chronological partitioning (60% Train, 20% Validation, 20% Test) with strict anti-shuffle and anti-lookahead rules.
- Established walk-forward efficiency (WFE) and cost degradation sensitivity test standards.

---

## [0.8.0] - Phase 7: Webhook Alerts & Signal ID Deduplication
### Added
- Standardized alert webhook JSON with unique deduplication IDs: `f_sigId()`.
- Alert payload enriched with quantitative futures risk fields: `pos_size`, `notional`, `eff_lev`, `liq`, `net_rr`.
- Exit events (`TAKE_PROFIT`, `STOP_LOSS`, `TIMEOUT`) now attach the original `sig_id` to allow accurate trade reconstruction.
- Isolated `alertcondition()` calls with marker `// @part skip:tm-strategy` to maintain compliance with Pine Script v6 `strategy()` restrictions.

---

## [1.0.0-rc1] - Phase 8: Final Documentation & Release Candidate
### Added
- Created `docs/indicator/tm-indicator/tm-indicator-guide.md` with complete installation, configuration, dashboard interpretations, and rollback procedures.
- Created `docs/indicator/tm-indicator/known-limitations.md` detailing technical boundaries and non-simulated dimensions.
- Updated `docs/indicator/tm-indicator/regression-checklist.md` with comprehensive multi-phase verification records.
- Verified 100% green gate across `npm run verify` (9/9 targets built, 456 doc checks, 2,326 test suite passes).
