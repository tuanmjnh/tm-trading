# Price Action MTF — bộ chỉ báo riêng theo phương pháp Nh Kiến Thức Trading

> **Nguồn:** 17 video `D:\Trading\nhkienthuctrading` → phương pháp chuẩn hóa tại
> [xau-price-action-method.md](../xau/xau-price-action-method.md),
> lộ trình afterfix và đối chiếu tại [xau-pa-pine-build.md](../xau/xau-pa-pine-build.md).
>
> **Mục đích:** Bộ chỉ báo chuyên biệt mang tên **`Price Action MTF`** (nguồn `pine/parts-price-action-mtf/`, Version: 1.0.0)
> hiện thực hóa trọn vẹn phương pháp Price Action & Đa khung thời gian của kênh Nh Kiến Thức Trading với 7 afterfix:
> Nhận diện mô hình phá Neckline (B-P0-1), Mở rộng nến IB/Doji/3S/3C (B-P0-2), Bộ máy hội tụ 3/3 Confluence Engine (B-P0-3),
> Volume Veto (B-P1-1), Cổng trạng thái thị trường Regime Gate (B-P1-2), Chốt lời Measured Move (B-P1-3), và Engulfing Streak (B-P1-4).

---

## 1. Cấu trúc build (Production Ready)

| Thành phần | Đường dẫn | Ghi chú |
|---|---|---|
| Nguồn parts | `pine/parts-price-action-mtf/` | 14 files (00_header đến 99_alerts + 91_strategy) |
| Hàm dùng chung | `pine/shared/common.pine`, `pine/shared/zones.pine` | hàm chuẩn hệ thống TM |
| Output indicator | `pine/dist/Price Action MTF.pine` | Version: 1.0.0, shorttitle: "PA MTF" |
| Output backtest | `pine/dist/Price Action MTF Backtest.pine` | Version: 1.0.0, shorttitle: "PA MTF BT" |
| Docs bộ này | `docs/indicator/price-action-mtf/` | thư mục tài liệu độc lập |

Target mới trong `tools/build.mjs`:

```js
'pa-mtf': {
  file: 'Price Action MTF.pine',
  dir: 'parts-price-action-mtf',
  shared: ['common.pine', 'zones.pine'],
  decl: `indicator("Price Action MTF", "PA MTF", overlay = false, dynamic_requests = true, max_boxes_count = 500, max_lines_count = 500, max_labels_count = 500)`,
},
'pa-mtf-strategy': {
  file: 'Price Action MTF Backtest.pine',
  dir: 'parts-price-action-mtf',
  shared: ['common.pine', 'zones.pine'],
  decl: `strategy("Price Action MTF Backtest", "PA MTF BT", overlay = true, pyramiding = 0, calc_on_order_fills = true, process_orders_on_close = true, dynamic_requests = true, max_boxes_count = 500, max_lines_count = 500, max_labels_count = 500, initial_capital = 10000, default_qty_type = strategy.percent_of_equity, default_qty_value = 100, commission_type = strategy.commission.percent, commission_value = 0.05, slippage = 0)`,
},
```

Script trong `package.json`:

```bash
npm run pine:pa-mtf                  # chỉ build bản indicator
npm run pine:pa-mtf:backtest         # chỉ build bản strategy
npm run pine:copy:pa-mtf             # build + copy Price Action MTF.pine vào clipboard
npm run pine:copy:pa-mtf:backtest    # build + copy Price Action MTF Backtest.pine vào clipboard
```

**Marker cắt file** (twin architecture):

| Target | `91_strategy.pine` | Pane Volume trong `95_viz.pine` | Kết quả |
|---|---|---|---|
| `pa-mtf` | **cắt** (`@part skip:pa-mtf`) | giữ | indicator đầy đủ pane volume + dashboard |
| `pa-mtf-strategy` | giữ | **cắt** (`@part skip:pa-mtf-strategy`) | strategy thuần overlay, không làm méo trục giá |

Hai bản dùng chung `10_config` qua `90_state` nên **tín hiệu backtest trùng khớp hoàn toàn với tín hiệu chart**.

---

## 2. Bảy afterfix cốt lõi theo phương pháp Nh Kiến Thức

### 2.1 B-P0-1 — Double/Triple Top-Bottom + Vai đầu vai (+ngược)
- **Vị trí code:** `30_structure.pine`
- **Quy tắc:** Mẫu hình chỉ ở trạng thái hình thành (forming); tín hiệu và alert **chỉ phát khi phá neckline** (chờ xác nhận, video n05).
- Neckline được tính tự động từ cực trị ngược chiều giữa các pivot bằng buffer an toàn.
- Cung cấp `pa_patHeight` để đo độ cao mô hình phục vụ cho TP Measured Move.

### 2.2 B-P0-2 — Inside bar, Doji, 3 White Soldiers / 3 Black Crows
- **Vị trí code:** `60_candle.pine`
- **Quy tắc:**
  - Inside bar: phát hiện nến nằm trọn trong nến trước; kích hoạt tín hiệu phá vỡ khi nến sau đóng cửa ngoài biên.
  - Doji: thân nến $\le 10\%$ biên độ (`pa_cp_dojiMax`), râu từ chối định hướng.
  - 3 Soldiers / 3 Crows: 3 nến liên tiếp cùng chiều, thân nến chiếm $\ge 50\%$ biên độ (`pa_cp_strongBody`).
- Mỗi mẫu có toggle riêng; khi tắt hết, điểm candle trùng khớp bản gốc.

### 2.3 B-P0-3 — Confluence Engine 0–3
- **Vị trí code:** `80_scoring_risk.pine` + `95_viz.pine` + `99_alerts.pine`
- **Quy tắc (3 yếu tố bắt buộc của video n08):**
  1. $\text{Trend HTF}$: Context TF / Setup TF đồng pha với hướng lệnh.
  2. $\text{Level}$: Giá chạm/ở trong dung sai $\pm 0.5\times\text{ATR}$ của S/R, FVG/OB, PDH/PDL, PWH/PWL, Session H/L, Trendline.
  3. $\text{Xác nhận}$: Nến đảo chiều (Pin, Engulfing, IB break, 3S/3C) hoặc phá vỡ cấu trúc/mô hình.
- Alert `PA MTF SETUP` chỉ phát khi hội tụ đủ **3/3**.

### 2.4 B-P1-1 — Volume Veto
- **Vị trí code:** `60_candle.pine`
- **Quy tắc:** Pin bar / Engulfing chỉ được cộng điểm tối đa khi volume của nến có tỷ lệ `pa_volRatio >= 1.2` (`pa_cp_volVetoR`). Nến volume yếu sẽ bị chiết khấu điểm, loại trừ bẫy thanh khoản thanh khoản thấp.

### 2.5 B-P1-2 — Regime Gate
- **Vị trí code:** `80_scoring_risk.pine`
- **Quy tắc:** Port từ `pine/parts-tm2/03_regime_and_volatility.pine`.
  - `TRENDING`: Cho phép đánh tiếp diễn theo cấu trúc.
  - `RANGING`: Chỉ cho phép vào lệnh tại biên (gần S/R trong phạm vi $0.35\times\text{ATR}$), cấm vào lệnh ở giữa vùng tích lũy.
  - `CHOPPY`: ADX yếu hoặc BBW Squeeze co thắt $\rightarrow$ đóng cổng, cấm vào lệnh.

### 2.6 B-P1-3 — TP Measured Move
- **Vị trí code:** `80_scoring_risk.pine`
- **Quy tắc:** Chế độ TP thứ 2 bên cạnh `Theo R`. Khoảng cách TP được đo bằng độ cao của mô hình giá (`pa_patHeight`) hoặc biên độ sóng đẩy trước đó và chiếu từ điểm Entry. Tự động fallback về R nếu thiếu dữ liệu độ cao.

### 2.7 B-P1-4 — Đếm chuỗi Engulfing (Streak)
- **Vị trí code:** `60_candle.pine` + `95_viz.pine`
- **Quy tắc:** Theo dõi số nến engulfing liên tiếp (`pa_engulfStreak`). Khi đạt $\ge 2$ nến, dashboard ghi nhận và cộng nhẹ điểm tin cậy `pa_streakBonus` (+0.5).

---

## 3. Dashboard nâng cao (2 $\times$ 27)

Dashboard của `Price Action MTF` kế thừa chuẩn hiển thị trong suốt (key xám đậm, value bạc, nền đen mờ) và bổ sung 4 dòng chuyên dụng:
1. **Hop tu (Confluence):** Hiển thị `x / 3` (xanh lá khi đạt 3/3, cam khi 2/3, xám khi $\le 1$).
2. **Regime:** `TRENDING` / `RANGING` / `CHOPPY` kèm chỉ báo `[SQZ]` khi thị trường nén.
3. **Engulf streak:** Số nến engulfing liên tiếp và điểm cộng thêm.
4. **TP Mode / Pattern:** Hiển thị chế độ TP (`R` hoặc `MM`) cùng mô hình giá đang kích hoạt (`DT`, `DB`, `HST`, `HSN`).

---

## 4. Giao thức kiểm tra đối chiếu A/B trên TradingView

1. Mở cùng một chart XAUUSD (khung H4 cho bối cảnh, M15/M5 cho điểm vào lệnh).
2. Thêm đồng thời:
   - `TM XAU Signals 2` (bản đối chứng cũ)
   - `Price Action MTF` (bản mới)
3. **Kiểm tra khi tắt Afterfix:** Tắt B-P0 và B-P1 trong settings của bản mới $\rightarrow$ tín hiệu và score 200 bar gần nhất phải tương đồng với bản cũ.
4. **Kiểm tra khi bật Afterfix:**
   - Hàng `Hop tu (Confluence)` hiển thị điểm 0–3.
   - Alert `PA MTF SETUP` chỉ xuất hiện khi đạt 3/3.
   - Các điểm phá neckline của Double Top / Vai đầu vai có nhãn `DT` / `HST` rõ ràng.
5. So sánh hiệu năng trên Strategy Tester giữa `TM XAU Signals 2` và `Price Action MTF Backtest`.

---

## 4.2 Webhook Alert Contract (`pa-mtf.signal.v1.0`)

Khi setup đạt đủ 3/3 yếu tố hội tụ (Confluence 3/3), chỉ báo sẽ kích hoạt cảnh báo Webhook JSON:

```json
{
  "v": 1,
  "version": "1.0.0",
  "schema": "pa-mtf.signal.v1.0",
  "action": "BUY",
  "sym": "XAUUSD",
  "tf": "15",
  "p": 2655.2,
  "sl": 2646.5,
  "tp": 2672.6,
  "tpMode": "Measured Move",
  "pattern": "Double Bottom Neckline",
  "score": 85,
  "confluence": 3,
  "reasons": "HTF_TREND,KEY_LEVEL,ENGULFING_CONFIRM",
  "time": "2026-10-19T14:30:00Z"
}
```

---

## 5. Nghiệm thu & Lệnh kiểm tra

```bash
npm run pine:build    # Build toàn bộ 7 active targets, 0 warning
npm run pine:test     # Smoke test: 253 pass, 0 fail
npm run docs:check    # Kiểm tra liên kết tài liệu toàn hệ sinh thái (1097 pass)
npm run verify        # Gate toàn diện (build + docs:check + 17 test suites)
```
