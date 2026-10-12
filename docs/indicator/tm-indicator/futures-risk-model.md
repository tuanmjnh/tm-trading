# Futures Risk Model — Linear USDT-Margined Derivatives

This document specifies the quantitative risk architecture, margin rules, position sizing formulations, liquidation safety buffers, and execution drag assumptions implemented in the TM platform ecosystem (`TM Indicator` and `TM Indicator Strategy Lab`).

---

## 1. Scope & Primary Assumptions

1. **Contract Standard**: Linear USDT-margined perpetual futures (e.g., Binance USDⓈ-M, Bybit USDT Perpetual).
2. **Quote & Settlement Currency**: USDT (stablecoin collateral).
3. **Execution Modeling**:
   - Signal Review / Indicator mode: Evaluates bar closes (`barstate.isconfirmed`).
   - Strategy Lab / Execution simulation: Next-bar open fill assumption to avoid lookahead bias and intra-bar intra-candle execution illusions.
4. **Non-Guarantee Clause**: Simulated PnL, risk-adjusted returns, and risk-reward ratios are analytical estimates under idealized execution assumptions and do not constitute actual trade guarantees or live profitability forecasts.

---

## 2. Quantitative Mathematical Formulations

### 2.1 Capital & Risk Allocation per Trade

Given an account balance/equity $E$ (USDT) and user-defined risk percentage $R_{\%}$ (typically $1.0\% \le R_{\% } \le 2.0\%$):

$$\text{Risk Amount (USDT)} = E \times \frac{R_{\%}}{100}$$

Given entry price $P_{\text{entry}}$ and stop-loss price $P_{\text{sl}}$, the stop-loss distance $\Delta P_{\text{sl}}$ is:

$$\Delta P_{\text{sl}} = |P_{\text{entry}} - P_{\text{sl}}|$$

The theoretical contract unit size $Q_{\text{raw}}$ is determined strictly by the dollar risk budget:

$$Q_{\text{raw}} = \frac{\text{Risk Amount}}{\Delta P_{\text{sl}}} = \frac{E \times (R_{\%} / 100)}{|P_{\text{entry}} - P_{\text{sl}}|}$$

The notional exposure $N$ is:

$$N = Q_{\text{raw}} \times P_{\text{entry}}$$

---

### 2.2 Effective Leverage & Leverage Ceiling Gate

The effective portfolio leverage $L_{\text{eff}}$ resulting from the risk-based sizing is:

$$L_{\text{eff}} = \frac{N}{E} = \frac{P_{\text{entry}} \times R_{\%}}{100 \times \Delta P_{\text{sl}}}$$

If the market volatility is exceptionally low, $\Delta P_{\text{sl}}$ becomes tiny, which causes $L_{\text{eff}}$ to skyrocket beyond safe account constraints. To protect capital against black-swan gapping, an explicit ceiling $L_{\max}$ (e.g., $10\times$ or $20\times$) is enforced:

$$Q_{\text{capped}} = \min\left(Q_{\text{raw}}, \frac{E \times L_{\max}}{P_{\text{entry}}}\right)$$

If $L_{\text{eff}} > L_{\max}$, the trade eligibility risk engine either:
1. Downscales the position size to maintain $L_{\text{eff}} \le L_{\max}$ (Strategy Lab mode).
2. Rejects the signal under reason `MAX_LEVERAGE_EXCEEDED` if strict risk gating is enabled.

---

### 2.3 Margin Requirement & Liquidation Price Estimation

For an isolated position with initial leverage setting $L$:

$$\text{Initial Margin (IM)} = \frac{N}{L} = \frac{Q \times P_{\text{entry}}}{L}$$

With Maintenance Margin Rate ($\text{MMR}$, typically $0.4\% - 1.0\%$ depending on tier), the estimated bankruptcy/liquidation price $P_{\text{liq}}$ for linear USDT perpetual is:

- **For Long Positions**:
  $$P_{\text{liq, long}} = P_{\text{entry}} \times \left(1 - \frac{1}{L} + \text{MMR}\right)$$

- **For Short Positions**:
  $$P_{\text{liq, short}} = P_{\text{entry}} \times \left(1 + \frac{1}{L} - \text{MMR}\right)$$

#### Invalidation vs. Liquidation Safety Gate (`SL_PAST_LIQ`)
In professional futures risk management, an invalidation stop-loss must **always** trigger before account liquidation, with an additional safety buffer $\beta$:

- **Long Rule**: $P_{\text{sl}} \ge P_{\text{liq, long}} \times (1 + \beta)$
- **Short Rule**: $P_{\text{sl}} \le P_{\text{liq, short}} \times (1 - \beta)$

If the planned stop-loss is placed beyond the estimated liquidation threshold, the signal is immediately invalidated with the rejection code:
$$\text{Reason} = \text{"SL\_PAST\_LIQ"}$$

---

### 2.4 Frictional Drag: Fees, Slippage & Funding

Gross profits overestimate real-world alpha. The TM Risk Engine applies structural deductions:

1. **Exchange Fees**:
   - Limit entry (Maker): $0.02\%$
   - Stop-loss / Market exit (Taker): $0.05\% - 0.06\%$
   - Roundtrip fee: $\approx 0.07\% - 0.11\%$ of Notional Value.
2. **Execution Slippage**:
   - Liquid majors (BTC, ETH): $1 - 2$ ticks ($0.01\% - 0.02\%$).
   - Altcoins: $0.05\% - 0.20\%$.
   - High-volatility news events: up to $0.50\%$.
3. **Funding Rate Drag**:
   - Baseline perpetual funding: $0.01\%$ per 8-hour epoch ($3$ settlements/day).
   - Long positions paying positive funding over swing durations of $k$ bars:
     $$\text{Funding Drag} = N \times \text{Epochs Held} \times \text{Funding Rate}$$

#### Net Risk-Reward (Net RR) Adjustment:
$$\text{Net RR} = \frac{\Delta P_{\text{target}} \times Q - \text{Total Friction}}{\Delta P_{\text{sl}} \times Q + \text{Entry Friction}}$$

Signals where $\text{Net RR} < \text{Min RR}$ after factoring frictional drag are flagged as sub-optimal (`LOW_NET_RR`).

---

### 2.5 Circuit Breakers & Drawdown Protection

The state engine tracks performance across rolling daily and session windows:
- **Max Consecutive Losses**: If consecutive losses reach $N_{\text{losses}} \ge 3$, entry signals are blocked (`CONSECUTIVE_LOSS_PAUSE`) until manual review or the next calendar day.
- **Daily Drawdown Limit**: If accumulated daily losses exceed $D_{\text{max}} = 3.0\%$ of starting equity, all trading is suspended for the remainder of the session (`DAILY_DRAWDOWN_LIMIT`).

---

## 3. Configuration Matrix for Asset Classes

| Parameter | XAU (Spot/CFD) | BTC (Perp) | ETH (Perp) | Liquid Altcoin | High-Risk Altcoin |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Default Risk %** | $1.0\%$ | $1.0\%$ | $1.0\%$ | $0.75\%$ | $0.50\%$ |
| **Max Leverage Cap** | $20\times$ | $20\times$ | $15\times$ | $10\times$ | $3\times$ |
| **Maintenance Margin (MMR)** | $0.5\%$ | $0.4\%$ | $0.5\%$ | $1.0\%$ | $2.5\%$ |
| **Roundtrip Fee + Slippage** | $0.05\%$ | $0.08\%$ | $0.09\%$ | $0.14\%$ | $0.30\%$ |
| **Check Liquidation vs SL** | Enabled | Enabled | Enabled | Enabled | Enabled (Mandatory) |
| **Min Volume Gate** | N/A | Optional | Optional | Mandatory | Strict ($> 0$) |

---

## 4. Summary & Verification References

- **Indicator Implementation**: See `pine/parts-tm/10_config.pine`, `pine/parts-tm/80_scoring_risk.pine`, `pine/parts-tm/95_viz.pine`, and `pine/parts-tm/99_alerts.pine`.
- **Strategy Lab Implementation**: See `pine/dist/TM Indicator Strategy Lab.pine`.
- **Regression Checklist**: See `docs/indicator/tm-indicator/regression-checklist.md`.
