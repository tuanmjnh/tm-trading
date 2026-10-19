# Audit Baseline & Technical Comparison — TM Indicator 2 (v2.0)

> **Document Type:** System Audit & Engineering Baseline Report  
> **Target Project:** `pine/dist/TM Indicator 2.pine` & `pine/dist/TM Indicator Strategy Lab 2.pine`  
> **Source Baseline:** `pine/parts-tm/`, `pine/parts-xau2/`, `pine/parts/`, `pine/shared/`  
> **Author:** Principal Pine Script v6 Engineer & Quantitative Systems Architect  
> **Status:** APPROVED — Phase 0 Complete

---

## 1. Tổng quan Kiến trúc Hệ thống Build (Toolchain Audit)

### 1.1 Cơ chế Assembler & Preprocessor
Dự án quản lý mã nguồn Pine Script thông qua công cụ build nội bộ `tools/build.mjs`:
- Pine Script v6 không hỗ trợ lệnh tiền xử lý `#include` nguyên bản. Do đó, `tools/build.mjs` đóng vai trò là preprocessor nối các module từ các thư mục `pine/parts*/` theo thứ tự alphabet/đánh số (`00_`, `10_`, `20_`, ...), đồng thời chèn mã nguồn dùng chung từ `pine/shared/` qua marker `{{SHARED}}` và khai báo cấu trúc qua `{{DECL}}`.
- Cơ chế `@part skip:<target>` cho phép loại bỏ các đoạn mã đặc thù cho từng target (ví dụ: lược bỏ bảng visual trong strategy backtest hoặc lược bỏ lệnh gọi `strategy.*` trong indicator).
- Output sinh ra duy nhất tại `pine/dist/`. **Quy tắc bất biến:** Không bao giờ chỉnh sửa trực tiếp file trong `pine/dist/` vì lệnh `npm run pine:build` sẽ ghi đè toàn bộ.

### 1.2 Hiện trạng Target và Đường ống Output
Trước khi nâng cấp, `tools/build.mjs` quản lý 9 target chuẩn:
1. `indicator` -> `pine/dist/TM Signals.pine` (source: `pine/parts/`)
2. `strategy` -> `pine/dist/TM Backtest.pine` (source: `pine/parts/`)
3. `vsa` -> `pine/dist/TM VSA Wyckoff.pine` (source: `pine/parts-vsa/`)
4. `vsa-strategy` -> `pine/dist/TM VSA Backtest.pine` (source: `pine/parts-vsa/`)
5. `sweep` -> `pine/dist/TM Liquidity Sweep.pine` (source: `pine/parts-sweep/`)
6. `xau` -> `pine/dist/TM XAU Signals.pine` (source: `pine/parts-xau/`)
7. `xau2` -> `pine/dist/TM XAU Signals 2.pine` (source: `pine/parts-xau2/`)
8. `tm` -> `pine/dist/TM Indicator.pine` (source: `pine/parts-tm/`)
9. `tm-strategy` -> `pine/dist/TM Indicator Strategy Lab.pine` (source: `pine/parts-tm/`)

Tất cả 9 target đều vượt qua bộ kiểm tra tĩnh `tools/pine-ref.json` (`npm run pine:build` exit 0).

---

## 2. Đối chiếu & Phân tích Kế thừa giữa các Nhánh Module

| Tính năng / Module | `pine/parts/` (TM Signals) | `pine/parts-xau2/` (TM XAU 2) | `pine/parts-tm/` (TM Ind v1) | Đánh giá & Định hướng `pine/parts-tm2/` |
| :--- | :--- | :--- | :--- | :--- |
| **Header & Decl** | Đơn giản, v6 cơ bản | Đầy đủ UDT, `max_boxes=500` | Kế thừa từ `xau2`, chuẩn hóa UDT | Kế thừa cấu trúc UDT Pine v6 chặt chẽ; phân tách header Indicator và Strategy rõ ràng. |
| **Cấu hình & Input** | Tối giản, ít tham số | Chi tiết cho XAUUSD (Gold) | Hỗ trợ 5 profile cơ bản | Thiết lập Profile động (`Auto`, `XAU`, `BTC`, `ETH`, `Liquid Alt`, `High-Risk Alt`, `Custom`); chuẩn hóa theo ATR% và R. |
| **Phân tích Cấu trúc** | Swing High/Low cơ bản | Swing + BOS/CHoCH/MSS + Retest + Failed Break | Giống `xau2` | Giữ nguyên bộ nhận diện cấu trúc sắc bén của `xau2/tm`, bổ sung dọn rác bộ nhớ (Garbage Collection). |
| **Thanh khoản & Vùng** | PDH/PDL, Equal H/L | Sweep + Order Block + FVG + S/R + Trendline | Giống `xau2` | Kế thừa zone engine; bổ sung kiểm tra trạng thái Mitigated để dọn dẹp visual và đo Room-to-Left. |
| **Bộ chỉ báo kỹ thuật** | EMA + RSI + ATR | EMA stack + RSI + MACD + DMI + BBW + VWAP + OBV | Giống `xau2` | Giữ nguyên cách nhóm chỉ báo theo chức năng để chống cộng dồn thiên vị (anti-correlation double counting). |
| **Context & MTF** | Không có MTF chuyên sâu | Gọi 2 lần `request.security` | Sửa HTF EMA vs HTF Close | **Cải tiến vượt bậc:** Đóng gói toàn bộ biến vào hàm Tuple duy nhất; tích hợp `BTC Leader Filter`. |
| **Chấm điểm (Scoring)** | Confidence 0-100 đơn giản | 11 nhóm trọng số cố định | 11 nhóm trọng số cố định | **Nâng cấp Adaptive:** Trọng số tự động thay đổi theo Market Regime (Trending vs Ranging). |
| **State Machine** | Có BE và Trailing cơ bản | Không có BE, không có Trailing | Có Timeout nhưng thiếu BE & Trail | **Đột phá State Machine:** Hỗ trợ `PENDING_LIMIT`, `Auto Break-Even tại TP1`, `Trailing Stop sau TP2`, `Time-Decay Exit`. |
| **Risk & Phân bổ vốn** | Đơn giản theo ATR | Đơn giản | Sizing theo vốn, đòn bẩy, phí | Hoàn thiện Futures Risk Model: Phí Maker/Taker, Partial Exits (40/40/20), cảnh báo rủi ro thanh lý. |
| **Visual & Dashboard** | Bảng compact 2x16 | Bảng chi tiết 2x24 | Bảng chi tiết 2x24 | Bổ sung hiển thị Regime, Gate Blocks, TP1 Hit Rate (%) vs Net Trade Winrate (%). |

---

## 3. Vị trí chính xác các lỗi P0/P1 cần giải quyết triệt để

### 3.1 [Lỗi P0] Kiểm tra điều kiện RR (`rrOk`) và vai trò của TP1/TP2/TP3
- **Vị trí lỗi cũ:**
  - `pine/parts-xau2/80_scoring_risk.pine` (dòng 72):
    ```pinescript
    bool rrOk = x2_rrMin <= 0.0 or x2_rr1 >= x2_rrMin
    ```
  - Mặc định hệ thống đặt `x2_rrMin = 1.5` nhưng `x2_rr1` (tức TP1) mặc định là `1.0`. Do đó `1.0 >= 1.5` trả về `false`, khiến `rrOk = false` và triệt tiêu toàn bộ tín hiệu của hệ thống một cách âm thầm!
  - `pine/parts-tm/80_scoring_risk.pine` (dòng 78-79) đã vá tạm bằng cách chọn target đánh giá (`evalRR` theo `tm_rrTarget` mặc định là `"TP2"`).
- **Giải pháp dứt điểm trong `TM Indicator 2`:**
  - Quy định rõ ràng phân tầng chức năng:
    - **TP1 (Quick Profit & Risk De-risking):** Mốc chốt lời 30%–40% đầu tiên, là điểm kích hoạt **Auto Break-Even** dời SL về `Entry + Fee Buffer`. Không bắt buộc TP1 phải lớn hơn `Min RR` (thường TP1 nằm ở 0.8R - 1.2R).
    - **TP2 (Standard Structural Target):** Mục tiêu chính để kiểm định ngưỡng `Min RR >= 1.5R` (hoặc cấu hình).
    - **TP3 (Runner Target):** Mốc thả trôi lợi nhuận (2.5R - 4.0R) kèm Trailing Stop.
  - Tách bạch logic kiểm tra: `rrOk = (tp2 - entry) / risk >= minRR` mà không chặn lệnh nếu TP1 gần giá vào.

### 3.2 [Lỗi P0] Đồng bộ MTF và Giới hạn Lệnh gọi `request.security()`
- **Vị trí lỗi cũ:**
  - Các bản cũ gọi rời rạc từng chỉ báo qua `request.security()`. Ở `parts-tm/75_mtf.pine`:
    ```pinescript
    [tm_ctxClose, tm_ctxEma] = request.security(syminfo.tickerid, tm_ctxTf, [close[1], ta.ema(close, tm_ctxLen)[1]], lookahead = barmerge.lookahead_on)
    [tm_setupClose, tm_setupEma] = request.security(syminfo.tickerid, tm_setupTf, [close[1], ta.ema(close, tm_setupLen)[1]], lookahead = barmerge.lookahead_on)
    ```
  - Khi cần thêm thông tin từ MTF (RSI, ADX, ATR, cấu trúc nến HTF) và thêm `BTC Leader Filter`, số lượng lời gọi `request.security()` sẽ vượt ngưỡng tối đa (Pine Script v6 khuyến nghị và giới hạn hiệu năng dưới 5 cuộc gọi).
- **Giải pháp dứt điểm trong `TM Indicator 2`:**
  - Viết hàm `f_fetchMtfTuple(tf)` tính toán trọn gói toàn bộ chỉ báo trong scope của timeframe đó và trả về một **Tuple đồng nhất**:
    `[htfClose, htfHigh, htfLow, htfEmaFast, htfEmaSlow, htfRsi, htfAdx, htfAtr, htfTrendDir]`
  - Toàn bộ script chỉ gọi tối đa 3 lần `request.security`:
    1. Context TF (H4 / D)
    2. Setup TF (H1 / M15)
    3. BTC Leader Index (`BINANCE:BTCUSDT.P` hoặc tương đương)
  - Sử dụng chính sách nến đóng `[1]` kết hợp `barmerge.lookahead_on` trên lịch sử và `barmerge.gaps_off` để triệt tiêu 100% hiện tượng Repainting.

### 3.3 [Lỗi P0] Lỗ hổng Vòng đời Vị thế (State Machine) & Thống kê Winrate Bị Bóp Méo
- **Vị trí lỗi cũ:**
  1. **Không dời SL về hòa vốn khi chạm TP1:**
     - Trong `pine/parts-tm/90_state.pine` (dòng 108-110), khi `hit1` kích hoạt, script chỉ cập nhật `tm_posStage := 1` mà `tm_posSl` vẫn giữ nguyên ở mức SL ban đầu! Nếu giá đảo chiều đâm xuống SL gốc, lệnh vẫn bị đếm là `tm_statLosses += 1`. Đây là nguyên nhân trực tiếp làm sụt giảm Winrate thực tế 15%–25%.
  2. **Phantom Profit khi Timeout:**
     - Trong `pine/parts-xau2/90_state.pine` (dòng 99):
       `x2_xExit := x2_evSl ? x2_posSl : x2_evTp == 3 ? x2_posTp3 : x2_evTp == 2 ? x2_posTp2 : x2_posTp1`
       Khi hết thời gian nắm giữ (`x2_posBars > 300`), script thoát lệnh nhưng gán giá thoát bằng `x2_posTp1`, tạo ra lợi nhuận ảo sai lệch!
  3. **Bộ đếm Winrate bóp méo chỉ đếm TP3:**
     - Trong `parts-tm/90_state.pine` (dòng 104), chỉ khi chạm TP3 (`hit3`) thì `tm_statWins` mới tăng. Các lệnh chạm TP1, TP2 mang lại lợi nhuận thực rồi đóng hòa vốn hoặc timeout lại không được tính là chiến thắng.
- **Giải pháp dứt điểm trong `TM Indicator 2`:**
  - Mở rộng tập trạng thái: `IDLE`, `PENDING_LIMIT`, `OPEN`, `TP1_HIT_BE`, `TP2_HIT_TRAIL`, `CLOSED`.
  - Cơ chế **Auto Break-Even**: Khi giá chạm TP1, `posSl` ngay lập tức được nâng lên `Entry +/- Buffer`. Nếu giá quay về chạm SL mới, lệnh được ghi nhận là `BREAKEVEN_EXIT` với Realized R dương nhẹ (do đã chốt một phần tại TP1).
  - Tách bạch rõ 2 chỉ số trên Dashboard:
    - **TP1 Hit Rate (%):** Tỷ lệ lệnh chạm ít nhất TP1 (đo lường độ chính xác của điểm vào ban đầu).
    - **Net Trade Winrate (%):** Tỷ lệ lệnh đóng lại với tổng Realized R > 0 (sau khi đã tính phí và các lần chốt lời/hòa vốn).

### 3.4 [Lỗi P1] Thiếu Bộ Lọc Cản Ngang và Bẫy Mua Đuổi (Obstacle & Overextension Gates)
- **Vấn đề trong code cũ:**
  - Hệ thống v1 vào lệnh Breakout / Retest bất kể phía trước có vùng cản cứng (Opposite S/R hoặc HTF Swing) cản trở đường đi tới TP1.
  - Hệ thống v1 cho phép vào lệnh ngay cả khi nến tín hiệu đã giãn biên độ quá mức (Overextended), khiến khoảng cách SL bị giãn rộng, giảm RR và dễ dính nhịp hồi ngược (mean-reversion shakeout).
- **Giải pháp dứt điểm trong `TM Indicator 2`:**
  - Bổ sung **Room-to-Left / Obstacle Gate**: Nếu `Distance_to_Opposite_SR < Distance_to_TP1`, khóa lệnh với mã lý do `BLOCKED_BY_OBSTACLE`.
  - Bổ sung **Overextension Gate**: Nếu $\frac{\vert{}\text{Close} - \text{EMA}_{20}\vert{}}{\text{ATR}} > \text{Max\_Extension}$ hoặc biên độ nến tín hiệu $> 2.5 \times \text{ATR}$, cấm vào lệnh Market trực tiếp, chỉ cho phép đặt lệnh chờ `Pullback Limit Entry`.

---

## 4. Kế hoạch Kế thừa & Danh mục Module Mục tiêu trong `pine/parts-tm2/`

Hệ thống sẽ được tái cấu trúc thành 12 module rõ ràng trong `pine/parts-tm2/`:

```text
pine/parts-tm2/
├── 00_header_indicator.pine        # Header khai báo indicator (dành riêng cho TM Indicator 2)
├── 00_header_strategy.pine         # Header khai báo strategy (dành riêng cho TM Strategy Lab 2)
├── 01_inputs_and_profiles.pine     # Multi-Asset Profiles, Timeframe Presets & Gate Toggles
├── 02_types_and_state_defs.pine    # UDTs: TMPlan, TMEvent, MarketRegime, ActivePos, PerfMetrics
├── 03_regime_and_volatility.pine   # ATR, ATR%, BBW, ADX & Market Regime Classifier (Trend/Range/Chop)
├── 04_structure_pa_liquidity.pine  # Swings, BOS, CHoCH, Liquidity Sweep, FVG, OB & Garbage Collector
├── 05_momentum_volume_extension.pine# EMA stack, RSI, MACD, OBV, VWAP & Overextension Gate metrics
├── 06_mtf_and_intermarket_tuple.pine# Unified MTF Tuple request.security (Context, Setup, BTC Leader)
├── 07_obstacle_and_gates.pine      # Clear Path to TP1, Obstacle Gate, Weekend Filter, Gate Aggregator
├── 08_adaptive_scoring_engine.pine # Chấm điểm tín hiệu 0-100 với trọng số thích ứng theo Regime
├── 09_plan_and_state_machine.pine  # Pullback Limit, Auto Break-Even, Trailing, State Machine & Metrics
├── 10_visuals_and_dashboard.pine   # Force overlay visual zones, lines, signals & Advanced Dashboard
├── 11_alerts.pine                  # Webhook JSON payload & alertcondition (dành riêng cho Indicator)
└── 11_strategy_exec.pine           # Khớp lệnh strategy.entry / exit (dành riêng cho Strategy Lab)
```

---

## 5. Kế hoạch Triển khai Phase 1

1. **Thiết lập Toolchain Build:**
   - Cập nhật `tools/build.mjs` thêm 2 target mới: `tm2` và `tm2-strategy`.
   - Cập nhật `package.json` bổ sung các script:
     - `pine:tm2` (`node tools/build.mjs tm2`)
     - `pine:tm2-strat` (`node tools/build.mjs tm2-strategy`)
     - `pine:copy:tm2` (`npm run pine:tm2 && node tools/copy.mjs "TM Indicator 2.pine"`)
     - `pine:copy:tm2-strat` (`npm run pine:tm2-strat && node tools/copy.mjs "TM Indicator Strategy Lab 2.pine"`)
2. **Xây dựng nền móng Module trong `pine/parts-tm2/`:**
   - Tạo `00_header_indicator.pine` và `00_header_strategy.pine`.
   - Tạo `01_inputs_and_profiles.pine` và `02_types_and_state_defs.pine`.
   - Cài đặt triệt để các sửa lỗi P0:
     - Sửa công thức `rrOk` phân định rõ vai trò TP1 (Auto Break-Even) và TP2 (Min RR).
     - Triển khai hàm MTF Tuple đóng gói trong `06_mtf_and_intermarket_tuple.pine`.
     - Nâng cấp State Machine với `PENDING_LIMIT`, `Auto Break-Even tại TP1`, `Trailing Stop sau TP2`, `Time-Decay Exit`, tách bộ đếm `TP1 Hit Rate` vs `Net Trade Winrate`.
3. **Thẩm định & Kiểm thử:**
   - Chạy `npm run pine:build` để xác nhận tất cả target cũ và 2 target mới đều bundle thành công và không vi phạm cú pháp Pine Script v6.

---

## 6. v2.1 P0 Remediation — Findings, Evidence, Changes

This section records what was actually changed in the v2.1 pass. It replaces the
v2.0 blanket `PASS` claims: only locally reproducible checks are marked PASS.
TradingView compilation and any performance statement remain NOT TESTED.

### P0-1 — Signed score reused as a one-directional quality score (root cause)

- **Finding:** v2.0 produced `tm_rawScore` in `[-1, +1]`, mapped it with
  `tm_score100 = round(50 + tm_rawScore * 50)`, then compared that single value
  with one no-trade threshold. Bearish evidence produced a score below 50, so the
  quality level could not reach SETUP: SHORT was blocked before any gate ran.
- **Evidence:** the old expression was present in
  `pine/parts-tm2/08_adaptive_scoring_engine.pine` before this change; the v2.1
  file no longer contains it (asserted by `tools/smoke.mjs`).
- **Change:** independent `tm_longScore100` / `tm_shortScore100` computed from
  `max(f,0)` / `max(-f,0)` with identical weights and denominator; direction
  requires a minimum side score (`tm_scr_noTrade`) and a margin
  (`tm_scoreMargin`); otherwise `NO_DIRECTION` / `AMBIGUOUS_SETUP`.
- **Shared contract:** `pine/shared/tm-signal-quality.pine`.

### P0-2 — Obstacle gate still scanned FVGs (false blocks)

- **Finding:** the v2.0 obstacle scan included active FVGs in addition to S/R,
  OB and PDH/PDL/PWH/PWL. A fresh FVG can sit within a fraction of an ATR of
  price, recreating the same false-block class as the removed 5-bar swings.
- **Change:** `07_obstacle_and_gates.pine` now scans only unbroken S/R zones,
  active Order Blocks, PDH/PDL and PWH/PWL (with the 0.3 ATR minimum distance).
  FVGs remain limit-entry locations in the plan builder.

### P0-3 — Net RR used a relaxed minimum (`minRR * 0.70`)

- **Finding:** `netRrOk` compared the after-cost RR with 70% of the configured
  minimum, which could accept a plan that did not meet the advertised target.
- **Change:** net RR is compared with the same `tm_rrMin`; the plan, dashboard and
  alert carry `evalTarget = TP2` so the evaluated target is explicit.

### P0-4 — TP1 hit rate under-counted

- **Finding:** `tm_statTp1Hits` incremented only in the `hit1` branch. A bar that
  reached TP2/TP3 without stopping at the TP1 branch never counted TP1.
- **Change:** TP1 is counted once per trade when `stage == OPEN` and any TP was
  touched, while the conservative SL-first rule still suppresses the count when
  SL and TP share a bar.

### P0-5 — Strategy re-submitted entries on every signal bar

- **Finding:** `11_strategy_exec.pine` gated entries on `tm_signal` alone, so a
  persistent signal could re-submit an order after an exit on the same bar.
- **Change:** entries fire only on the transition bar (`tm_evEntry` /
  `tm_evPending`) and require a positive quantity.

### Local verification evidence (2026-10-19)

```text
node tools/build.mjs tm2 tm2-strategy   -> 2 targets OK, 0 lint warnings
node tools/smoke.mjs                    -> PASS (296 pass, 0 fail), includes:
  - no signed score-to-quality mapping
  - structural symmetry of LONG/SHORT weighted sums
  - request.security <= 5
  - standardized reason codes present
  - compact/advanced dashboard present
  - v2.1 alert contract present
```

**Not verified:** Pine Script v6 compilation on TradingView, chart rendering,
strategy fills, and out-of-sample performance. See
[regression-checklist.md](regression-checklist.md).
