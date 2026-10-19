# Price Action MTF — Đặc tả kỹ thuật & Hướng dẫn Build

Tài liệu này mô tả chi tiết kiến trúc tầng, luồng dữ liệu, thuật toán và các biện pháp bảo vệ chống repaint của bộ chỉ báo **`Price Action MTF`** (nguồn `pine/parts-price-action-mtf/`).

---

## 1. Bản đồ Module (`pine/parts-price-action-mtf/`)

Bộ mã nguồn bao gồm 14 file pine được tiền xử lý và ghép nối bởi `tools/build.mjs`:

```
pine/parts-price-action-mtf/
├── 00_header.pine       # Version header //@version=6, {{DECL}}, {{SHARED}}
├── 10_config.pine       # Toàn bộ tham số input (có toggle riêng từng tính năng)
├── 20_core.pine         # L1: ATR, Volume VSA, RelVol, OBV (slope array), EMA 20/50/200, Session
├── 30_structure.pine    # L2: Swing, HH/HL/LH/LL, BOS, CHoCH, MSS, Retest, Failed Breakout + B-P0-1 Mẫu hình giá
├── 40_liquidity.pine    # L3: PDH/PDL, PWH/PWL, Session Hi/Lo, Equal Hi/Lo, Sweep, Trendline 2 điểm
├── 50_zones.pine        # L4: S/R zones động, FVG (Fair Value Gap), Order Block
├── 60_candle.pine       # L5: Pin bar, Engulfing, Displacement + B-P0-2 (IB, Doji, 3S/3C), B-P1-1 Volume veto, B-P1-4 Streak
├── 70_indicators.pine   # L6: Bộ chỉ báo kỹ thuật phụ trợ (RSI, MACD, DMI/ADX, BBW, VWAP)
├── 75_mtf.pine          # L7: MTF Context (Context TF H4/D + Setup TF H1/M15)
├── 80_scoring_risk.pine # L8/L9: Chấm điểm 11 nhóm (0-100) + B-P0-3 Confluence 0-3, B-P1-2 Regime gate, B-P1-3 Measured move TP
├── 90_state.pine        # L10: Máy trạng thái quản lý vị thế (Open, TP1/2/3, SL, Win/Loss counters)
├── 91_strategy.pine     # Cầu nối lệnh Strategy Lab (chỉ có ở bản Backtest, skip:pa-mtf)
├── 95_viz.pine          # L11: Vẽ đồ họa overlay + Dashboard 2x27 (skip:pa-mtf-strategy ở phần volume pane)
└── 99_alerts.pine       # L12: Webhook JSON alerts và các alertcondition
```

---

## 2. Luồng dữ liệu và Nguyên tắc chống Repaint

### 2.1 Luồng tính toán
```
[20_core] ATR + Vol + EMA + Sessions
    │
    ├──→ [30_structure] Pivots → BOS/CHoCH/MSS → Patterns (DT/DB/HST/HSN)
    ├──→ [40_liquidity] PD/PW/Session levels → Sweeps → Trendlines
    ├──→ [50_zones] S/R zones + FVG + Order Blocks
    └──→ [60_candle] Pin / Engulfing / IB / Doji / 3S-3C (Volume veto + Streak)
            │
            ├──→ [70_indicators] Momentum + Volatility + Volume + Location
            └──→ [75_mtf] Context TF / Setup TF HTF bias
                    │
                    ▼
            [80_scoring_risk]
              - Tổng điểm 11 nhóm (0–100)
              - B-P0-3: Confluence Engine (0–3)
              - B-P1-2: Regime Gate (Trending / Ranging / Choppy)
              - B-P1-3: Risk Plan (SL, TP theo R hoặc Measured Move)
                    │
                    ▼
            [90_state] Quản lý vòng đời lệnh (Position Lifecycle)
                    │
                    ├──→ [91_strategy] Strategy Orders (Backtest Twin)
                    ├──→ [95_viz] Đồ họa trên chart + Dashboard 2x27
                    └──→ [99_alerts] Webhook JSON + alertcondition
```

### 2.2 Các chốt bảo vệ dữ liệu
1. **Không rò rỉ dữ liệu tương lai:** Mọi lệnh `request.security` ở MTF Context (`75_mtf.pine`) và Liquidity levels (`40_liquidity.pine`) đều truy xuất thanh nến trước đó `[1]` với tham số `lookahead = barmerge.lookahead_on`.
2. **Cổng nến đóng (Confirmed Only):** Tín hiệu vào lệnh, đẩy event vào buffer `pa_evtBuf`, và kích hoạt webhook alert đều đi qua cờ `pa_okBar = pa_confirmOnly ? barstate.isconfirmed : true`.
3. **Chống tràn bộ đệm lịch sử (RE10143):**
   - OBV Slope (`20_core.pine`) sử dụng mảng tĩnh `pa_obvHist` thay cho offset sâu `[pa_obvLen]`.
   - Neckline của mô hình giá (`30_structure.pine`) dùng mảng buffer nến `pa_lowBuf` / `pa_highBuf` giới hạn 1200 thanh, tính toán thông qua hàm lặp an toàn `f_bufMinLow` và `f_bufMaxHigh`.

---

## 3. Chi tiết triển khai các Afterfix

### 3.1 B-P0-1: Mẫu hình giá & Neckline Breakout
- Định nghĩa kiểu dữ liệu `PaPattern`:
  ```pine
  type PaPattern
      string kind      // DT / DB / HST / HSN
      string dir       // bull / bear
      float  a         // Đỉnh/đáy 1
      float  b         // Đỉnh/đáy 2 (hoặc đỉnh đầu với H&S)
      float  c         // Đỉnh/đáy 3 (cho H&S vai phải)
      float  neck      // Mức giá đường viền cổ (Neckline)
      int    aBar
      int    bBar
      int    cBar
      bool   broken    // Trạng thái đã phá vỡ
      int    brkBar
  ```
- **Điều kiện phát tín hiệu:** Chỉ khi `close` nến đóng phá vỡ đường `p.neck` và nến trước đó chưa phá. Đồng thời tính `pa_patHeight = math.abs(close - pa_patNeck)` để chuyển sang Risk Engine.

### 3.2 B-P0-2: Nến bổ sung theo phương pháp Nh Kiến Thức
- **Inside Bar:**
  ```pine
  bool pa_isInsideBar = high <= high[1] and low >= low[1]
  bool pa_ibBull = pa_cp_ibOn and high[1] <= high[2] and low[1] >= low[2] and close > high[1]
  bool pa_ibBear = pa_cp_ibOn and high[1] <= high[2] and low[1] >= low[2] and close < low[1]
  ```
- **Doji:**
  ```pine
  bool pa_isDoji   = pa_cp_dojiOn and pa_body <= pa_cp_dojiMax * pa_range
  bool pa_dojiBull = pa_isDoji and pa_loWick > pa_hiWick and close >= open
  bool pa_dojiBear = pa_isDoji and pa_hiWick > pa_loWick and close <= open
  ```
- **3 White Soldiers / 3 Black Crows:**
  Kiểm tra 3 nến liên tục cùng chiều, đóng cửa cao hơn/thấp hơn nến trước và thân nến của cả 3 thanh đều đạt tối thiểu $\ge 50\%$ biên độ (`pa_cp_strongBody`).

### 3.3 B-P0-3: Confluence Engine (Điểm 0–3)
- Gồm 3 cờ nhị phân độc lập:
  - `pa_cf1`: Trend khung lớn (Context TF hoặc Setup TF) đồng thuận với hướng dự kiến.
  - `pa_cf2`: Giá hiện tại chạm hoặc nằm trong vùng hỗ trợ/kháng cự/trendline/liquidity với sai số $\pm pa\_cfLevelTol \times \text{ATR}$.
  - `pa_cf3`: Có nến xác nhận hoặc tín hiệu phá vỡ cấu trúc/mô hình trong cửa sổ $pa\_cfBars$.
- Tổng điểm: `pa_confluenceScore = (pa_cf1 ? 1 : 0) + (pa_cf2 ? 1 : 0) + (pa_cf3 ? 1 : 0)`.
- Cổng lọc: `pa_okConfluence = not pa_cfOn or not pa_cfRequire3 or pa_confluenceScore >= 3`.

### 3.4 B-P1-1: Volume Veto
- Hệ số điều chỉnh:
  ```pine
  float pa_vVetoMul = pa_cp_volVetoOn ? (pa_volRatio >= pa_cp_volVetoR ? 1.0 : 0.4) : 1.0
  ```
- Áp dụng nhân trực tiếp vào điểm thưởng của Pin Bar và Engulfing.

### 3.5 B-P1-2: Regime Gate
- Phân loại 3 trạng thái thị trường dựa trên ADX và phần trăm Bollinger Band Width (BBW Percentile):
  - `TRENDING`: $\text{ADX} \ge pa\_regAdxTrend$ và không bị Squeeze.
  - `CHOPPY`: $\text{ADX} < pa\_regAdxChop$ hoặc BBW nằm trong vùng nén chặt (`pa_isSqueeze`).
  - `RANGING`: Thị trường tích lũy trong kênh giá.
- Quy tắc vào lệnh:
  - `CHOPPY`: Từ chối mọi điểm vào lệnh.
  - `RANGING`: Chỉ cho phép vào lệnh khi giá nằm gần biên S/R trong phạm vi $pa\_regRangeEdge \times \text{ATR}$.

### 3.6 B-P1-3: Chế độ Measured Move TP
- Khi người dùng chọn `pa_tpMode == "Measured move (B-P1-3)"`:
  - `mmDist` lấy từ độ cao mô hình giá `pa_patHeight` (nếu có breakout) hoặc biên độ giữa đỉnh/đáy gần nhất `math.abs(pa_lastHigh - pa_lastLow)`.
  - $\text{TP1} = \text{Entry} \pm 0.5 \times mmDist$.
  - $\text{TP2} = \text{Entry} \pm 1.0 \times mmDist$.
  - $\text{TP3} = \text{Entry} \pm 1.5 \times mmDist$.
  - Tự động dự phòng về tỷ lệ R truyền thống nếu `mmDist <= 0` và `pa_tpMmFallback == true`.

---

## 4. Kiến trúc Strategy Twin (`pa-mtf-strategy`)

1. Cả hai bản chia sẻ chung logic tính toán từ phần lõi.
2. Bản Strategy `Price Action MTF Backtest.pine`:
   - Khai báo: `strategy(..., overlay = true, pyramiding = 0, calc_on_order_fills = true, process_orders_on_close = true)`.
   - Cắt bỏ phần vẽ histogram Volume của pane dưới thông qua marker:
     ```pine
     // @part skip:pa-mtf-strategy
     plot(pa_showViz and pa_showVol ? pa_vol : na, "Volume", ...)
     // @part end
     ```
   - Nhận tín hiệu trực tiếp từ `pa_signal` và `pa_plan` trong file `91_strategy.pine` để phát lệnh `strategy.entry("Long")` / `strategy.entry("Short")` và đóng lệnh tại SL / TP2 qua `strategy.exit()`.
