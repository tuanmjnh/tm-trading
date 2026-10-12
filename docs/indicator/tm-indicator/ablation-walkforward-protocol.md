# Ablation Testing & Walk-Forward Validation Protocol

This document establishes the empirical validation framework, feature ablation architecture, chronologically partitioned out-of-sample testing, and walk-forward analysis protocol for `TM Indicator` and `TM Indicator Strategy Lab`.

---

## 1. Experimental Feature Configurations (Ablation Matrix)

To measure the true incremental marginal utility (alpha contribution) of each subsystem and eliminate spurious indicator clutter, the strategy is decomposed into 5 progressive configurations:

| Configuration ID | Designation | Active Modules | Hypothesis |
| :--- | :--- | :--- | :--- |
| **A (Baseline)** | Price Action & Market Structure | Swing Pivots, BOS, CHoCH/MSS, S/R Zones | Pure market geometry provides baseline directionality without lagging indicator distortion. |
| **B (Trend/Mom)** | Trend & Momentum Gating | Config A + EMA Triplet Stack (20/50/200), RSI, MACD, ADX/DMI | Trend alignment reduces whipsaws in counter-trend ranges; momentum prevents entering exhausted extensions. |
| **C (Liq/Vol)** | Liquidity & Volume Dynamics | Config B + Liquidity Sweeps, VSA 6-Bucket Volume, OBV, VWAP | Institutional volume confirmation eliminates low-participation fakeouts. |
| **D (MTF/Risk)** | MTF Alignment & Futures Risk | Config C + MTF Tuple Context (H1/H4/D) + HTF VETO + Futures Margin / Circuit Breaker | Multi-timeframe confluence and liquidation-aware risk gating improve expectancy and protect drawdown. |
| **E (Profiles)** | Asset & Session Specialization | Config D + Dedicated Asset Profiles (XAU, BTC, ETH, Altcoins) + Crypto 24/7 Session Neutrality | Tailoring volatility thresholds and session sensitivity to asset class behavior maximizes risk-adjusted consistency. |

> **Methodological Principle**: Configuration E is an experimental hypothesis, not an automatic guarantee of superior performance. If Configuration B or C yields higher walk-forward stability with lower complexity, the simpler architecture must be preferred (Occam's razor).

---

## 2. Chronological Data Partitioning (Strict Anti-Lookahead)

Under rule **D2** and time-series validity standards:
- **Zero Shuffling**: Random cross-validation (K-Fold with random splitting) is **strictly prohibited** due to temporal autocorrelations and lookahead leakage.
- **Split Proportions**:
  1. **In-Sample / Development (60%)**: Used for exploratory parameter calibration.
  2. **Validation / Tuning (20%)**: Used for hyperparameter selection across limited discrete choices.
  3. **Out-of-Sample / Test (20%)**: Sealed vault data evaluated once. No further tweaking allowed.

```
Timeline: |====== In-Sample (60%) ======|=== Validation (20%) ===|=== Out-of-Sample Test (20%) ===|
          [ Calibrate baseline params ]   [ Select best profile ]   [ Unseen Forward Verification ]
```

---

## 3. Walk-Forward Analysis Protocol

To detect over-optimisation and parameter drift:

1. **Anchored vs. Rolling Windows**:
   - Rolling Window: In-Sample 6 months, Out-of-Sample forward test 2 months, rolled forward sequentially across 4 distinct market regimes.
2. **Regime Distribution**:
   - Bull Market Regime (e.g., strong trend, low volatility expansion).
   - Bear Market Regime (e.g., sharp cascades, high volatility spikes).
   - Ranging / Consolidation Regime (e.g., choppy sideways price action).
3. **Walk-Forward Efficiency (WFE)**:
   $$\text{WFE} = \frac{\text{Annualized Return (OOS)}}{\text{Annualized Return (IS)}} \times 100$$
   - A healthy strategy maintains $\text{WFE} \ge 50\%$. If $\text{WFE} < 30\%$, the configuration suffers from severe overfitting.

---

## 4. Sensitivity & Friction Stress Testing

Every test run must be submitted to cost degradation sweeps:

1. **Exchange Fee Degradation**:
   - Low: $0.02\%$ (Maker) / $0.05\%$ (Taker).
   - Standard: $0.06\%$ flat.
   - High: $0.10\%$ flat.
2. **Execution Slippage Sweeps**:
   - $0$ ticks (unrealistic baseline).
   - $1$ tick (liquid majors).
   - $3 - 5$ ticks (volatile altcoins).
3. **Funding Rate Drag**:
   - Baseline: $0.01\%$ per 8-hour epoch ($3$ settlements/day).

---

## 5. Reporting Standard

The empirical report must tabulate:
- Trade sample size $N$ (tests with $N < 30$ are marked statistically inconclusive).
- Win Rate $\%$, Profit Factor (PF), Expectancy in R ($E_R$).
- Max Drawdown ($\%$ and Duration in bars).
- Realized R distribution (Average Win $R$, Average Loss $R$, Timeout rate).
- Long vs. Short balance.

---

## 6. Execution Command References

To build and copy the dedicated Strategy Lab for TradingView backtesting:
```bash
npm run pine:tm-strat        # Build TM Indicator Strategy Lab.pine
npm run pine:copy:tm-strat   # Build and copy directly to system clipboard
npm run verify               # Run full verification gate
```
