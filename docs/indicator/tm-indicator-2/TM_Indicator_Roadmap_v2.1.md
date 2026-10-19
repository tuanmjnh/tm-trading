# TM Indicator 2 — Roadmap Nâng Cấp Hệ Thống Phân Tích Đa Tài Sản / Đa Khung Thời Gian (v2.1 — Signal Quality, Direction-Aware Scoring & Validation-First)

> **Mục đích tài liệu:** Đây là tài liệu nguồn duy nhất (Single Source of Truth) để AI coding agent và Quantitative Systems Architect audit, lập kế hoạch, kiến trúc hóa các module và nâng cấp hệ thống Pine Script hiện tại từ các bản v1 (`TM Indicator.pine`, `TM Signals.pine`, `TM XAU Signals 2.pine`) lên phiên bản hoàn chỉnh thế hệ mới: **`TM Indicator 2.pine`** (kèm script kiểm định chiến lược **`TM Indicator Strategy Lab 2.pine`**).
>
> **Đặc thù kiến trúc Project (QUY TẮC BẮT BUỘC):**
> Project này **TUYỆT ĐỐI KHÔNG** sửa trực tiếp trên các file đơn lẻ trong `pine/dist/`. Toàn bộ mã nguồn được chia thành các module độc lập trong `pine/parts-tm2/` và `pine/shared/`, sau đó được đóng gói (bundle) thông qua công cụ `node tools/build.mjs` để xuất ra `pine/dist/`. Mọi thay đổi trực tiếp trong `dist/` sẽ bị ghi đè khi chạy `npm run pine:build`.

> **Revision v2.1 — nguyên tắc ưu tiên:** Audit lỗi logic và khôi phục tính đối xứng LONG/SHORT trước khi thêm chỉ báo hoặc nới bộ lọc. Các kết quả PASS, số dòng build và số test nêu trong v2.0 chỉ là **baseline được tài liệu cũ ghi nhận**, không phải bằng chứng rằng code hiện tại đã được kiểm định trong phiên làm việc này. Agent phải chạy lại build/test và lưu bằng chứng mới. Không tuyên bố tăng winrate nếu chưa có kiểm định ngoài mẫu.
>
> **Lưu ý phạm vi file:** File được cung cấp để đối chiếu cùng roadmap là `TM Indicator 2.pine`; phần phân tích ban đầu cũng nhắc tới các biến `x2_*` và file `TM XAU Signals 2.pine`. Đây có thể là hai target khác nhau. Không áp dụng kết luận từ biến `x2_*` sang `tm_*` một cách máy móc; hãy tìm đúng module nguồn và đúng build target trong repository trước khi sửa.

---

## 1. Tầm Nhìn, Hiện Trạng & Mục Tiêu Nâng Cấp

### 1.1 Hiện trạng hệ thống
- Hệ thống nền tảng hiện tại trong `pine/dist/` được build từ các thư mục module tương ứng:
  - `TM Indicator.pine` & `TM Indicator Strategy Lab.pine` (build từ `pine/parts-tm/` và `pine/shared/`).
  - `TM Signals.pine` & `TM Backtest.pine` (build từ `pine/parts/` và `pine/shared/`).
  - `TM XAU Signals 2.pine` (build từ `pine/parts-xau2/` và `pine/shared/`).
- Nhược điểm của bản v1: Winrate thực tế bị giới hạn do thiếu bộ lọc trạng thái thị trường (Market Regime), vào lệnh đuổi giá (Chasing Breakout) khi thị trường đã giãn quá xa EMA/VWAP, thiếu cơ chế tự động bảo toàn lợi nhuận (Auto Break-Even tại TP1), và không xử lý tốt sự khác biệt về thanh khoản giữa các lớp tài sản.
- Mục tiêu của **TM Indicator 2, được cập nhật qua roadmap v2.1**: cải thiện chất lượng setup, tính đối xứng LONG/SHORT, Net Trade Winrate, TP1 Hit Rate và Net Expectancy trong môi trường Futures đa tài sản (XAU, BTC, ETH, Altcoin), đồng thời bảo toàn thành phần trực quan của bản v1. Đây là mục tiêu kiểm định, không phải cam kết kết quả.

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

Roadmap v2.0 ghi nhận 3 lỗi dưới đây đã được xử lý. Trong v2.1, các mục này được xem là **baseline cần xác minh lại trên source hiện tại**, không mặc định coi là đã sửa chỉ vì tài liệu cũ ghi PASS. Sau mỗi lần kiểm tra, cập nhật trạng thái bằng commit/hash, test tái hiện và log build tương ứng:

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

### 5.2 Baseline Build & Kiểm Định Do v2.0 Ghi Nhận — Cần Chạy Lại
- Tài liệu v2.0 từng ghi nhận 11 target build trong `tools/build.mjs` hoạt động không lỗi. Đây là kết quả lịch sử được ghi trong roadmap, chưa được xác minh lại với source hiện tại.
- Các kích thước đầu ra được ghi nhận trong baseline cũ (không dùng làm tiêu chí chất lượng tín hiệu):
  - `pine/dist/TM Indicator 2.pine`: 1,811 dòng.
  - `pine/dist/TM Indicator Strategy Lab 2.pine`: 1,893 dòng.
- Baseline cũ ghi nhận `npm run verify` có **2,326 test cases / 17 suites** và **520 file links/scripts** được kiểm tra. Agent phải chạy lại `npm run verify`, ghi số liệu thực tế hiện tại và đính kèm output/CI run; không copy các con số này sang báo cáo mới nếu chưa tái xác minh.

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

## 7. Bảng Kiểm Nghiệm Hồi Quy (Regression Checklist — Historical Status, Reverify in v2.1)

| Hạng Mục Kiểm Tra | Mô Tả Yêu Cầu | Trạng Thái v2.1 | Bằng Chứng/Việc Cần Làm |
| :--- | :--- | :---: | :--- |
| **Build Toolchain** | `node tools/build.mjs tm2` & `tm2-strategy` xuất file không lỗi | **REVERIFY** | Baseline cũ ghi 1,811 / 1,893 dòng; chạy lại build để xác minh |
| **request.security** | Tổng số lệnh gọi $\le 5$, không repaint, dùng Tuple | **REVERIFY** | Đếm lại request.security và kiểm tra từng Tuple/TF trên source mới |
| **Circuit Breaker** | Reset chuỗi thua đầu ngày mới | **REVERIFY** | Tái hiện chuỗi thua chạm ngưỡng qua ngày mới; kiểm tra reset state và test |
| **Obstacle Gate** | Không bị Swing 5 nến chặn nhầm, buffer 0.7 | **REVERIFY** | Kiểm tra source thật, tái hiện case obstacle false-block và test LONG/SHORT |
| **Limit Entry Visuals** | Vẽ mũi tên Entry khi khớp lệnh Limit | **REVERIFY** | Tái hiện fill Limit và kiểm tra marker/SL/TP/label |
| **Visual Parity** | Khôi phục 100% nhãn cấu trúc, đường thanh khoản, trendline, OB | **REVERIFY** | Visual regression trước/sau trên các profile và khung hỗ trợ |
| **Dashboard** | 28 dòng hiển thị đầy đủ thông số v1 + v2 | **REVERIFY** | So sánh default/advanced mode, marker, row visibility và object count |
| **Project Gate** | `npm run verify` toàn bộ hệ sinh thái đạt chuẩn | **REVERIFY** | Chạy lại `npm run verify`, lưu log và số test thực tế |

---

## 8. v2.1 P0 — Audit Gốc Rễ Tín Hiệu LONG/SHORT (Bắt Buộc Làm Trước)

### 8.1 Quy tắc audit

1. Bắt đầu bằng source hiện có và tạo baseline có thể tái hiện. Không thêm indicator, không đổi ngưỡng hàng loạt và không thay kiến trúc trước khi có kết quả P0.
2. Theo dõi toàn bộ lifecycle riêng cho từng hướng: `feature scores → direction selection → side score gate → MTF/setup gate → regime/location/risk gates → plan validation → cooldown/daily limit/circuit breaker → position state → marker/alert`.
3. Với mỗi điều kiện chặn, ghi lại `candidateDirection`, giá trị đầu vào, kết quả boolean, `blockCode` và tầng chặn đầu tiên. Khi có nhiều nguyên nhân, có thể lưu toàn bộ danh sách; Dashboard hiển thị nguyên nhân ưu tiên cùng mục “all blockers” trong Advanced.
4. Kiểm thử trên dữ liệu tăng, giảm, đi ngang, thiếu dữ liệu, xung đột MTF, ATR bằng/không hợp lệ, phiên thanh khoản thấp và vị thế đang mở.
5. Không tính một “setup” bị risk gate chặn là một lệnh đã khớp. Báo cáo tách `candidate`, `eligible`, `submitted/pending`, `filled` và `closed trade`.

### 8.2 Phát hiện từ file `TM Indicator 2.pine` đã cung cấp

**P0 — bất đối xứng score có dấu / quality gate có khả năng chặn SHORT (đã xác nhận trong file đính kèm).** Source hiện tại có cùng lúc các đặc điểm sau:

- `tm_rawScore` nằm trong `[-1, +1]` và mang dấu hướng.
- `tm_score100 = round(50 + tm_rawScore * 50)` nên điểm thấp hơn 50 đại diện cho raw score âm/SHORT, còn điểm cao hơn 50 đại diện cho raw score dương/LONG.
- `tm_dir` được chọn theo dấu `tm_rawScore`.
- `tm_scr_noTrade` mặc định là `49`; `tm_qualityLevel` gán `0` khi `tm_score100 <= tm_scr_noTrade`.
- `tm_minQuality` mặc định là `SETUP`, tương ứng `tm_minReqLevel = 2`, và `tm_okQuality` yêu cầu `tm_qualityLevel >= tm_minReqLevel`.

Với mô hình hiện tại, một raw score đủ âm để chọn SHORT sẽ tạo `tm_score100` dưới 50; theo các ngưỡng mặc định, quality level bị gán bằng 0, không thể vượt yêu cầu SETUP. Vì `tm_tradeEligible` còn bắt buộc `tm_okQuality`, SHORT có thể bị chặn trước khi đến các gate sau. Đây là lỗi thiết kế score/direction trong **file TM Indicator 2 đính kèm**, không chỉ là giả thuyết chung.

**Hướng sửa bắt buộc:** không hạ `tm_scr_noTrade` xuống số âm. Tách “hướng” và “độ mạnh”:

- Tính `longSetupScore` và `shortSetupScore` độc lập, cùng thang `0–100`, cùng ý nghĩa “mức độ đáp ứng setup theo hướng này”. Với feature chuẩn hóa `f ∈ [-1,1]`, đóng góp LONG và SHORT phải được tính đối xứng (ví dụ dùng thành phần thuận hướng của `f` và `-f`), sau đó tổng hợp theo nhóm và trọng số đã khai báo.
- Xác định `candidateDirection` từ hai score, ngưỡng tối thiểu từng hướng và một margin phân biệt được cấu hình/kiểm định. Nếu hai score quá gần nhau hoặc cả hai thấp, kết quả là `NO_DIRECTION`/`AMBIGUOUS_SETUP`, không tự ép hướng.
- Từng gate eligibility (MTF, regime, obstacle, RR, risk, cooldown, daily limit, position state) vẫn là gate độc lập; điểm cao không được bù trừ cho gate an toàn thất bại.
- Trong giai đoạn chuyển đổi, có thể giữ tên/nhãn cũ để tránh gãy Dashboard/alert, nhưng phải xác định rõ `score` trong JSON alert là score theo hướng nào và cập nhật schema version nếu đổi ý nghĩa.

### 8.3 RR / TP: kiểm tra theo mục tiêu được cấu hình, không sửa theo phỏng đoán

Trong file `TM Indicator 2.pine` đính kèm, hàm `f_buildTMPlan2()` đặt `TP1` theo `tm_rr1`, `TP2` theo `r2 = max(tm_rr2, r1 + 0.5)`, sau đó gán `evalRR = r2` và so với `tm_rrMin`. Giá trị mặc định là `TP1 = 1R`, `TP2 = 2R`, `RR minimum = 1.5R`; do đó **mâu thuẫn TP1=1R / RR min=1.5R không xuất hiện trực tiếp ở đoạn plan builder này** vì RR được kiểm tra tại TP2.

Yêu cầu audit:

1. Xác nhận ý nghĩa từng input: `TP1 (partial/BE)`, `TP2 (standard target)`, `TP3 (runner)`, `Minimum RR target` và `Net RR after costs`.
2. Kiểm tra `rrOk`, `netRrOk`, giá trị RR trên Dashboard và payload alert cùng trỏ tới đúng target (hiện tại `evalRR` là TP2).
3. Tạo test cho `minRR=0`, minRR thấp hơn TP2, bằng TP2, cao hơn TP2; phí/slippage bằng 0 và lớn; LONG và SHORT; ATR/SL không hợp lệ.
4. Nếu repository có target legacy `TM XAU Signals 2.pine` dùng `f_buildX2Plan()`/`x2_rr1`/`x2_rrMin`, audit riêng module đó. Không sửa công thức ở target cũ chỉ dựa vào tên biến hoặc áp logic của `TM Indicator 2` sang target XAU.
5. Khi plan bị chặn, Dashboard phải hiển thị `BLOCKED: RR` hoặc `BLOCKED: NET_RR`, kèm `evalTarget=TP2` và giá trị RR để tránh hiểu nhầm là TP1 đang được kiểm tra.

### 8.4 MTF Context / Setup: xác minh tính nhất quán

Trong file `TM Indicator 2.pine` đính kèm, `tm_ctxDir` đang so sánh `tm_ctxClose` với `tm_ctxEmaF`, hai giá trị trả về từ cùng Context TF tuple; tương tự cần kiểm tra Setup TF. Chưa có bằng chứng trong đoạn source này cho nhận định rằng Context TF đang so sánh EMA HTF với `close` của chart TF. Dù vậy, phải có test hồi quy để ngăn lỗi này quay lại:

- So sánh giá với EMA trong cùng timeframe và cùng snapshot nến đã đóng.
- Giữ nguyên quy tắc non-repaint: offset HTF `[1]` cùng `lookahead_on` chỉ khi biểu thức đã được offset đúng theo quy ước Pine.
- Đảm bảo timeframe hierarchy có ý nghĩa và nhất quán giữa Entry TF, Setup TF và Context TF; khi cấu hình không hợp lệ, báo `TF_WARN`/block code thay vì trả trạng thái trung tính như thể dữ liệu hợp lệ.
- Kiểm thử Context bullish/bearish/neutral, Setup trái hướng Context, missing/`na`, chart TF lớn hơn Setup TF và nến HTF chưa đóng.
- Audit riêng các target legacy sử dụng `x2_ctx*`; không coi kết luận cho `tm_ctx*` là bằng chứng cho file khác.

### 8.5 Ma trận test P0 tối thiểu

| Case | Kỳ vọng bắt buộc |
| --- | --- |
| Bullish score rõ, gate hợp lệ | LONG có thể qua scoring; được mở lệnh chỉ khi mọi eligibility/risk gate đạt |
| Bearish score rõ, gate hợp lệ | SHORT có thể qua scoring với ngưỡng tương đương LONG |
| Cả hai score yếu/gần nhau | `NO_DIRECTION` hoặc `AMBIGUOUS_SETUP`, không giao dịch |
| Điểm cao nhưng RR/SL/ATR không hợp lệ | Bị risk gate chặn với lý do cụ thể |
| MTF đối nghịch | Hiển thị đúng Context/Setup và block reason theo chính sách đã định |
| Đã có vị thế mô phỏng mở | Không tạo vị thế mới nếu chính sách chỉ cho một vị thế; thể hiện `POSITION_OPEN` |
| Hết cooldown / đạt daily limit / circuit breaker | Block đúng điều kiện, không nhầm với không có setup |
| Pullback Limit được đặt rồi khớp | Phân biệt `PENDING_LIMIT` và `FILLED`; marker, plan và alert nhất quán |
| Nhiều gate đồng thời thất bại | Log tất cả blocker; Dashboard hiển thị blocker ưu tiên ổn định và có thể giải thích |
| Thiếu dữ liệu/khởi tạo chart | Không tạo score giả hoặc lệnh khi feature chưa warm-up |

---

## 9. v2.1 P1 — Scoring Theo Nhóm, Giảm Trùng Lặp Feature

### 9.1 Nguyên tắc scoring

- Tách `direction` khỏi `confidence/quality`; score không được vừa biểu diễn hướng bằng dấu vừa bị dùng như điểm chất lượng một chiều.
- Chuẩn hóa mọi feature về miền nhất quán, xác định ý nghĩa `na`, warm-up và trọng số bằng cấu hình có version.
- Tổng hợp theo nhóm thông tin trước khi cộng giữa nhóm. Không mặc định EMA, RSI, MACD, DMI/ADX, VWAP, Relative Volume và OBV là các xác nhận độc lập.
- Giữ riêng nhóm `Risk/Eligibility`; các yếu tố an toàn như RR, SL hợp lệ, vị thế đang mở, max loss/day và MTF veto không thể bị “bù” bằng score.
- Ghi `scoreVersion`, `featureSet`, `assetProfile`, `entryMode` và các threshold trong metadata kết quả để có thể tái lập run.

### 9.2 Nhóm feature đề xuất

| Nhóm | Ví dụ thành phần | Vai trò | Chú ý |
| --- | --- | --- | --- |
| Structure / Price Action | BOS, CHoCH/MSS, displacement, retest, swing sequence | Xác định cấu trúc và xác nhận giá | Tránh đếm cùng một sự kiện structure nhiều lần |
| Location / Liquidity | S/R, PDH/PDL, PWH/PWL, sweep, FVG/OB có trạng thái active | Xác định vị trí setup và khoảng trống đến cản | Chỉ vùng chưa bị vô hiệu hóa; phân biệt “có vùng” với “có phản ứng” |
| Trend | EMA stack/slope, HTF bias | Hướng/điều kiện xu hướng | EMA nhiều chu kỳ vẫn có tương quan cao |
| Momentum | Chọn một tập đại diện từ RSI/MACD/DMI | Đo lực/nhịp chuyển động | Test đóng góp của từng feature bằng ablation |
| Volume / Participation | Relative Volume, OBV slope, VSA | Mức độ tham gia và phản ứng tại vùng giá | Có thể không đáng tin với feed volume không đồng nhất |
| Regime / Volatility | ATR%, BB width, ADX hoặc range metrics | Phân loại trending/ranging/choppy/squeeze | Dùng quyết định mode/gate, không nhất thiết là directional score |
| Risk / Eligibility | SL distance, RR sau chi phí, obstacle, overextension, cooldown, position state | Chấp nhận hoặc từ chối trade plan | Không cộng vào score để “bù” một kế hoạch không an toàn |

### 9.3 Ablation configs bắt buộc

So sánh tối thiểu các cấu hình sau trên cùng dữ liệu, thời gian, rule fill, phí, slippage và quản lý vị thế. Config không được thay đổi nhiều yếu tố ngoài feature đang kiểm tra.

- **A — Structure + Location:** Price Action/Structure + Location/Liquidity thiết yếu.
- **B — A + Trend/Momentum:** bổ sung feature xu hướng/động lượng đã chọn.
- **C — B + Volume:** bổ sung Volume/Participation.
- **D — C + MTF + Regime:** thêm xác nhận đa khung và phân loại regime.
- **E — Full gates:** D cộng các gate obstacle, overextension, RR/cost và risk controls; báo riêng các trade bị loại bởi từng gate.

Không mặc định Config E sẽ tốt hơn vì có nhiều bộ lọc hơn. Giữ feature nếu nó cải thiện tiêu chí đã định trước ngoài mẫu (ví dụ net expectancy, drawdown hoặc chất lượng theo regime) mà không làm sai lệch số mẫu. Phải báo số trade còn lại để tránh kết luận từ mẫu quá nhỏ.

---

## 10. v2.1 P1 — Entry Modes Theo Trạng Thái Thị Trường

Tạo ba mode có thể bật/tắt độc lập. Ban đầu nên triển khai và kiểm định **Trend Pullback** cùng **Liquidity Sweep Reversal** trước; chỉ bật Range/Mean Reversion sau khi classifier và kết quả OOS đủ tin cậy.

### Mode A — Trend Pullback

- **Kích hoạt:** regime trending, hướng Setup/Context không vi phạm chính sách MTF, cấu trúc xu hướng còn hiệu lực.
- **Setup:** pullback về vùng giá đã định nghĩa (EMA/FVG/OB/S/R); cần có xác nhận phản ứng hoặc retest theo ruleset.
- **Hủy:** cấu trúc bị phá theo hướng ngược, vùng entry bị vô hiệu hóa, giá chưa khớp quá số nến chờ, RR/obstacle không đạt.
- **Entry:** Market on Confirm hoặc Pullback Limit theo input; không tự đổi mode nếu đổi mode khiến điều kiện xác nhận khác đi mà không ghi log.

### Mode B — Liquidity Sweep Reversal

- **Kích hoạt:** sweep tại vùng thanh khoản được định nghĩa (swing/liquidity/day/week/session), cùng phản ứng giá hoặc xác nhận cấu trúc sau sweep.
- **Không đủ điều kiện:** chỉ chạm kháng cự/hỗ trợ nhưng không có sweep/confirmation thì không tạo lệnh đảo chiều.
- **Hủy:** giá tiếp tục chấp nhận bên ngoài vùng sweep, cấu trúc xác nhận không xuất hiện trong cửa sổ thời gian, hoặc risk/obstacle/Net RR thất bại.

### Mode C — Range / Mean Reversion

- **Kích hoạt:** regime classifier xác định range với tiêu chí định lượng và giới hạn sai số rõ ràng; không chỉ dựa vào một indicator duy nhất.
- **Setup:** gần biên range có xác nhận từ chối giá/return-inside; mục tiêu hướng về giữa range hoặc vùng đối diện, tùy mô hình đã kiểm định.
- **Khóa mode:** xu hướng/volatility breakout làm range vô hiệu; không bắt đảo chiều trong trend mạnh.

### Yêu cầu chung cho mọi mode

Mỗi mode phải cung cấp `activationReason`, `invalidationReason`, `entryCondition`, `stopCondition`, `targets`, `minNetRR`, `expiryBars` và `blockReason`. Lưu tên/version của mode trong mỗi signal, trade, alert và backtest result. So sánh mode riêng theo asset, TF, regime, LONG/SHORT; không chỉ cộng tất cả kết quả vào một thống kê chung.

---

## 11. v2.1 P1 — Dashboard “Vì Sao Chưa Có Lệnh?”

### 11.1 Compact mode — mặc định

Giữ dashboard gọn, ưu tiên thông tin giúp ra quyết định. Tối thiểu cần có:

1. **Bias / Regime:** Context, Setup, `TRENDING / RANGING / CHOPPY-SQUEEZE`.
2. **Long Score / Short Score:** hai điểm độc lập `0–100`, cùng thang nghĩa và threshold version.
3. **Status:** `NO_SETUP`, `WAIT_CONFIRMATION`, `BLOCKED`, `PENDING_LIMIT`, `OPEN`, `CLOSED`.
4. **Entry Plan:** Entry, SL, TP1/TP2/TP3, Net RR, Entry Mode.
5. **Top Block Reason:** một lý do chặn ưu tiên và mô tả ngắn; ví dụ `BLOCKED: RR`, `BLOCKED: HTF`, `BLOCKED: OBSTACLE`, `WAIT: PULLBACK`, `BLOCKED: COOLDOWN`, `BLOCKED: POSITION_OPEN`.

### 11.2 Advanced mode

Đưa danh sách feature, giá trị từng gate, BOS/CHoCH/MSS, sweep, FVG/OB, RSI/MACD/ADX/Volume/ATR, toàn bộ lý do chặn, score contribution theo nhóm, thời điểm/giá signal và trạng thái lifecycle vào chế độ Advanced. Cho phép bật/tắt visual theo nhóm; không xóa nhãn/đường/vùng hiện có khi chỉ cần đổi chế độ hiển thị.

### 11.3 Chuẩn hóa status và reason code

Chuẩn hóa ít nhất các mã sau (có thể mở rộng nhưng không đổi ý nghĩa giữa các module):

- `NO_SETUP`, `NO_DIRECTION`, `AMBIGUOUS_SETUP`, `WAIT_CONFIRMATION`, `WAIT_PULLBACK`.
- `BLOCKED_SCORE_LONG`, `BLOCKED_SCORE_SHORT`, `BLOCKED_MTF`, `BLOCKED_REGIME`, `BLOCKED_OBSTACLE`, `BLOCKED_OVEREXTENSION`.
- `BLOCKED_NO_ATR`, `BLOCKED_BAD_SL`, `BLOCKED_BAD_TP`, `BLOCKED_RR`, `BLOCKED_NET_RR`, `BLOCKED_MAX_LEV`, `BLOCKED_LIQUIDATION_RISK`.
- `BLOCKED_COOLDOWN`, `BLOCKED_DAILY_LIMIT`, `BLOCKED_CIRCUIT_BREAKER`, `BLOCKED_POSITION_OPEN`.
- `PENDING_LIMIT`, `FILLED`, `EXIT_TP1`, `EXIT_TP2`, `EXIT_TP3`, `EXIT_SL`, `EXIT_BE`, `EXIT_TIMEOUT`, `EXIT_TIME_DECAY`.

Không dùng `NO TRADE` làm nhãn tổng cho mọi tình huống; đó là kết quả cuối nhưng không giải thích nguyên nhân. `blockReason` phải được tạo từ gate/state thật, không suy ra từ màu sắc/label của UI.

---

## 12. v2.1 P0/P1 — Kế Hoạch Triển Khai Có Cổng Chấp Nhận

### Phase 0 — Baseline, inventory và tái hiện

- Liệt kê build target, module nguồn và generated output của `TM Indicator 2` và từng target legacy hiện diện trong repository.
- Lưu commit hash, config/inputs, asset, timeframe, sample date range và output build/test trước thay đổi.
- Chạy build/verify hiện có; ghi rõ lệnh nào pass/fail. Không coi số liệu ghi trong roadmap cũ là output mới.
- Tạo minimal reproducer cho SHORT score gate; kiểm tra trên code source thực, không chỉ nhìn chart marker.

**Acceptance:** Có đường dẫn module, cách tái hiện, test fail trước fix và dữ liệu baseline cho cả LONG/SHORT.

### Phase 1 — P0: fix scoring và reason codes

- Tách Long/Short Setup Score và thống nhất thang quality.
- Giữ eligibility/risk gates độc lập; kiểm tra side selection ở mọi bước.
- Thêm block reason theo tầng, telemetry/debug plots hoặc log tạm có thể bật/tắt.
- Tạo test cho các case trong mục 8.5.

**Acceptance:** Với điều kiện đối xứng, SHORT có thể qua cùng quality gate như LONG; không cần nới ngưỡng riêng để bù lỗi; không phát sinh lệnh khi risk gate fail.

### Phase 2 — P0: RR/MTF/plan/state machine

- Xác nhận RR target và Net RR dùng thống nhất giữa planner, Dashboard, alert, strategy/backtest.
- Kiểm thử context/setup TF, missing data, non-repaint và timeframe hierarchy.
- Kiểm tra cooldown, daily count, consecutive losses, position lifecycle, pending/filled/cancelled/closed và reset state.
- Kiểm tra marker cho `entry` và `filled`, SL/TP boxes, alert payload cùng một signal ID.

**Acceptance:** Từng blocker có test tái hiện; không có khác biệt giữa side/visual/alert về entry direction hoặc target; build không lỗi.

### Phase 3 — P1: feature ablation và entry modes

- Thêm feature groups và config A–E có version.
- Triển khai Trend Pullback, Liquidity Sweep Reversal; sau đó mới xét Range/Mean Reversion.
- Chạy replay/backtest trên cùng assumptions; ghi số candidate, eligible, filled, closed và chi phí.

**Acceptance:** Mọi config/entry mode có thể bật/tắt, tái lập được và báo kết quả ngoài mẫu; không feature nào được quảng bá là cải thiện nếu không đạt tiêu chí đã đặt trước.

### Phase 4 — P1: dashboard và regression visuals

- Thêm Compact/Advanced; chuẩn hóa status/reason code; bảo toàn visual cũ bằng toggles.
- Kiểm tra quota object, garbage collection, table row bounds và các điều kiện `barstate.islast`.
- Chụp/ghi regression examples cho LONG, SHORT, pending Limit, fill, TP1/BE, SL, timeout, block reason.

**Acceptance:** Dashboard gọn trả lời được “vì sao chưa vào lệnh”; Advanced vẫn có đủ dữ liệu chẩn đoán; không mất marker/vùng do đổi layout.

### Phase 5 — Validation gate và phát hành

- Chạy full build/verify và các test Pine/strategy hiện có.
- Chạy in-sample, walk-forward và holdout/out-of-sample; tránh tuning trên holdout.
- Xuất báo cáo per asset × timeframe × direction × regime × entry mode với chi phí.
- Chỉ đóng phase khi checklist đã có trạng thái, test name, commit/hash và artifact/log.

**Acceptance:** Kết quả có thể tái lập; không có regression P0; mọi tuyên bố về hiệu quả đều gắn với tập dữ liệu và tiêu chí định trước.

---

## 13. v2.1 — Chuẩn Kiểm Định Định Lượng (Không Chỉ Nhìn Winrate)

### 13.1 Tách định nghĩa thống kê

- **Signal candidates:** số setup đạt điều kiện hình thành ban đầu.
- **Eligible signals:** số setup qua scoring và các eligibility gates.
- **Order attempts / Pending:** số lệnh được tạo/đặt Limit.
- **Filled trades:** số lệnh thật sự được khớp trong mô hình fill.
- **Closed trades:** số vị thế kết thúc có outcome xác định.
- **TP1 hit rate:** tỷ lệ trade đã khớp có giá chạm TP1 theo quy tắc intrabar/fill đã mô tả; báo rõ trường hợp TP1 chạm cùng nến với SL.
- **Net winrate:** tỷ lệ trade có PnL ròng dương sau phí/slippage; nêu rõ BE/partial-close được phân loại thế nào.
- **Net expectancy (R/trade):** PnL ròng trung bình trên mỗi trade đóng, tính nhất quán từ kích thước vị thế và partial exits.
- **Profit factor:** gross profit / absolute gross loss; báo `N/A` nếu mẫu không có gross loss thay vì hiển thị vô cực như hiệu quả chắc chắn.
- **Max drawdown:** định nghĩa theo equity curve với thứ tự giao dịch, phí và sizing đã nêu.
- Bổ sung trade count, median R, tail loss, exposure, turnover và chi phí trung bình; báo riêng LONG và SHORT.

### 13.2 Chống sai lệch backtest

- Không dùng dữ liệu chưa đóng cho logic yêu cầu confirmed bar; kiểm tra repaint/lookahead và MTF alignment.
- Ghi rõ cách xử lý trường hợp OHLC cùng nến chạm Entry/SL/TP; nếu không có dữ liệu intrabar, dùng giả định bảo thủ được công bố.
- Mô hình market/limit phải tính fill, spread, slippage, commission và funding nếu target giao dịch yêu cầu; Limit không được coi là chắc chắn khớp chỉ vì high/low đi qua giá.
- Chia tập theo thời gian; không shuffle các nến để tạo train/test. Walk-forward và holdout phải nằm ngoài quá trình chọn feature/threshold.
- Công bố số trade và độ không chắc chắn; không kết luận chiến lược tốt hơn chỉ vì winrate cao hơn khi expectancy hoặc drawdown xấu đi.
- Không hứa hẹn tăng winrate; kết quả phụ thuộc tài sản, timeframe, giai đoạn thị trường, chi phí và chất lượng dữ liệu.

### 13.3 Báo cáo bắt buộc

Mỗi kết quả so sánh phải gồm: commit/hash, data source, sample range, asset/symbol, timeframe, config/score version, mode, LONG/SHORT, candidate count, filled/closed count, TP1 hit rate, net winrate, BE/SL/timeout/time-decay rates, net expectancy, PF, max DD, phí/slippage assumptions và link tới log/raw trades. Nêu rõ kết quả nào in-sample, walk-forward và holdout.

---

## 14. Lệnh Cho AI Coding Agent — Thứ Tự Thực Thi Không Được Đảo

Thực hiện theo thứ tự và cập nhật roadmap này trong lúc làm việc. **Không refactor lớn hoặc thêm indicator trước khi Phase 0 và P0 hoàn tất.**

1. **Audit trước, chưa sửa:** đọc source module và `tools/build.mjs`; tìm đúng target/module cho `TM Indicator 2` và target XAU legacy (nếu tồn tại). Ghi bảng `finding / evidence / impact / test to reproduce / proposed fix`.
2. **Tái hiện SHORT gate:** dùng code hiện tại để chứng minh raw score âm, direction SHORT, score/quality level và gate chặn. Tạo test trước khi sửa.
3. **Sửa scoring một cách đối xứng:** thêm Long Setup Score và Short Setup Score độc lập; mọi threshold có cùng semantics; không dùng score có dấu làm quality score một chiều.
4. **Audit RR và MTF:** xác nhận target RR thực tế; giữ nguyên phần đã đúng, chỉ sửa phần có reproducer. Với legacy `x2_*`, chỉ áp dụng sau khi đã đọc đúng file/module.
5. **Audit signal lifecycle:** candidate → eligible → pending → filled → open → partial exit/BE/trailing → closed; bảo đảm một trạng thái không bị đếm thành nhiều trade.
6. **Thêm reason codes + dashboard compact/advanced** sau khi nguồn blocker đã chính xác.
7. **Ablation và entry modes** sau khi P0 pass; giữ nguyên cùng data/cost assumptions.
8. **Build/verify, kiểm định ngoài mẫu, báo cáo:** không sửa trực tiếp `pine/dist/`; dùng scripts của repository, cập nhật checklist và cung cấp log/tên test. Nếu không thể chạy TradingView/Pine compiler trong môi trường hiện tại, ghi rõ giới hạn; không tự ghi PASS.

**Format báo cáo sau mỗi phase:**

```text
Phase:
Files/modules inspected:
Findings + evidence:
Changes made:
Tests added/updated:
Commands executed + actual result:
LONG results:
SHORT results:
Known limitations / follow-up:
Checklist status:
```

**Definition of Done cho v2.1:** SHORT không bị chặn do cách ánh xạ score có dấu; LONG/SHORT dùng cùng semantics; RR/MTF/state machine có test; mọi blocker có lý do rõ ràng; ablation và performance report phân biệt in-sample/OOS; dashboard có Compact/Advanced; module source là nơi duy nhất được chỉnh sửa; build và verify được chạy lại với bằng chứng; không có tuyên bố cải thiện hiệu quả khi chưa có dữ liệu hỗ trợ.

---

## 15. v2.1 Implementation Status (2026-10-19)

Evidence is local only. TradingView compilation, chart rendering, strategy fills
and out-of-sample results are still **NOT TESTED** and are not implied by a green
local build.

| Phase | Item | Status | Where |
| :--- | :--- | :---: | :--- |
| 0 | Module inventory + baseline build | **DONE** | `tools/build.mjs`, this repository |
| 1 | Direction-aware LONG/SHORT scoring | **DONE** | `pine/parts-tm2/08_adaptive_scoring_engine.pine`, `pine/shared/tm-signal-quality.pine` |
| 1 | Direction margin + NO_DIRECTION / AMBIGUOUS_SETUP | **DONE** | same |
| 1 | Standardized reason codes + all-blocker mask | **DONE** | `07_obstacle_and_gates.pine`, `09_plan_and_state_machine.pine` |
| 2 | RR evaluated at TP2, exposed as `evalTarget` | **DONE** | `09_plan_and_state_machine.pine`, `11_alerts.pine` |
| 2 | Net RR compared with the real minimum | **DONE** | plan builder |
| 2 | TP1 hit accounting + lifecycle funnel | **DONE** | state machine |
| 2 | Strategy transition-only entries | **DONE** | `11_strategy_exec.pine` |
| 3 | Ablation weight configs A-E | **DONE (weights)** | scoring engine |
| 3 | Entry modes A / B / C | **DONE (static)** | `08b_entry_modes.pine` |
| 4 | Compact (12 rows) / Advanced (34 rows) dashboard | **DONE (static)** | `10_visuals_and_dashboard.pine` |
| 5 | Local build + smoke gate | **PASS** | `npm run pine:build`, `npm test` |
| 5 | TradingView compile + visual regression | **NOT TESTED** | requires TradingView |
| 5 | Ablation / walk-forward / holdout report | **NOT TESTED** | no performance claim |

**Definition of Done caveat:** the structural P0 blocker (SHORT blocked by the
signed score mapping) is removed and asserted by `tools/smoke.mjs`. The
quantitative DoD (ablation + OOS report) remains open by design; no winrate or
expectancy improvement is claimed here.

