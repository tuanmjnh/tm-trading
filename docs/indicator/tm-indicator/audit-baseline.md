# Audit Baseline: TM XAU Signals 2.pine

> **Status:** Phase 0 Completed — Baseline Frozen & Audited
> **Reference Document:** [TM_Indicator_Roadmap.md](file:///d:/Applications/tm-trading/docs/indicator/tm-indicator/TM_Indicator_Roadmap.md)
> **Baseline File:** [TM XAU Signals 2.pine](file:///d:/Applications/tm-trading/pine/dist/TM%20XAU%20Signals%202.pine) (1,383 lines, Pine Script v6)
> **Source Parts:** `pine/parts-xau2/` + `pine/shared/`
> **Target Assembler:** `tools/build.mjs` (`npm run pine:xau2`)

---

## 1. Giới thiệu & Tuyên bố bảo toàn Baseline

Theo chỉ đạo tại Phase 0 của [TM_Indicator_Roadmap.md](file:///d:/Applications/tm-trading/docs/indicator/tm-indicator/TM_Indicator_Roadmap.md), mã nguồn gốc `TM XAU Signals 2.pine` (được assemble từ thư mục `pine/parts-xau2/`) được **đóng băng nguyên vẹn** làm mốc đối chứng (ground truth baseline). Không có bất kỳ thay đổi nào được thực hiện trực tiếp lên source gốc này.

**Tuyên bố trung thực kỹ thuật (Non-claim clause):**
- Toàn bộ kết luận trong tài liệu này xuất phát từ **static code review** chuyên sâu và đối soát cú pháp / logic Pine Script v6.
- Chưa thực hiện tải/biên dịch trực tiếp trên nền tảng TradingView Cloud Editor.
- Chưa thực hiện backtest hay tính toán tỷ lệ thắng/lợi nhuận thực tế. Mọi số liệu mô phỏng trong code gốc được xem là số liệu nội bộ của state machine, không phải kết quả kiểm định định lượng.

---

## 2. Bản đồ Module & Danh mục tính năng hoạt động (Active Feature Catalog)

Source `TM XAU Signals 2.pine` được phân chia thành 13 lớp (L0 -> L12):

| Layer | Tên module | File thành phần | Dòng trong dist | Mô tả chức năng & Trạng thái hiện tại |
|---|---|---|---|---|
| **L0** | Config | `pine/parts-xau2/10_config.pine` | 143–299 | Khai báo toàn bộ input, groups, toggles, weights và ngưỡng filter. |
| **L1** | Core Utilities | `pine/parts-xau2/20_core.pine` | 301–372 | ATR/ATR%, Volume VSA (Wilder RMA), RelVol, OBV (tính thủ công qua array), EMA stack (20/50/200), Pivots, Session detect. |
| **L2** | Market Structure | `pine/parts-xau2/30_structure.pine` | 374–548 | Pivot swing, HH/HL/LH/LL, BOS, CHoCH, MSS (displacement candle), Retest sau BOS, Failed Breakout, UDT `X2Event` buffer (tối đa 50 event). |
| **L3** | Liquidity & Location | `pine/parts-xau2/40_liquidity.pine` | 550–730 | PDH/PDL, PWH/PWL, Session High/Low, Equal Highs/Lows, Liquidity Sweep, Trendline 2 điểm (tính slope & touch count). |
| **L4** | Zones | `pine/parts-xau2/50_zones.pine` | 732–844 | S/R zones (pivot left/right, merge theo ATR), FVG (3 nến, check lấp gap), Order Block (dựa trên displacement), vẽ box ở bar cuối. |
| **L5** | Candle Patterns | `pine/parts-xau2/60_candle.pine` | 846–885 | Pin Bar, Engulfing, Displacement (body >= 1.5 ATR + vol spike), Rejection candle -> tính `x2_cpScore` trong [-1.0, +1.0]. |
| **L6** | Indicators Engine | `pine/parts-xau2/70_indicators.pine` | 887–932 | Nhóm theo chức năng: Trend (EMA stack), Momentum (RSI + MACD + DMI/ADX bình quân), Volatility (ATR regime + BB Width), Volume (RelVol + OBV slope + VSA), Location (VWAP + daily range position). |
| **L7** | MTF Context | `pine/parts-xau2/75_mtf.pine` | 934–949 | Context TF (Daily EMA 200) + Setup TF (H1 EMA 50) qua `request.security()`. |
| **L8** | Scoring Engine | `pine/parts-xau2/80_scoring_risk.pine` | 951–985 | 11 nhóm trọng số tổng 100, chuẩn hóa [-1, 1], chuyển đổi thành Score 0–100, phân loại NO TRADE / WEAK / SETUP / STRONG / A+. MTF VETO gate. |
| **L9** | Risk Engine | `pine/parts-xau2/80_scoring_risk.pine` | 987–1046 | `f_buildX2Plan()` tính Entry, SL, TP1, TP2, TP3. Bộ lọc cooldown, giới hạn lệnh trong ngày (`x2_maxDay`), `x2_confirmOnly`. |
| **L10** | State Machine | `pine/parts-xau2/90_state.pine` | 1048–1167 | Vòng đời lệnh: idle -> open -> theo dõi TP/SL -> timeout (> 300 nến) -> close -> deferred reset bar tiếp theo. Bộ đếm `x2_statTrades`, `x2_statWins`, `x2_statLosses`. |
| **L11** | Visualization | `pine/parts-xau2/95_viz.pine` | 1169–1336 | Shapes Entry, Labels Hit TP/SL, Box vùng SL/TP position, Plot EMA, Plot VWAP, Plot Volume pane, Bảng Dashboard 2 x 23 hàng. |
| **L12** | Alerts | `pine/parts-xau2/99_alerts.pine` | 1338–1376 | `alertcondition()` và lệnh `alert()` phát payload JSON (ENTRY, TAKE_PROFIT, STOP_LOSS, EVENT). |

---

## 3. Ma trận lỗi và rủi ro được kiểm chứng (Audit Issue Matrix)

### [P0-01] Điều kiện RR chặn 100% tín hiệu mặc định (Signal Suppression Bug)
- **Vị trí code:** `pine/dist/TM XAU Signals 2.pine` (dòng 273, 276, 1021–1023, 1045–1046); `pine/parts-xau2/80_scoring_risk.pine` (dòng 72–73, 95–96).
- **Hiện trạng:**
  ```pine
  // 10_config.pine
  x2_rr1   = input.float(1.0, "TP1 (R)", ...)
  x2_rrMin = input.float(1.5, "RR toi thieu", ...)

  // 80_scoring_risk.pine
  bool rrOk  = x2_rrMin <= 0.0 or x2_rr1 >= x2_rrMin
  bool valid = atrOk and dirOk and slOk and rrOk
  bool x2_signal = x2_plan.valid and x2_okFilter
  ```
- **Tác động:** Mặc định `x2_rrMin = 1.5`, trong khi `x2_rr1 = 1.0`. Biểu thức `1.5 <= 0.0 or 1.0 >= 1.5` cho kết quả `false` trên **toàn bộ các nến**. Do đó `valid` luôn `false`, `x2_signal` không bao giờ được kích hoạt. Người dùng không thấy bất kỳ tín hiệu nào xuất hiện nếu không chỉnh tay input `x2_rrMin` hoặc `x2_rr1`.
- **Nguyên nhân gốc:** Nhầm lẫn giữa tỷ lệ RR của mục tiêu khởi đầu (TP1 = 1.0R thường dùng để dời BE hoặc chốt một phần) với tỷ lệ RR tối thiểu của toàn bộ kế hoạch giao dịch (Target RR, ví dụ TP2 = 2.0R hoặc TP3 = 3.0R).
- **Hướng khắc phục (Phase 1):**
  1. Phân định rõ ràng: `x2_rrMin` áp dụng cho Target RR nào (ví dụ `target_rr = math.max(tp1, tp2, tp3)` hoặc cấu hình mục tiêu đánh giá).
  2. Bổ sung kiểm tra RR độc lập cho từng mốc TP, đảm bảo `tp1 < tp2 < tp3` theo hướng lệnh.
  3. Cung cấp thông báo giải thích lý do không đủ RR thay vì âm thầm loại bỏ.

---

### [P0-02] Dữ liệu MTF so sánh sai khung thời gian (Cross-Timeframe Mismatch)
- **Vị trí code:** `pine/dist/TM XAU Signals 2.pine` (dòng 941–946); `pine/parts-xau2/75_mtf.pine` (dòng 9–13).
- **Hiện trạng:**
  ```pine
  float x2_ctxEma = request.security(syminfo.tickerid, x2_ctxTf, ta.ema(close, x2_ctxLen)[1], lookahead = barmerge.lookahead_on)
  int   x2_ctxDir = not na(x2_ctxEma) ? (close > x2_ctxEma ? 1 : -1) : 0

  float x2_setupEma = request.security(syminfo.tickerid, x2_setupTf, ta.ema(close, x2_setupLen)[1], lookahead = barmerge.lookahead_on)
  int   x2_setupDir = not na(x2_setupEma) ? (close > x2_setupEma ? 1 : -1) : 0
  ```
- **Tác động:** Biến `close` trong `close > x2_ctxEma` là giá đóng cửa của **khung biểu đồ hiện tại** (ví dụ nến M5 hoặc M1), còn `x2_ctxEma` là đường EMA 200 của **khung bối cảnh** (ví dụ Daily hoặc H4).
  - So sánh giá LTF với đường trung bình HTF không phản ánh được xu hướng của chính khung HTF đó (HTF có thể đang downtrend với HTF close < HTF EMA, nhưng nhịp hồi M5 chạm vượt nhẹ lên trên EMA HTF sẽ làm hệ thống kết luận sai là HTF Bullish).
  - Thiếu đồng bộ tuple: HTF close và HTF EMA cần được tính toán và lấy về trong cùng một ngữ cảnh `request.security()`.
- **Hướng khắc phục (Phase 1):**
  1. Lấy đồng thời cả `close[1]` và `ema[1]` của HTF trong cùng một biểu thức `request.security(..., [close[1], ema[1]])`.
  2. Định nghĩa rõ xu hướng HTF là `htfClose > htfEma`. Nếu muốn kiểm tra tương quan giá hiện tại so với HTF EMA, phải tách thành một điều kiện riêng biệt có tên gọi minh bạch.
  3. Thống nhất chính sách bar đã đóng (`[1]`) để triệt tiêu repaint trên dữ liệu lịch sử.

---

### [P0-03] State Machine ghi nhận sai kết quả Timeout thành TP1 (State Accounting Error)
- **Vị trí code:** `pine/dist/TM XAU Signals 2.pine` (dòng 1135–1147); `pine/parts-xau2/90_state.pine` (dòng 89–101).
- **Hiện trạng:**
  ```pine
  if not closed and x2_posBars > 300
      closed     := true
      x2_evClose := true

  if closed
      x2_statTrades += 1
      x2_xEntry     := x2_posEntry
      x2_xSl        := x2_posSl
      x2_xDir       := x2_posDir
      x2_xBar       := x2_posBar
      x2_xExit      := x2_evSl ? x2_posSl : x2_evTp == 3 ? x2_posTp3 : x2_evTp == 2 ? x2_posTp2 : x2_posTp1
      x2_xR         := not na(x2_posRisk) and x2_posRisk > 0.0 ? (x2_xExit - x2_posEntry) * float(x2_posDir) / x2_posRisk : na
  ```
- **Tác động:** Khi lệnh bị timeout (`x2_posBars > 300`):
  - Biến `x2_evSl` là `false`.
  - Nếu lệnh chưa từng chạm bất kỳ TP nào (`x2_evTp == 0`), biểu thức gán `x2_xExit` rơi vào nhánh mặc định cuối cùng `: x2_posTp1`.
  - Giá đóng lệnh bị ghi nhận thành **TP1**, và `x2_xR` được tính thành **+1.0R**!
  - Lệnh hòa hoặc thua nhẹ do hết thời gian giữ lệnh lại bị thống kê thành **lệnh thắng 1R**, bóp méo hoàn toàn số liệu thống kê.
- **Vấn đề phân loại kết quả khác:**
  - `x2_statWins` chỉ tăng khi chạm TP3 (`hit3`), bỏ qua TP1 và TP2.
  - Xử lý cùng nến chạm cả SL và TP: code hiện tại ưu tiên SL (`hitSl and (hit1 or hit2 or hit3)` -> SL). Đây là chính sách bảo thủ hợp lệ nhưng cần được tài liệu hóa minh bạch.
- **Hướng khắc phục (Phase 1):**
  1. Thêm cờ `x2_evTimeout`, gán `x2_xExit := close` khi timeout xảy ra.
  2. Phân loại rõ kết quả đóng lệnh: `SL`, `TP1_EXIT`, `TP2_EXIT`, `TP3_EXIT`, `TIMEOUT`.
  3. Tính realized R thực tế dựa trên giá thoát thực tế (`close`), không gán mặc định về `x2_posTp1`.

---

### [P1-01] Điểm tổng hợp 0–100 là Heuristic Score, không phải Xác suất thắng (Probability Confusion)
- **Vị trí code:** `pine/dist/TM XAU Signals 2.pine` (dòng 970–975).
- **Hiện trạng:** `x2_score100` là tổ hợp tuyến tính có trọng số của 11 nhóm yếu tố.
- **Đánh giá:** Điểm số 75 hay 85 chỉ phản ánh mức độ đồng thuận của các chỉ báo kỹ thuật theo cấu hình trọng số, hoàn toàn không tương đương với 75% hay 85% xác suất thắng. Không được dùng thuật ngữ "win rate probability" khi chưa qua mô hình hiệu chuẩn (calibration) trên dữ liệu ngoài mẫu.

---

### [P1-02] Trọng số phiên (Session Weights) áp đặt cố định kiểu Ngoại hối/Vàng lên Crypto
- **Vị trí code:** `pine/dist/TM XAU Signals 2.pine` (dòng 366–372).
- **Hiện trạng:** Trọng số phiên chia theo Asia (0.2), London (0.6), NY (0.8), Overlap (1.0).
- **Đánh giá:** Logic này phù hợp với thị trường Vàng (XAU) hoặc Forex có giờ mở cửa cố định. Đối với Crypto giao dịch 24/7/365, áp đặt trọng số này sẽ làm giảm điểm vô lý vào các khung giờ cuối tuần hoặc phiên Á dù có setup cấu trúc đẹp. Cần cấu hình Session Neutral / Tắt khi áp dụng cho BTC/ETH/Altcoin.

---

### [P1-03] Thiếu mô hình chi phí Futures trong kế hoạch giao dịch
- **Vị trí code:** `pine/dist/TM XAU Signals 2.pine` (dòng 1001–1029).
- **Đánh giá:** Kế hoạch tính Entry/SL/TP thuần túy dựa trên biến động giá và ATR, chưa tính đến spread, phí taker/maker và slippage. Khi đòn bẩy cao, khoảng cách SL ngắn (ví dụ 0.5 ATR trên M1/M5) có thể bị ăn mòn đáng kể bởi phí giao dịch.

---

## 4. Kế hoạch chuyển đổi sang TM Indicator (Migration Plan)

Nhằm đảm bảo tính độc lập và khả năng hoàn tác:
1. **Bảo tồn baseline:** Giữ nguyên vẹn `TM XAU Signals 2.pine` và thư mục `pine/parts-xau2/`.
2. **Xây dựng module mới:** Tạo thư mục `pine/parts-tm/` và cấu hình build target mới `tm` xuất ra `pine/dist/TM Indicator.pine`.
3. **Tiến hành tuần tự theo Phase:**
   - **Phase 1:** Sửa toàn bộ lỗi tính đúng đắn (RR, MTF, State Machine).
   - **Phase 2:** Thiết kế asset profiles (XAU, BTC, ETH, Liquid Altcoin, High-Risk Altcoin, Custom) & Timeframe profiles.
   - **Phase 3:** Chuẩn hóa Price Action, indicators & scoring.
   - **Phase 4:** Xây dựng mô hình rủi ro Futures (USDT-margined).
   - **Phase 5:** Tách riêng Strategy Lab `TM Indicator Strategy Lab.pine`.
   - **Phase 6:** Thử nghiệm Ablation & Walk-forward.
   - **Phase 7:** Chuẩn hóa Alert & Paper trading engine.
   - **Phase 8:** Tài liệu hóa, Known Limitations & Changelog.
