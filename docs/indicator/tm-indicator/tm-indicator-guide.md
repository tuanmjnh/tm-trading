# TM Indicator & Strategy Lab — User & Integration Guide

This guide provides operational and configuration instructions for `TM Indicator` (multi-asset analysis & alerts) and `TM Indicator Strategy Lab` (backtesting engine).

---

## 1. Quick Installation & Setup

1. **Build Scripts**:
   ```bash
   npm run pine:tm             # Builds pine/dist/TM Indicator.pine
   npm run pine:tm-strat       # Builds pine/dist/TM Indicator Strategy Lab.pine
   ```
2. **Copy to TradingView**:
   - For Indicator: Run `npm run pine:copy:tm` (copies `TM Indicator.pine` to clipboard) -> Open TradingView Pine Editor -> Paste & click **Add to chart**.
   - For Strategy Lab: Run `npm run pine:copy:tm-strat` -> Open Pine Editor -> Paste & click **Add to chart** to access Strategy Tester metrics.
3. **Rollback Policy**:
   - The frozen legacy baseline remains 100% intact at `pine/dist/TM XAU Signals 2.pine`. Run `npm run pine:copy:xau2` to revert instantly at any time.

---

## 2. Asset Profiles & Auto-Detection

The indicator supports 7 operational modes configured under **TM · Asset Profile**:

| Profile | Auto Detection Criteria | Volatility / ATR Multiplier | Crypto 24/7 Session | Volume Gate |
| :--- | :--- | :--- | :--- | :--- |
| **XAU** | `XAUUSD`, `GOLD` | ATR Min $0.5$, Max $3.0$ | Disabled (NY session focused) | Standard |
| **BTC** | `BTC`, `XBT` | ATR Min $0.5$, Max $3.5$ | Enabled (Score neutral 1.0) | Standard |
| **ETH** | `ETH` | ATR Min $0.5$, Max $3.5$ | Enabled (Score neutral 1.0) | Standard |
| **Liquid Altcoin** | `SOL`, `BNB`, `XRP`, etc. | ATR Min $0.8$, Max $4.0$ | Enabled (Score neutral 1.0) | Required |
| **High-Risk Altcoin** | Low market cap / illiquid pairs | ATR Min $1.0$, Max $5.0$ | Enabled (Score neutral 1.0) | Strict ($> 0$) |
| **Custom** | Manual override fallback | User-defined | User toggle | User toggle |

---

## 3. Timeframe Hierarchy & Validation Rules

To prevent timeframe inversion and data corruption, the engine enforces strict hierarchy:
$$\text{Entry TF (Chart)} \le \text{Setup TF} \le \text{Context TF}$$

- **Setup TF**: Options: `15`, `30`, `60`, `240` minutes.
- **Context TF**: Options: `60`, `240`, `D`, `W`, `M`.
- **Validation**: If `Chart TF > Setup TF` or `Setup TF > Context TF`, the engine flags `TF_WARN` on the Dashboard and disables MTF filtering to prevent biased calculations.

---

## 4. The 3-Layer Eligibility Architecture

Signals are decoupled into three independent validation layers:
1. **Signal Score (0–100)**: Composite technical momentum, structure, liquidity, and location score.
2. **Trade Eligibility**: Structural market filters (Cooldown, Daily Trade Limit, Minimum Quality, MTF alignment, Volume presence, Circuit Breaker).
3. **Risk Eligibility**: Risk-reward geometry, leverage ceiling, and liquidation price buffer.

A trade executes **only when**:
$$\text{Signal} = \text{Bar Confirmed} \land \text{Trade Eligible} \land \text{Risk Eligible}$$

### No-Trade Reason Codes Matrix:
- `NO_DIRECTION`: Market is in consolidation or score is neutral ($50$).
- `QUALITY_BELOW_MIN`: Score did not reach the threshold set in `tm_minQuality` (`WEAK`, `SETUP`, `STRONG`, `A+`).
- `HTF_VETO`: Context timeframe trend contradicts entry direction.
- `MTF_HIERARCHY`: Chart timeframe is larger than setup/context timeframe.
- `SETUP_TF_FILTER`: Setup timeframe trend is opposing.
- `COOLDOWN_ACTIVE`: Less than `tm_coolBars` elapsed since prior entry.
- `MAX_DAY_LIMIT`: Reached daily limit of trades (`tm_maxDay`).
- `LOW_LIQUIDITY`: Volume is zero or below moving average on high-risk pairs.
- `CIRCUIT_BREAKER`: Reached maximum consecutive losses (`tm_risk_maxLosses`).
- `LOW_RR`: Risk-reward ratio below threshold (`tm_rrMin`).
- `MAX_LEV_EXCEEDED`: Required position size requires leverage exceeding `tm_risk_maxLev`.
- `SL_PAST_LIQ`: Stop-loss is positioned beyond the estimated liquidation price.
- `LOW_NET_RR`: Net risk-reward after estimated roundtrip fees and slippage is insufficient.

---

## 5. Webhook Alerts Payload Specification

Every alert emits standardized JSON with unique deduplication IDs:

```json
{
  "project": "TM Indicator",
  "v": 1,
  "ts": "2026-10-12T13:45:00.000Z",
  "exchange": "BINANCE",
  "symbol": "BTCUSDT.P",
  "tf": "15",
  "action": "ENTRY",
  "sig_id": "TM_BTCUSDT.P_15_1791812700000_L",
  "side": "LONG",
  "profile": "BTC",
  "price": 68450.50,
  "sl": 67800.00,
  "tps": [69101.00, 69751.50, 70402.00],
  "score": 82,
  "quality": "STRONG",
  "atr": 435.20,
  "pos_size": 0.1537,
  "notional": 10520.84,
  "eff_lev": 1.05,
  "liq": 3450.00,
  "net_rr": 1.92
}
```

---

## 6. Verification & Linting References

- **Futures Risk Specification**: See `docs/indicator/tm-indicator/futures-risk-model.md`.
- **Ablation Protocol**: See `docs/indicator/tm-indicator/ablation-walkforward-protocol.md`.
- **Regression Test Matrix**: See `docs/indicator/tm-indicator/regression-checklist.md`.
- **Known Limitations**: See `docs/indicator/tm-indicator/known-limitations.md`.
