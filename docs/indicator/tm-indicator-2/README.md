# TM Indicator 2 & TM Indicator Strategy Lab 2 (v2.1)

> **Next-Generation Quantitative Trading System & Multi-Asset Analysis Engine**  
> **Architecture:** Modular Pine Script v6 Build Toolchain (`tools/build.mjs`)  
> **Output Files:** `pine/dist/TM Indicator 2.pine` & `pine/dist/TM Indicator Strategy Lab 2.pine`  
> **Status:** v2.1 source implemented and locally built. TradingView compile/chart verification and out-of-sample validation are still **NOT TESTED** (see the regression checklist).

---

## 1. Tổng quan Dự án

**TM Indicator 2** là thế hệ nâng cấp toàn diện từ các phiên bản v1 nền tảng (`TM Indicator.pine`, `TM Signals.pine`, `TM XAU Signals 2.pine`). Dự án được thiết kế cho thị trường phái sinh (Futures) đa tài sản (Vàng XAU, Bitcoin BTC, Ethereum ETH, Liquid Altcoins). Mục tiêu là **kiểm định** chất lượng setup, tỷ lệ chạm TP1, Net Winrate và Net Expectancy — không phải một cam kết tăng hiệu năng khi chưa có báo cáo ngoài mẫu.

Hệ thống được phát triển song hành với bộ đôi script đồng bộ 100% logic:
1. **`TM Indicator 2.pine`:** Bản chỉ báo trực quan hóa tín hiệu, vùng cản, cấu trúc thị trường, cảnh báo Webhook JSON tự động hóa cho bot giao dịch.
2. **`TM Indicator Strategy Lab 2.pine`:** Bản chiến lược kiểm định tự động (Strategy Backtest) mô phỏng chính xác lệnh Limit/Market, quản lý dời dừng lỗ hòa vốn và chốt lời từng phần trên TradingView Strategy Tester.

---

## 2. 7 Trụ cột Kiến trúc (v2.0 baseline, giữ nguyên trong v2.1)

1. **Quản lý Vị thế Động (Dynamic Trade Management):**
   - **Auto Break-Even tại TP1:** Tự động dời SL về `Entry + Fee Buffer` ngay khi giá chạm TP1 (1.0R), chuyển đổi các lệnh suýt thắng bị quay đầu thành các lệnh lãi nhẹ (+0.35R), triệt tiêu hiện tượng "lãi thành lỗ".
   - **Trailing Stop sau TP2:** Khóa tối thiểu 1.0R và thả trôi lợi nhuận động bằng ATR hoặc Swing nến khi giá hướng tới TP3.
   - **Time-Decay / Stagnation Exit:** Cắt lệnh sớm nếu sau 15 nến giá không tiến triển quá 0.3R và động lượng thị trường suy kiệt.
2. **Khớp lệnh Thông minh (Smart Entry Execution):**
   - Hỗ trợ chuyển đổi giữa `Market on Confirm` và `Pullback Limit Entry` (đặt lệnh chờ tại 50% FVG, mép Order Block hoặc EMA Fast).
   - Rút ngắn khoảng cách SL 30%–50%, kéo các mốc TP lại gần hơn và tự hủy lệnh chờ nếu sau 5 nến không khớp hoặc giá đã chạm TP1 trước.
3. **Phân loại Trạng thái Thị trường (Market Regime Classifier):**
   - Nhận diện thời gian thực 3 trạng thái: `TRENDING`, `RANGING`, và `CHOPPY / SQUEEZE`.
   - Khóa hoàn toàn các lệnh đánh phá vỡ (Breakout/BOS) khi thị trường đang đi ngang nén chặt (nguyên nhân chính gây chuỗi thua liên tiếp).
4. **Bộ lọc Cản Ngang Phía Trước (Room-to-Left / Obstacle Gate):**
   - Đo khoảng cách từ Entry tới vùng kháng cự/hỗ trợ ngược chiều gần nhất.
   - Chặn lệnh (`BLOCKED_BY_OBSTACLE`) nếu cản cứng gần hơn khoảng cách tới TP1.
5. **Chống Mua/Bán Đuổi Cuối Sóng (Anti-Overextension Gate):**
   - Đo độ giãn của giá so với EMA 20 và biên độ nến tín hiệu.
   - Nếu giá đã chạy quá xa ($> 2.2 \times \text{ATR}$) hoặc nến giãn quá lớn ($> 2.5 \times \text{ATR}$), cấm vào lệnh Market trực tiếp và bắt buộc chuyển sang chờ hồi (Pullback Limit).
6. **Bộ lọc Dẫn dắt Liên thị trường (BTC Leader & Weekend Filter):**
   - Kiểm tra xung lực của BTC để bảo vệ lệnh ETH và Altcoin khỏi các nhịp xả bất ngờ của Bitcoin.
   - Nhận diện vùng thanh khoản mỏng cuối tuần trên Crypto để giảm rủi ro trượt giá.
7. **Đóng gói Tuple MTF & Dọn rác Bộ nhớ (Memory Optimization):**
   - Toàn bộ dữ liệu đa khung thời gian được gộp vào 5 hàm Tuple trong `request.security()`, triệt tiêu 100% Repainting.
   - Tự động dọn rác các đối tượng đồ họa (`box`, `line`, `label`) khi vùng giá đã bị xuyên thủng (mitigated).

---

## 3. Kiến trúc Module trong `pine/parts-tm/`

```text
pine/parts-tm/
├── 00_header.pine                   # Khai báo @version=6, {{DECL}}, {{SHARED}} và metadata
├── 01_inputs_and_profiles.pine      # Inputs, Asset Profiles, Toggles kiểm thử độc lập
├── 02_types_and_state_defs.pine     # Định nghĩa UDTs Pine v6 (Plan, Event, Regime, Gates, Stats)
├── 03_regime_and_volatility.pine    # ATR, BBW Squeeze, ADX & Market Regime Classifier
├── 04_structure_pa_liquidity.pine   # Swings, BOS, CHoCH, Sweeps, S/R, FVG, OB & Dọn rác
├── 05_momentum_volume_extension.pine# EMA stack, RSI, MACD, Volume VSA, VWAP & Overextension
├── 06_mtf_and_intermarket_tuple.pine# Đóng gói Tuple request.security, BTC Leader & Weekend
├── 07_obstacle_and_gates.pine       # Room-to-Left tới TP1, Obstacle Gate & Tổng hợp Gates
├── 08_adaptive_scoring_engine.pine  # LONG/SHORT side scores 0-100, direction margin, ablation A-E
├── 08b_entry_modes.pine             # Entry modes A (pullback), B (sweep reversal), C (range)
├── 09_plan_and_state_machine.pine   # Plan, sizing, state machine, reason codes & lifecycle funnel
├── 10_visuals_and_dashboard.pine    # Shapes, zones, lines & Compact/Advanced dashboard
├── 11_alerts.pine                   # Webhook JSON payload & alertcondition (cho Indicator, v2.1.0)
└── 11_strategy_exec.pine            # Thực thi strategy.entry / exit (cho Strategy Lab)
```

The two outputs share `pine/shared/tm-signal-quality.pine`, which owns the v2.1
scoring contract and reason-code labels so the indicator and the strategy cannot
drift apart.

---

## 3.1 v2.1 — Direction-Aware Scoring (P0) and Entry Modes (P1)

### Why v2.0 blocked SHORT by construction

v2.0 produced one signed `tm_rawScore` in `[-1, +1]`, then computed
`tm_score100 = 50 + raw * 50` and compared that single **quality** score with a
single no-trade threshold. A bearish raw score therefore produced a score below
`50`, which the quality gate classified as `NO TRADE`. SHORT could not reach the
SETUP level even with perfect bearish evidence.

### v2.1 contract

- Each feature group emits a signed value `f` in `[-1, +1]`.
- `longScore = 100 * Σ w * max(f, 0) / Σ w` and
  `shortScore = 100 * Σ w * max(-f, 0) / Σ w`.
  Both sides use the same weights, scale, thresholds and minimum quality.
- Direction is selected only when the selected side is above `tm_scr_noTrade`
  and the gap between sides is at least `tm_scoreMargin`; otherwise the state is
  `NO_DIRECTION` or `AMBIGUOUS_SETUP` and no trade is forced.
- Regime/volatility is **not** a directional feature: it drives the regime gate
  and the entry-mode selector. There is no hidden "choppy damping" multiplier.
- Risk gates remain independent. A high score never compensates for a failed
  RR, ATR, obstacle, liquidation or risk gate.

### Reason codes and dashboard

Every blocker emits a standardized code (`BLOCKED_REGIME`, `BLOCKED_MTF`,
`BLOCKED_OBSTACLE`, `BLOCKED_OVEREXTENSION`, `BLOCKED_RR`, `BLOCKED_NET_RR`,
`BLOCKED_COOLDOWN`, `BLOCKED_DAILY_LIMIT`, `BLOCKED_CIRCUIT_BREAKER`,
`BLOCKED_POSITION_OPEN`, ...). The dashboard has two modes:

- **Compact (default, 13 rows):** bias/regime, session (Asia/London/NY/Overlap & Hi-Lo), LONG/SHORT score, status, top
  block reason, active mode, entry plan, SL/TP, net RR, expectancy and the
  lifecycle funnel.
- **Advanced (34 rows):** every v1 diagnostic row plus side scores, direction
  margin, top reason, all blockers, active mode and score config/version.

### Entry modes

| Mode | Activation | Confirmation | Invalidation |
| :--- | :--- | :--- | :--- |
| **A — Trend Pullback** | Trending regime, HTF not opposed | Pullback into EMA/FVG/OB and close back with trend | Structure/flip or mode expiry |
| **B — Liquidity Sweep Reversal** | Sweep of PDL/PDH/session/equal level | Rejection/engulfing within `tm_modeSweepBars` | Close accepts beyond the swept extreme |
| **C — Range Mean-Reversion** | RANGING box wider than 1 ATR | Rejection at range edge, close back inside | Range break; disabled by default |

`tm_modeFilterOn` makes an active mode a **gate**, not a score bonus. Disable it
to reproduce the v2.0-style unconditional entries for comparison.

### Ablation configs

`tm_ablationMode` selects feature groups A-E for the v2.1 ablation protocol. It
only changes scoring weights; the execution gates remain the explicit toggles in
`TM · Eligibility Gates`, so an ablation cannot silently disarm safety rules.

---

## 3.2 Webhook Alert Contract (`tm2.signal.v2.1`)

Tín hiệu phát ra từ `TM Indicator 2.pine` đính kèm đầy đủ metadata phiên bản:

```json
{
  "version": "2.1.0",
  "schema": "tm2.signal.v2.1",
  "v": 2.1,
  "action": "BUY",
  "entryMode": "Mode A (Trend Pullback)",
  "sym": "BTCUSDT.P",
  "tf": "15",
  "p": 67800.5,
  "orderType": "Limit",
  "limitPx": 67650.0,
  "sl": 67100.0,
  "tp1": 68350.0,
  "tp2": 68900.0,
  "tp3": 69450.0,
  "score": 82,
  "tier": "STRONG",
  "regime": "TRENDING",
  "reasons": "EMA_PULLBACK,FVG,MTF_CONSENSUS",
  "time": "2026-10-19T14:30:00Z"
}
```

---

## 4. Hướng dẫn Lệnh Build & Sử dụng

### 4.1 Biên dịch từ CLI
```bash
# Biên dịch toàn bộ active targets trong project
npm run pine:build

# Biên dịch riêng TM Indicator 2
npm run pine:tm

# Biên dịch riêng TM Indicator Strategy Lab 2
npm run pine:tm-strat
```

### 4.2 Copy trực tiếp vào Clipboard để dán lên TradingView
```bash
# Copy TM Indicator 2 vào Clipboard
npm run pine:copy:tm

# Copy TM Indicator Strategy Lab 2 vào Clipboard
npm run pine:copy:tm-strat
```

---

## 5. Tài liệu Kỹ thuật Đi kèm

- [Bảng Tra cứu Toàn bộ Tham số Inputs & Presets](./INPUTS.md)
- [Audit Baseline & Bug Report](./audit-baseline.md)
- [Multi-Asset & Inter-Market Profiles](./asset-profiles.md)
- [Futures Risk Model & Mathematics](./futures-risk-model.md)
- [Ablation & Walk-Forward Protocol](./ablation-walkforward-protocol.md)
- [Regression Test Checklist](./regression-checklist.md)
- [Known Limitations & Platform Constraints](./known-limitations.md)
