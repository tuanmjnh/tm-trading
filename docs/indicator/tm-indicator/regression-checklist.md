# Regression Test Checklist — TM Indicator

> **Status:** Phase 1 Correctness Patches Completed
> **Reference Document:** [TM_Indicator_Roadmap.md](file:///d:/Applications/tm-trading/docs/indicator/tm-indicator/TM_Indicator_Roadmap.md)
> **Baseline File:** [TM XAU Signals 2.pine](file:///d:/Applications/tm-trading/pine/dist/TM%20XAU%20Signals%202.pine) (Frozen)
> **Active Target:** [TM Indicator.pine](file:///d:/Applications/tm-trading/pine/dist/TM%20Indicator.pine) (`pine/parts-tm/`)
> **Verification Gate:** `npm run verify` (`tools/build.mjs`, `tools/docs-check.mjs`, `tools/smoke.mjs`)

---

## 1. Bảng phân loại mức kiểm chứng (Verification Levels)

Mọi mục kiểm thử phải ghi rõ cấp độ kiểm chứng thực tế:
- **[L1] Static Review:** Kiểm tra mã nguồn, logic điều kiện, nhánh if/else và công thức toán học.
- **[L2] Pine Linter / Assembler:** `tools/build.mjs` lint theo cú pháp và kiểu dữ liệu `tools/pine-ref.json` (TradingView Pine v6).
- **[L3] TradingView Editor:** Biên dịch thực tế trên tài khoản TradingView.
- **[L4] Backtest Engine:** Kiểm định định lượng qua `TM Indicator Strategy Lab.pine` hoặc Node signal engine.

---

## 2. Checklist chi tiết

### 2.1 Tính toán & Quản trị Rủi ro (Calculation & Risk)

| Test Case | Trạng thái | Cấp độ | Bằng chứng & Ghi chú kỹ thuật |
|---|---|---|---|
| **LONG và SHORT đối xứng** | `PASS` | L1, L2 | `f_buildTMPlan()` xử lý đối xứng: LONG (`entry - dist`, `entry + rr*dist`), SHORT (`entry + dist`, `entry - rr*dist`). |
| **Entry, SL, TP không `na` khi valid** | `PASS` | L1, L2 | Điều kiện `valid = atrOk and dirOk and slOk and tpOk and rrOk`. Nếu bất kỳ mức nào `na`, `valid := false`. |
| **SL nằm đúng phía so với Entry** | `PASS` | L1, L2 | Kiểm tra `dir == 1 ? sl < entry : sl > entry` kết hợp `dist > 0.0`. |
| **TP nằm đúng phía so với Entry** | `PASS` | L1, L2 | Kiểm tra nghiêm ngặt: LONG (`entry < tp1 < tp2 < tp3`), SHORT (`entry > tp1 > tp2 > tp3`). |
| **RR tính đúng cho từng target** | `PASS` | L1, L2 | `tp1 = entry + dir * rr1 * risk`, `tp2 = entry + dir * r2 * risk`, `tp3 = entry + dir * r3 * risk`. |
| **Khắc phục lỗi chặn tín hiệu RR (P0-01)** | `PASS` | L1, L2 | Thêm `tm_rrTarget` (mặc định "TP2"). `evalRR = tm_rr2 (2.0R) >= tm_rrMin (1.5R)` -> `rrOk = true` mặc định. |
| **ATR bằng 0 hoặc `na`** | `PASS` | L1, L2 | `atrOk = not na(a) and a > 0.0`. Nếu `atr <= 0` hoặc `na`, `reason := "NO_ATR"` và `valid := false`. |
| **Score không vượt phạm vi 0–100** | `PASS` | L1, L2 | `f_clamp(wSum / wTotal, -1.0, 1.0)` -> `math.round(50 + rawScore * 50)` luôn nằm trong đoạn [0, 100]. |
| **No Trade có lý do giải thích** | `PASS` | L1, L2 | `reason` trong `TMPlan` phản ánh rõ: `NO_ATR`, `NO_DIR`, `BAD_SL`, `BAD_TP`, `LOW_RR`, `OK`. |
| **Score cao không vượt qua risk gate** | `PASS` | L1, L2 | `tm_signal = tm_plan.valid and tm_okFilter`. Dù Score = 95 nhưng `tm_plan.valid == false` thì lệnh vẫn bị chặn. |

---

### 2.2 MTF và Chống Repaint (MTF & Non-Repainting Policy)

| Test Case | Trạng thái | Cấp độ | Bằng chứng & Ghi chú kỹ thuật |
|---|---|---|---|
| **Context Close và EMA cùng timeframe (P0-02)** | `PASS` | L1, L2 | Lấy tuple `[close[1], ta.ema(close, len)[1]]` trong 1 lệnh `request.security()`. |
| **Setup Close và EMA cùng timeframe** | `PASS` | L1, L2 | Tương tự Context, lấy tuple `[close[1], ta.ema(close, len)[1]]` từ Setup TF. |
| **Không so sánh LTF Close với HTF EMA** | `PASS` | L1, L2 | `tm_ctxDir` tính bằng `tm_ctxClose > tm_ctxEma`, không còn dùng `close > tm_ctxEma`. |
| **Kiểm tra thứ tự Timeframe Hierarchy** | `PASS` | L1, L2 | `tm_tfHierarchyOk = secChart <= secSetup and secSetup <= secCtx`. Nếu ngược (ví dụ Chart H4 > Setup H1), cờ báo `TF_WARN` trên dashboard và tắt MTF gate. |
| **Nến HTF đã đóng (No Lookahead Leakage)** | `PASS` | L1, L2 | Luôn truy vấn `close[1]` và `ema[1]` với `lookahead = barmerge.lookahead_on` trên HTF. |
| **Bar realtime chưa đóng vs Bar confirmed** | `PASS` | L1, L2 | `tm_confirmOnly` (mặc định `true`) gate toàn bộ entry và event alerts qua `barstate.isconfirmed`. |
| **Biên dịch trên TradingView Editor** | `NOT TESTED` | L3 | Chưa kiểm thử trực tiếp trên TradingView Cloud (môi trường agent không có kết nối tài khoản TradingView). |

---

### 2.3 Vòng đời Vị thế State Machine (Position Lifecycle)

| Test Case | Trạng thái | Cấp độ | Bằng chứng & Ghi chú kỹ thuật |
|---|---|---|---|
| **SL chạm trước TP** | `PASS` | L1, L2 | `hitSl` kích hoạt trước -> `closed := true`, `exitReason := TM_EXIT_SL`, `statLosses += 1`. |
| **TP chạm trước SL** | `PASS` | L1, L2 | `hit1` / `hit2` nâng `posStage`. `hit3` kích hoạt `TM_EXIT_TP3`, `statWins += 1`. |
| **Cùng nến chạm cả SL và TP (P0-03)** | `PASS` | L1, L2 | Áp dụng chính sách bảo thủ: `if hitSl and (hit1 or hit2 or hit3)` xử lý đóng tại SL. |
| **Khắc phục lỗi Timeout tính nhầm thành TP1 (P0-03)** | `PASS` | L1, L2 | Khi `posBars >= maxHoldBars`: `exitReason := TM_EXIT_TIMEOUT`, `xExit := close`, realized R tính từ `close`. Không gán thành TP1. |
| **Thống kê phân biệt Win, Loss, Timeout** | `PASS` | L1, L2 | Đếm riêng `statWins`, `statLosses`, `statTimeouts`. |
| **Không đóng một trade hai lần (Idempotency)** | `PASS` | L1, L2 | `closed` chỉ bật 1 lần, chuyển sang `tm_needReset := true` để deferred reset ở nến kế tiếp. |
| **Độ chính xác và Lợi nhuận thực tế** | `NOT TESTED` | L4 | Chưa thực hiện backtest / walk-forward. Không tuyên bố tỷ lệ thắng hay lợi nhuận. |

---

### 2.4 Asset & Timeframe Profiles (Phase 2)

| Test Case | Trạng thái | Cấp độ | Ghi chú |
|---|---|---|---|
| **Asset profiles (XAU, BTC, ETH, Altcoins)** | `PASS` | L1, L2 | Tự động nhận diện ticker hoặc cấu hình thủ công 7 chế độ qua `tm_assetMode`. |
| **Crypto session neutral / off** | `PASS` | L1, L2 | `tm_cryptoSessionNeutral = true` tự động đưa session score về 1.0 cho Crypto 24/7. |
| **Bộ lọc thanh khoản Altcoin (Low-Liquidity Gate)** | `PASS` | L1, L2 | `tm_okAssetVol` chặn lệnh khi volume = 0 hoặc MA volume bất thường trên High-Risk Altcoin. |
| **Timeframe Hierarchy Guard** | `PASS` | L1, L2 | Kiểm tra `chart <= setup <= context`, hiển thị `TF_WARN` và hạ bias về trung tính nếu sai thứ bậc. |
| **Chuẩn hóa ngưỡng biến động theo ATR%** | `PASS` | L1, L2 | Toàn bộ SL/TP, retest, trendline và S/R dùng bội số ATR/ATR%, không dùng khoảng giá tuyệt đối cố định. |

---

### 2.5 Price Action, Indicators & 3-Layer Scoring (Phase 3)

| Test Case | Trạng thái | Cấp độ | Ghi chú |
|---|---|---|---|
| **Tách 3 tầng Signal Score / Trade / Risk Eligibility** | `PASS` | L1, L2 | Tách bạch: `tm_score100`, `tm_tradeEligible`, `tm_riskEligible`. `tm_signal = tm_okBar and tm_tradeEligible and tm_riskEligible`. |
| **Gating theo cấp độ chất lượng tối thiểu (`tm_minQuality`)** | `PASS` | L1, L2 | Cấu hình `WEAK`, `SETUP`, `STRONG`, `A+`. Ngưỡng `SETUP` (mặc định) chặn các tín hiệu `WEAK`. |
| **Báo cáo lý do NO TRADE minh bạch (`tm_noTradeReason`)** | `PASS` | L1, L2 | Hiển thị trực tiếp trên Dashboard: `NO_DIRECTION`, `QUALITY_BELOW_MIN`, `HTF_VETO`, `MTF_HIERARCHY`, `COOLDOWN_ACTIVE`, `MAX_DAY_LIMIT`, `LOW_LIQUIDITY`, hoặc lý do Risk Plan. |
| **Nhóm chỉ báo độc lập & chống tính trùng lặp** | `PASS` | L1, L2 | Momentum (RSI+MACD+DMI) và Volume (RelVol+OBV+VSA) được tính trung bình bên trong nhóm trước khi cộng trọng số. |
| **Khả năng bật/tắt từng tính năng độc lập** | `PASS` | L1, L2 | Mọi tính năng (BOS, CHoCH, MSS, Retest, FVG, OB, Candle, EMA, MTF, S/R) đều có toggle riêng biệt. |
| **Hiệu chuẩn xác suất thắng (Calibration)** | `NOT TESTED` | L4 | Điểm 0–100 là điểm tương đối (heuristic relative score), chưa hiệu chuẩn xác suất thắng định lượng ngoài mẫu. |

---

### 2.6 Futures Risk Model & Liquidation Safety (Phase 4)

| Test Case | Trạng thái | Cấp độ | Ghi chú |
|---|---|---|---|
| **Linear USDT-Margined Position Sizing** | `PASS` | L1, L2 | Tính toán $Q = (E \times R_{\%}) / \Delta P_{\text{sl}}$, Notional = $Q \times Entry$, Leverage thực tế = $Notional / E$. |
| **Trần đòn bẩy tối đa (Max Leverage Ceiling)** | `PASS` | L1, L2 | Kiểm tra `effLev <= tm_risk_maxLev * 1.05`. Vượt trần từ chối tín hiệu với mã `MAX_LEV_EXCEEDED`. |
| **Ước tính giá thanh lý (Liquidation Estimation)** | `PASS` | L1, L2 | Áp dụng công thức chuẩn cho Linear USDT Perpetual: Long `entry*(1 - 1/L + MMR)`, Short `entry*(1 + 1/L - MMR)`. |
| **Kiểm tra an toàn SL trước Liquidation (`SL_PAST_LIQ`)** | `PASS` | L1, L2 | Bắt buộc SL kích hoạt trước giá thanh lý: Long $sl > liq$, Short $sl < liq$. Nếu vi phạm từ chối với lý do `SL_PAST_LIQ`. |
| **Khấu trừ ma sát phí, trượt giá & Net RR** | `PASS` | L1, L2 | Tính `netRR = (evalRR * riskUsd - feeSlipUsd) / (riskUsd + feeSlipUsd)`. Gate nếu `netRR < tm_rrMin * 0.75` (`LOW_NET_RR`). |
| **Ngắt mạch chuỗi thua liên tiếp (Circuit Breaker)** | `PASS` | L1, L2 | `tm_consecLosses >= tm_risk_maxLosses` tự động kích hoạt `CIRCUIT_BREAKER` chặn tín hiệu mới cho tới ngày tiếp theo. |

---

### 2.7 Strategy Lab & Dedicated Backtest Engine (Phase 5)

| Test Case | Trạng thái | Cấp độ | Ghi chú |
|---|---|---|---|
| **Khai báo Strategy riêng biệt (Separation of Concerns)** | `PASS` | L1, L2 | Tạo riêng `TM Indicator Strategy Lab.pine` từ cùng bộ source `pine/parts-tm/` qua marker `// @part skip:tm`, bảo toàn 100% indicator. |
| **Đồng bộ hóa 100% logic tín hiệu & Risk Plan** | `PASS` | L1, L2 | Đọc trực tiếp `tm_signal`, `tm_plan.sl`, `tm_plan.tp*`, `tm_plan.posSize` từ lớp tính toán lõi, không tính lại độc lập. |
| **Hỗ trợ Long-only, Short-only, Long+Short** | `PASS` | L1, L2 | Tùy chọn cấu hình `tm_strat_dir` ("Long + Short", "Long Only", "Short Only"). |
| **Chiến lược chốt lời đa dạng & Partial Exit Ladder** | `PASS` | L1, L2 | Hỗ trợ TP1 (Conservative), TP2 (Balanced), TP3 (Runner), hoặc Full Ladder (1/3 chốt ở TP1, TP2, TP3). |
| **Mô hình hóa chi phí Commission & Slippage** | `PASS` | L1, L2 | Cấu hình chuẩn `commission_type = strategy.commission.percent`, `commission_value = 0.06%`, `slippage = 1` tick. |
| **Thoát lệnh Timeout trong Strategy Tester** | `PASS` | L1, L2 | Theo dõi số nến nắm giữ `tm_stratHoldBars`. Nếu $\ge tm_maxHoldBars$ thì gọi `strategy.close_all("TIMEOUT")`. |

---

### 2.8 Protocol Thử nghiệm Ablation & Walk-Forward (Phase 6)

| Test Case | Trạng thái | Cấp độ | Ghi chú |
|---|---|---|---|
| **Ablation Protocol Documentation** | `PASS` | L1 | Tài liệu hóa đầy đủ trong `docs/indicator/tm-indicator/ablation-walkforward-protocol.md` với 5 cấu hình thực nghiệm từ A (Baseline) tới E (Profiles). |
| **Phân chia dữ liệu theo trình tự thời gian (No Shuffling)** | `PASS` | L1 | Quy chuẩn: 60% Train (In-Sample), 20% Validation, 20% Test (Out-of-Sample). Tuyệt đối cấm xáo trộn dữ liệu thời gian. |
| **Thử nghiệm độ nhạy ma sát (Frictional Sensitivity)** | `PASS` | L1 | Thử nghiệm các dải biến thiên phí $0.02\% - 0.10\%$ và trượt giá $0 - 5$ ticks để phát hiện edge giả tạo. |
| **Thực hiện chạy Walk-forward thực tế trên dữ liệu sàn** | `NOT TESTED` | L4 | Chưa chạy trên dữ liệu tick lịch sử đầy đủ của từng sàn (cần người dùng nạp file vào Strategy Tester TradingView). |

---

### 2.9 Webhook Alerts & Signal ID Deduplication (Phase 7)

| Test Case | Trạng thái | Cấp độ | Ghi chú |
|---|---|---|---|
| **Signal ID Deduplication (`sig_id`)** | `PASS` | L1, L2 | Mỗi tín hiệu sinh mã duy nhất: `TM_{ticker}_{interval}_{timestamp}_{dir}` giúp server webhook deduplicate chính xác. |
| **Cấu trúc Alert Payload JSON chuẩn hóa** | `PASS` | L1, L2 | Đầy đủ: `project`, `v`, `ts`, `exchange`, `symbol`, `tf`, `action`, `sig_id`, `side`, `price`, `sl`, `tps`, `pos_size`, `eff_lev`, `liq`, `net_rr`. |
| **Kết nối sự kiện thoát lệnh (TP/SL/Timeout) với Signal ID** | `PASS` | L1, L2 | Các alert `TAKE_PROFIT`, `STOP_LOSS`, `TIMEOUT` đều đính kèm `sig_id` của lệnh gốc tương ứng. |
| **Loại bỏ `alertcondition()` khỏi Strategy Lab** | `PASS` | L1, L2 | Tách biệt qua marker `// @part skip:tm-strategy` do Pine Script cấm dùng `alertcondition` trong `strategy()`. |

---

### 2.10 Hoàn thiện Tài liệu & Release Candidate (Phase 8)

| Test Case | Trạng thái | Cấp độ | Ghi chú |
|---|---|---|---|
| **Tài liệu Hướng dẫn Sử dụng Toàn diện** | `PASS` | L1 | Hoàn thành `docs/indicator/tm-indicator/tm-indicator-guide.md`. |
| **Danh mục Giới hạn Kỹ thuật (Known Limitations)** | `PASS` | L1 | Hoàn thành `docs/indicator/tm-indicator/known-limitations.md`. |
| **Bảo tồn 100% Baseline gốc & Cơ chế Rollback** | `PASS` | L1, L2 | Giữ nguyên `pine/parts-xau2/` và `pine/dist/TM XAU Signals 2.pine`. Lệnh rollback sẵn sàng: `npm run pine:copy:xau2`. |
| **Kiểm định toàn bộ hệ thống (`npm run verify`)** | `PASS` | L1, L2 | 9/9 targets build hợp lệ, 456 doc checks pass, 2.326/2.326 tests pass qua 17 test suites. |
