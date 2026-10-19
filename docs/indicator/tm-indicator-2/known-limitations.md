# Known Limitations & Platform Constraints — TM Indicator 2 (v2.0)

> **Document Type:** System Constraints & Risk Disclosure  
> **Target Script:** `TM Indicator 2.pine` & `TM Indicator Strategy Lab 2.pine`  
> **Status:** APPROVED

---

## 1. Giới hạn Cơ chế Khớp lệnh Lịch sử (Historical Bar Granularity)

1. **Thứ tự Giá trong Nến (Intra-bar Price Sequence):**
   - Trên dữ liệu nến lịch sử, Pine Script chỉ nhận 4 giá trị: Open, High, Low, Close. Nếu một nến có biên độ cực lớn chạm cả mức Dừng lỗ (SL) và Chốt lời (TP), hệ thống mặc định áp dụng chính sách **bảo thủ (SL-first)**: coi như lệnh bị dừng lỗ trước.
   - Điều này có thể khiến kết quả backtest trên lịch sử hơi thấp hơn thực tế khi giá thực tế chạm TP trước khi hồi về SL, nhưng đảm bảo tính trung thực và không bị "lạc quan hóa" hiệu năng (over-optimistic bias).

2. **Khớp lệnh Chờ (Limit Order Fill Simulation):**
   - Trong Strategy Tester, lệnh `Pullback Limit` được ghi nhận là khớp nếu `low <= limitPrice` (với lệnh Mua) hoặc `high >= limitPrice` (với lệnh Bán).
   - Trong thị trường thực tế, nếu giá chỉ vừa chạm đúng mức Limit mà không xuyên qua (Touch without penetration), lệnh có thể không được khớp do độ sâu hàng chờ (Order book queue depth).

---

## 2. Giới hạn Phần cứng & Nền tảng Pine Script v6

1. **Giới hạn Lời gọi Đa Khung Thời Gian (`request.security` Limit):**
   - Pine Script v6 quy định giới hạn nghiêm ngặt về số lượng và tần suất gọi dữ liệu ngoài khung. Hệ thống đã tối ưu triệt để bằng cách gộp toàn bộ dữ liệu vào đúng **5 lời gọi Tuple duy nhất** (Context TF, Setup TF, Daily, Weekly, BTC Leader).
   - Không nên tùy tiện thêm các lệnh gọi `request.security` riêng lẻ vào code mà không đóng gói qua Tuple.

2. **Giới hạn Đối tượng Vẽ Đồ họa (Drawing Objects Quota):**
   - TradingView giới hạn tối đa 500 `box`, 500 `line`, và 500 `label` hoạt động đồng thời trên biểu đồ.
   - Hệ thống giải quyết bằng cơ chế **Garbage Collection (Dọn rác bộ nhớ)**: Tái sử dụng các đối tượng vùng và chỉ vẽ lại các vùng S/R, FVG chưa bị xuyên thủng tại nến cuối cùng (`barstate.islast`).

3. **Yêu cầu Dữ liệu Mã Tham chiếu BTC (BTC Leader Symbol):**
   - Bộ lọc `BTC Leader Filter` mặc định kết nối tới mã `BINANCE:BTCUSDT.P`.
   - Nếu người dùng sử dụng biểu đồ trên một sàn giao dịch không hỗ trợ mã này hoặc thị trường Forex/Vàng không có mã BTC tương ứng, hãy điều chỉnh input `tm_btcTicker` về mã BTC có sẵn trên tài khoản của bạn (ví dụ: `COINBASE:BTCUSD`).

---

## 3. v2.1 Operational Constraints

1. **Offline compiler is unavailable.** The repository lint (`tools/build.mjs`)
   validates function names, parameter names, argument order and basic syntax,
   but it is not the Pine Script compiler. A green local build does not prove the
   script compiles on TradingView. Compile and chart checks are listed as
   `NOT TESTED` in the regression checklist until a human runs them.

2. **Mode filtering reduces sample size.** `tm_modeFilterOn` defaults to `true`,
   so a trade now requires an enabled A/B/C mode whose direction matches the
   score. This is intentional (validation-first), but it can reduce the number of
   candidates substantially. Any comparison with v2.0 must report candidate,
   eligible, pending, filled and closed counts separately.

3. **Mode C is opt-in.** The range classifier has not been validated
   out-of-sample. `tm_modeC_on` defaults to `false`; enabling it is an experiment,
   not a recommendation.

4. **Ablation configs change weights, not safety.** `tm_ablationMode` (A-E) only
   changes which feature groups contribute to the directional score. Execution
   gates stay under their own toggles; config E is not a shortcut for turning on
   every gate.

5. **Net RR is stricter than v2.0.** The after-cost RR must now meet the same
   `tm_rrMin` target as the gross RR. On high-fee instruments this can reject
   plans that v2.0 accepted; that is the intended correction, not a regression.

6. **Two dashboard layouts share one table.** Switching between Compact and
   Advanced recreates the table with 12 or 34 rows. The advanced row indexes are
   stable and documented in `docs/indicator/tm-indicator-2/README.md`.

7. **Fill-bar targets are not counted.** When a limit order fills on a bar, the
   TP/SL intrabar order is unknown. v2.1 keeps the conservative stop (a stop on
   the fill bar is honored) but defers TP evaluation to the next bar, so a bar
   that fills and reaches TP1 is not counted as a TP1 hit. This can slightly
   understate TP1 hit rate on fast reversal bars; it avoids an optimistic fill
   assumption that cannot be verified without intrabar data.
