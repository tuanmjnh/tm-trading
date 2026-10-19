# TM Indicator 2 — Roadmap Nâng Cấp Hệ Thống Phân Tích Đa Tài Sản / Đa Khung Thời Gian (v2.0 - Winrate & Modular Build Optimized)

> **Mục đích tài liệu:** Đây là tài liệu nguồn duy nhất (Single Source of Truth) để AI coding agent và Quantitative Systems Architect audit, lập kế hoạch, kiến trúc hóa các module và nâng cấp hệ thống Pine Script hiện tại từ các bản v1 (`TM Indicator.pine`, `TM Signals.pine`, `TM XAU Signals 2.pine`) lên phiên bản hoàn chỉnh thế hệ mới: **`TM Indicator 2.pine`** (kèm script kiểm định chiến lược **`TM Indicator Strategy Lab 2.pine`**).
>
> **Đặc thù kiến trúc Project (QUY TẮC BẮT BUỘC):**
> Project này **TUYỆT ĐỐI KHÔNG** sửa trực tiếp trên các file đơn lẻ trong `pine/dist/`. Toàn bộ mã nguồn được chia thành các module độc lập trong `pine/parts-tm2/` và `pine/shared/`, sau đó được đóng gói (bundle) thông qua công cụ `node tools/build.mjs` để xuất ra `pine/dist/`. Mọi thay đổi trực tiếp trong `dist/` sẽ bị ghi đè khi chạy `npm run pine:build`.

---

## 1. Tầm Nhìn, Hiện Trạng & Mục Tiêu Nâng Cấp

### 1.1 Hiện trạng hệ thống
- Hệ thống nền tảng hiện tại trong `pine/dist/` được build từ các thư mục module tương ứng:
  - `TM Indicator.pine` & `TM Indicator Strategy Lab.pine` (build từ `pine/parts-tm/` và `pine/shared/`).
  - `TM Signals.pine` & `TM Backtest.pine` (build từ `pine/parts/` và `pine/shared/`).
  - `TM XAU Signals 2.pine` (build từ `pine/parts-xau2/` và `pine/shared/`).
- Nhược điểm của bản v1: Winrate thực tế bị giới hạn do thiếu bộ lọc trạng thái thị trường (Market Regime), vào lệnh đuổi giá (Chasing Breakout) khi thị trường đã giãn quá xa EMA/VWAP, thiếu cơ chế tự động bảo toàn lợi nhuận (Auto Break-Even tại TP1), và không xử lý tốt sự khác biệt về thanh khoản giữa các lớp tài sản.
- Mục tiêu của **v2.0**: Đẩy mạnh **Winrate thực tế (Net Trade Winrate)**, **Tỷ lệ chạm TP1 (TP1 Hit Rate)** và **Kỳ vọng toán học (Expectancy)** trong môi trường Futures đa tài sản (XAU, BTC, ETH, Altcoin) mà vẫn bảo toàn 100% các thành phần trực quan (Visuals) quen thuộc của bản v1.

### 1.2 Phạm vi tài sản (Multi-Asset Futures)
- **XAU:** Vàng (`XAUUSD` / `XAUUSDT` hoặc tương đương). Ưu tiên bẫy thanh khoản phiên (London/NY Open Sweep) và biến động tin tức.
- **BTC:** Hợp đồng tương lai BTC (USDT-margined). Đóng vai trò kim chỉ nam (Leader) cho toàn bộ hệ sinh thái Crypto.
- **ETH:** Hợp đồng ETH futures, xét tương quan động lượng trực tiếp với BTC.
- **Liquid Altcoin:** Các đồng Altcoin top đầu (SOL, BNB, XRP...) có thanh khoản cao. Tín hiệu LONG bị chặn nếu BTC đang xả mạnh và tín hiệu SHORT bị chặn nếu BTC đang bơm mạnh.
- **High-Risk / Low-Liquidity Altcoin:** Cảnh báo rủi ro cao, tự động nâng ngưỡng điểm vào lệnh (`tm_scr_minEntry`) và kích hoạt bộ lọc cuối tuần (Weekend Low-Liquidity Filter).

### 1.3 Phạm vi khung thời gian (Multi-Timeframe Hierarchy)
- **Khung vào lệnh (Entry TF):** M1, M3, M5, M15.
- **Khung thiết lập (Setup TF):** M15, M30, H1, H4.
- **Khung bối cảnh (Context TF):** H1, H4, D, W.
- **Ràng buộc thứ bậc:** $\text{Entry TF} \le \text{Setup TF} \le \text{Context TF}$. Mọi vi phạm thứ bậc sẽ kích hoạt cảnh báo `TF_WARN` trên bảng Dashboard.

### 1.4 7 Trụ cột nâng cấp cốt lõi trong TM Indicator 2
1. **Dynamic Trade Management (Quản lý vị thế động):**
   - **Auto Break-Even tại TP1:** Tự động dời SL về `Entry +/- Fee Buffer` ngay khi giá chạm TP1, triệt tiêu rủi ro lệnh đang lãi quay đầu thành lỗ đầy đủ ($1R$).
   - **Structure / ATR Trailing Stop sau TP2:** Khóa tối thiểu $1R$ lợi nhuận khi giá chạm TP2 và bám theo cấu trúc nến để đón sóng lớn tại TP3.
   - **Time-Decay / Stagnation Exit:** Đóng sớm các lệnh dậm chân tại chỗ quá $M$ nến mà không bứt phá để giải phóng vốn.
2. **Smart Entry Execution (Thực thi điểm vào lệnh thông minh):**
   - Hỗ trợ cả 2 chế độ: `Market on Confirm` (vào ngay khi đóng nến xác nhận) và `Pullback Limit Entry` (đặt lệnh chờ tại FVG 50%, mép Order Block hoặc Fast EMA).
   - Rút ngắn khoảng cách Stop Loss từ 20% đến 40%, kéo TP1 lại gần hơn và gia tăng mạnh tỷ lệ chạm TP1.
3. **Market Regime Classifier (Phân loại trạng thái thị trường):**
   - Phân loại thị trường theo thời gian thực: `TRENDING`, `RANGING (Mean-Reversion)`, và `CHOPPY / SQUEEZE`.
   - Khóa hoàn toàn các lệnh đánh Breakout/BOS khi thị trường đang đi ngang biên hẹp hoặc nén biến động (Choppy Squeeze).
4. **Room-to-Left / Obstacle Gate (Bộ lọc cản ngược chiều phía trước):**
   - Đo khoảng cách từ `Entry` tới vùng cản ngược chiều gần nhất (S/R chưa gãy, Order Block đang hoạt động, PDH/PDL, PWH/PWL).
   - Nếu `Distance_to_Obstacle < Distance_to_TP1 * 0.7`, chặn lệnh (`BLOCKED_BY_OBSTACLE`) để tránh mua đỉnh bán đáy.
5. **Anti-Overextension / Exhaustion Gate (Chống đuổi giá cuối sóng):**
   - Đo độ lệch của giá so với EMA trung tâm theo ATR: $\text{Extension} = \frac{\vert\text{Close} - \text{EMA}\vert}{\text{ATR}}$.
   - Chặn vào lệnh Market trực tiếp khi giá đã giãn nở quá đà ($> \text{Max\_Extension\_ATR}$) và buộc chuyển sang lệnh chờ Pullback.
6. **Inter-Market & Session Intelligence (Tương quan thị trường & Phiên giao dịch):**
   - **BTC Leader Filter:** Altcoin LONG bị chặn nếu BTC dumping; Altcoin SHORT bị chặn nếu BTC pumping.
   - **Weekend & Session Filter:** Cảnh báo thanh khoản mỏng cuối tuần trên Crypto và tách biệt hành vi phiên Á, London, New York.
7. **Pine Script v6 Tuple MTF & Bộ nhớ tối ưu:**
   - Đóng gói toàn bộ biến đa khung vào tối đa 5 lệnh `request.security()` dạng Tuple không repaint (`lookahead_on` trên offset `[1]`).
   - Tự động dọn rác (Garbage Collection) cho các đối tượng vẽ `box`, `line`, `label`.

---

## 2. Khắc Phục 3 Lỗi Logic Nghiêm Trọng (Critical Bug Fixes)

Trong quá trình đối soát giữa bản v1 và bản dựng thử nghiệm v2, 3 lỗi logic nghiêm trọng làm khóa chết hoặc ẩn tín hiệu đã được nhận diện và xử lý triệt để:

| Mã Lỗi | Mô tả Lỗi | Hậu Quả Trong Vận Hành | Giải Pháp Khắc Phục Ở v2.0 |
| :--- | :--- | :--- | :--- |
| **Bug 1: Deadlock Circuit Breaker** | Khối `if f_isNewDay()` chỉ reset `tm_dayCount := 0` mà quên reset `tm_consecLosses := 0`. | Khi tài khoản chạm 3 lệnh thua liên tiếp (`tm_risk_maxLosses = 3`), cổng bảo vệ `tm_okCircuit` chuyển sang `false` vĩnh viễn, khóa toàn bộ tín hiệu từ ngày đó trở đi. | Bổ sung `tm_consecLosses := 0` vào trong khối `if f_isNewDay()` tại `09_plan_and_state_machine.pine`. |
| **Bug 2: Obstacle Gate False Block** | Thuật toán quét cản `tm_nearestRes` / `tm_nearestSup` gộp cả đỉnh/đáy Swing 5 nến (`tm_swingHi` / `tm_swingLo`). | Đỉnh/đáy 5 nến luôn nằm rất sát giá hiện tại ($< 1.0 \times \text{ATR}$), khiến `tm_obstacleBlockedLong/Short` luôn kích hoạt và triệt tiêu toàn bộ các lệnh Breakout hợp lệ. | Bỏ hoàn toàn Swing 5 nến khỏi Obstacle Gate. Chỉ tính cản dựa trên: Unbroken S/R Zones (`sr_zones`), Active Order Blocks (`tm_obs`), và `PDH/PDL`, `PWH/PWL` (với khoảng cách tối thiểu $> 0.3 \times \text{ATR}$). Giảm mặc định buffer xuống $0.7$. |
| **Bug 3: Missing Limit Entry Visuals** | Khối vẽ `plotshape` cho `LONG/SHORT ENTRY` chỉ kiểm tra biến `tm_evEntry`. | Khi hệ thống khớp lệnh Limit ở nến tiếp theo (`tm_evFilled == true`), biểu đồ hoàn toàn không vẽ mũi tên Entry, gây mất dấu điểm vào lệnh thực tế. | Đổi điều kiện `plotshape` thành `(tm_evEntry or tm_evFilled)`. Kích hoạt hiển thị vùng SL/TP (`tm_bxSl`, `tm_bxTp1..3`, `tm_lnEntry`, `tm_lnStop`) cho cả trạng thái `PENDING_LIMIT` lẫn `OPEN`, khôi phục nhãn thông tin `tm_lbInfo`. |

---

## 3. Khôi Phục 100% Thành Phần Hiển Thị (Visual Restoration Spec)

Để đảm bảo không bị suy thoái giao diện (Visual Regression) so với `TM Indicator.pine` (v1), bản v2.0 tái hiện đầy đủ tất cả các thành phần biểu đồ:

### 3.1 Nhãn Cấu Trúc Thị Trường (Market Structure Labels)
- **BOS+ / BOS-:** Mũi tên xanh/đỏ tại đỉnh/đáy bị phá vỡ khi xu hướng đồng thuận.
- **CHoCH+ / CHoCH-:** Nhãn đổi màu xu hướng tại đỉnh/đáy đảo chiều.
- **MSS+ / MSS-:** Nhãn dịch chuyển cấu trúc thị trường (Market Structure Shift) màu vàng hổ phách (`#f5c542`) đi kèm nến Displacement.
- **RT+ / RT-:** Nhãn xác nhận Retest thành công vùng vừa phá vỡ.
- **FAIL+ / FAIL-:** Nhãn phá vỡ giả (Failed Breakout) cảnh báo bẫy giá.

### 3.2 Đường Ngang Thanh Khoản & Nhãn Sweep
- **PDH / PDL:** 2 đường nét đứt màu cam (`#ff9800`) cập nhật tự động đầu mỗi ngày giao dịch.
- **PWH / PWL:** 2 đường chấm bi màu xanh dương (`#2196f3`) cập nhật đầu mỗi tuần.
- **Session High / Low:** 2 đường nét đứt màu xám bạc (`color.gray`) theo dõi biên độ phiên hiện tại.
- **Sweep+ / Sweep-:** Nhãn quét thanh khoản (Liquidity Sweep) tại các vùng đỉnh/đáy phiên hoặc ngày hôm trước.
- **Equal Highs / Equal Lows:** Nhận diện thanh khoản tích tụ (`tm_eqHi`, `tm_eqLo`).

### 3.3 Đường Xu Hướng 2 Điểm (2-Point Trendline Engine)
- Tự động nối 2 đáy Swing gần nhất tạo kênh tăng (`tm_lnTlUp`) và 2 đỉnh Swing gần nhất tạo kênh giảm (`tm_lnTlDn`).
- Đếm số lần chạm ngưỡng (`tm_tlLoTouch`, `tm_tlHiTouch`) để đo độ cứng của Trendline và hiển thị trực tiếp lên Dashboard.

### 3.4 Hộp Vùng Giá (Order Block, FVG & S/R Zones)
- **S/R Zones:** Vẽ các khối chữ nhật màu xanh/đỏ nhạt đại diện cho hỗ trợ/kháng cự đa khung chưa bị phá.
- **FVG Zones:** Vẽ các khoảng trống giá Fair Value Gap với độ mờ động, tự động xóa khi bị lấp đầy (Mitigated).
- **Order Block Boxes (`tm_obs`):** Vẽ các khối chữ nhật màu vàng (`#f5c542`) cho Bullish OB và màu cam (`#ff8b3d`) cho Bearish OB trên thanh nến gần nhất (`barstate.islast`).

### 3.5 Nhãn Trạng Thái Lệnh (`tm_lbInfo`) & Vùng Rủi Ro
- Vẽ hộp SL (xám/đỏ), hộp TP1 (xanh lá nhạt), hộp TP2 (xanh vừa), hộp TP3 (xanh đậm), đường Entry (nét đứt bạc), và đường Stop (nét liền đỏ).
- Gắn nhãn `tm_lbInfo` hiển thị chi tiết: `Trạng thái (LONG/SHORT/PENDING LIMIT)`, giá `Entry`, `SL`, `TP1`, `TP2`, `TP3`.

### 3.6 Bảng Dashboard Đa Năng Mở Rộng (2 x 28 Dòng)
Bảng Dashboard ở góc trên bên phải được mở rộng lên 28 dòng, bảo toàn 24 dòng chi tiết của v1 và bổ sung 4 dòng quản trị lượng hóa của v2:

```text
┌───────────────────────────────────────┬───────────────────────────────────────┐
│ Row 0:  TM2 [Asset Profile] Ticker    │ Timeframe (e.g. 5m)                   │
│ Row 1:  Score                         │ 85 / A+                               │
│ Row 2:  Signal / Status               │ LONG [SIG] / [OK]                     │
│ Row 3:  Structure                     │ Bullish / Bearish / Ranging           │
│ Row 4:  BOS / CHoCH / MSS             │ BOS / CHoCH / MSS                     │
│ Row 5:  Retest / Fail                 │ RETEST / FAILBRK / -                  │
│ Row 6:  Event mới nhất                │ BOS + (confirmed)                     │
│ Row 7:  Context TF (H1)               │ Bull / Bear / VETO / TF_WARN          │
│ Row 8:  Setup TF (M15)                │ Bull / Bear / TF_WARN                 │
│ Row 9:  Liquidity                     │ Sweep+ / Sweep- / -                   │
│ Row 10: PDH / PDL                     │ 2650.50 / 2620.10                     │
│ Row 11: PWH / PWL                     │ 2685.00 / 2605.00                     │
│ Row 12: Sess Hi / Lo                  │ 2645.20 / 2630.00                     │
│ Row 13: Trendline touch               │ 3 up / 1 dn                           │
│ Row 14: Candle                        │ Displacement+ / Engulf+ / Pin+        │
│ Row 15: Volume / Bucket               │ 1.85x / High (TIM)                    │
│ Row 16: RelVol / OBV                  │ 1.42x / +                             │
│ Row 17: RSI / MACD                    │ 58.2 / +1.25                          │
│ Row 18: ADX / DMI                     │ 28.5 / +                              │
│ Row 19: ATR% / BBW                    │ 0.85% / 1.45 (Exp)                    │
│ Row 20: VWAP / Vị trí ngày            │ 2638.50 / +0.45                       │
│ Row 21: Session                       │ London / NY Overlap                   │
│ Row 22: Vị thế / Lệnh / W-L-TO        │ LONG / 2/5 / 12-4-1                   │
│ Row 23: Lev / Liq / Net RR            │ 15.0x | Liq 2580.00 | 2.15R           │
│───────────────────────────────────────┼───────────────────────────────────────│
│ Row 24: Market Regime [v2]            │ TRENDING BULL / CHOPPY SQUEEZE        │
│ Row 25: Obstacle / Overext [v2]       │ CLEAR / NORMAL                        │
│ Row 26: Entry Plan Mode [v2]          │ LIMIT @ 2635.00 (Pullback 50%)        │
│ Row 27: TP1% / Net% / Avg R [v2]      │ TP1 74.2% | Net 58.5% | BE: 8 | +0.65R│
└───────────────────────────────────────┴───────────────────────────────────────┘
```

---

## 4. Kiến Trúc Modular Build Trong `pine/parts-tm2/`

Hệ thống được tổ chức thành 12 module độc lập được ghép nối tuần tự:

```text
pine/parts-tm2/
├── 00_header_indicator.pine        # Khai báo indicator("TM Indicator 2"), max drawing limits
├── 00_header_strategy.pine         # Khai báo strategy("TM Indicator Strategy Lab 2")
├── 01_inputs_and_profiles.pine     # Asset profiles, timeframe presets, risk & visual inputs
├── 02_types_and_helpers.pine       # Pine v6 UDTs, helper functions, formatters, session math
├── 03_regime_and_volatility.pine   # ATR, BB Width, ADX, Market Regime Classifier
├── 04_structure_pa_liquidity.pine  # Swings, BOS/CHoCH, S/R, FVG, OB, Session & Trendline math
├── 05_momentum_volume_extension.pine # EMA stack, RSI, MACD, Volume VSA 6 buckets, Overextension
├── 06_mtf_and_intermarket_tuple.pine # 5 Tuple security requests, BTC Leader, Sweep detection
├── 07_obstacle_and_gates.pine      # Room-to-Left obstacle calculation, 5 eligibility gates
├── 08_adaptive_scoring_engine.pine # Regime-adaptive 0-100 scoring, trade qualification
├── 09_plan_and_state_machine.pine  # Trade planner, Limit lifecycle, Auto BE, Trailing, Stats
├── 10_visuals_and_dashboard.pine   # Markers, zones, liquidity lines, 28-row dashboard table
├── 11_alerts.pine                  # JSON alerts for bots / webhooks (Indicator target)
└── 11_strategy_exec.pine           # Execution engine strategy.entry/exit (Strategy target)
```

### Ràng Buộc Kỹ Thuật Pine Script v6
- **Giới hạn `request.security()`:** Chính xác 5 cuộc gọi Tuple:
  1. `Context TF Tuple`: `[close[1], high[1], low[1], ta.ema(close, 20)[1], ta.rsi(close, 14)[1]]`.
  2. `Setup TF Tuple`: `[close[1], high[1], low[1], ta.ema(close, 20)[1], ta.rsi(close, 14)[1]]`.
  3. `Daily High/Low Tuple`: `[high[1], low[1]]` lấy PDH/PDL.
  4. `Weekly High/Low Tuple`: `[high[1], low[1]]` lấy PWH/PWL.
  5. `BTC Leader Tuple`: `[close[1], ta.ema(close, 20)[1], ta.rsi(close, 14)[1], ta.atr(14)[1]]`.
- **Chống Repaint:** Tất cả dữ liệu đa khung đều sử dụng chỉ số offset `[1]` với `lookahead = barmerge.lookahead_on` và `gaps = barmerge.gaps_off`, đảm bảo nến tham chiếu đã đóng hoàn toàn.
- **Giới hạn đối tượng vẽ:** Cấu hình `max_boxes_count = 500`, `max_lines_count = 500`, `max_labels_count = 500`. Các mảng `tm_zoneBoxes`, `tm_fvgs`, `tm_obs` đều có chu kỳ dọn dẹp bộ nhớ (Garbage Collection).

---

## 5. Quy Trình Build & Kiểm Định (Toolchain Workflow)

### 5.1 Các Lệnh Thực Thi
```bash
# Build TM Indicator 2
npm run pine:tm2

# Build TM Indicator Strategy Lab 2
npm run pine:tm2-strat

# Sao chép mã nguồn vào Clipboard để dán lên TradingView
npm run pine:copy:tm2
npm run pine:copy:tm2-strat

# Kiểm định toàn diện dự án (Pine build + Doc check + 17 Test Suites)
npm run verify
```

### 5.2 Kết Quả Audit & Kiểm Định Tự Động
- Toàn bộ 11 target build trong `tools/build.mjs` hoạt động hoàn hảo, không có lỗi linter hoặc cảnh báo cú pháp.
- File đầu ra đạt chuẩn:
  - `pine/dist/TM Indicator 2.pine`: 1,811 dòng.
  - `pine/dist/TM Indicator Strategy Lab 2.pine`: 1,893 dòng.
- Cổng kiểm thử `npm run verify` đạt trạng thái xanh tuyệt đối:
  - **2,326 test cases** vượt qua trên 17 test suites (pines, engine, market, journal, risk, paper, simulation, mt5, db, services, ai, ai-review...).
  - **520 file links / scripts** trong tài liệu kiểm tra tính nhất quán đạt 100%.

---

## 6. Danh Mục Tài Liệu Bổ Trợ Đi Kèm

Mọi khía cạnh kiến trúc của phiên bản v2.0 được quy hoạch và lưu trữ trong thư mục `docs/indicator/tm-indicator-2/`:

1. [README.md](file:///d:/Applications/tm-trading/docs/indicator/tm-indicator-2/README.md): Tổng quan kiến trúc, hướng dẫn cài đặt và sử dụng nhanh.
2. [audit-baseline.md](file:///d:/Applications/tm-trading/docs/indicator/tm-indicator-2/audit-baseline.md): Báo cáo audit chi tiết đối chiếu các lỗ hổng v1 và giải pháp kỹ thuật v2.
3. [asset-profiles.md](file:///d:/Applications/tm-trading/docs/indicator/tm-indicator-2/asset-profiles.md): Tham số định lượng tối ưu cho từng loại tài sản (XAU, BTC, ETH, Altcoin).
4. [futures-risk-model.md](file:///d:/Applications/tm-trading/docs/indicator/tm-indicator-2/futures-risk-model.md): Mô hình định cỡ vị thế, tính đòn bẩy hiệu dụng, phí Futures và giá thanh lý.
5. [ablation-walkforward-protocol.md](file:///d:/Applications/tm-trading/docs/indicator/tm-indicator-2/ablation-walkforward-protocol.md): Quy trình kiểm định bóc tách (Ablation Test) từ Config A đến Config E.
6. [regression-checklist.md](file:///d:/Applications/tm-trading/docs/indicator/tm-indicator-2/regression-checklist.md): Bảng kiểm nghiệm hồi quy với trạng thái và bằng chứng kỹ thuật.
7. [known-limitations.md](file:///d:/Applications/tm-trading/docs/indicator/tm-indicator-2/known-limitations.md): Các giới hạn vật lý của nền tảng Pine Script v6 và khuyến cáo vận hành.

---

## 7. Bảng Kiểm Nghiệm Hồi Quy (Regression Checklist Status)

| Hạng Mục Kiểm Tra | Mô Tả Yêu Cầu | Trạng Thái | Bằng Chứng Kỹ Thuật |
| :--- | :--- | :---: | :--- |
| **Build Toolchain** | `node tools/build.mjs tm2` & `tm2-strategy` xuất file không lỗi | **PASS** | 1,811 dòng và 1,893 dòng được sinh ra trong `pine/dist/` |
| **request.security** | Tổng số lệnh gọi $\le 5$, không repaint, dùng Tuple | **PASS** | Đúng 5 lệnh Tuple có `lookahead_on` trên offset `[1]` |
| **Circuit Breaker** | Reset chuỗi thua đầu ngày mới | **PASS** | `tm_consecLosses := 0` trong `f_isNewDay()` |
| **Obstacle Gate** | Không bị Swing 5 nến chặn nhầm, buffer 0.7 | **PASS** | Bỏ `tm_swingHi/Lo`; dùng `sr_zones`, `tm_obs`, `PDH/PDL`, `PWH/PWL` |
| **Limit Entry Visuals** | Vẽ mũi tên Entry khi khớp lệnh Limit | **PASS** | `(tm_evEntry or tm_evFilled)` trong `plotshape` |
| **Visual Parity** | Khôi phục 100% nhãn cấu trúc, đường thanh khoản, trendline, OB | **PASS** | Đầy đủ BOS, CHoCH, MSS, RT, FAIL, PDH/PDL, PWH/PWL, Sess, Trendline, OB |
| **Dashboard** | 28 dòng hiển thị đầy đủ thông số v1 + v2 | **PASS** | Bảng `2 x 28` hiển thị đầy đủ từ Header đến Lifecycle Stats |
| **Project Gate** | `npm run verify` toàn bộ hệ sinh thái đạt chuẩn | **PASS** | 2,326/2,326 tests pass across 17 suites |