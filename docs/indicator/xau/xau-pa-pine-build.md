# Bộ B — Nh Kiến Thức (Price Action + MTF): độ khớp Pine & hướng build riêng

> **Nguồn:** 17 video `D:\Trading\nhkienthuctrading` → phương pháp chuẩn hóa tại
> [xau-price-action-method.md](./xau-price-action-method.md). Đây là **nửa Bộ B**
> của câu hỏi *"2 bộ video giống chỉ báo nào trong pine/"* — nửa Bộ A (LongKaco
> VSA + sweep) nằm ở [../vsa-wyckoff/vsa-sweep-pine-build.md](../vsa-wyckoff/vsa-sweep-pine-build.md).
>
> **Mục đích:** (1) đối chiếu từng quy tắc bộ B với code Pine hiện có, (2) chốt
> afterfix riêng, (3) định hướng build **một indicator mới tách biệt** (`parts-xau3`)
> để chạy song song với `TM XAU Signals 2` trên TradingView và tự kiểm tra kết quả thật.

---

## 1. Mapping — bộ B giống chỉ báo nào

| Chỉ báo | Mức độ | Vai trò |
|---|---|---|
| **`TM XAU Signals 2`** (`pine/parts-xau2/`) | **≈ 75%** | **Nền tốt nhất cho XAU** — structure + zones + candle + MTF + session |
| `TM Indicator 2` (`pine/parts-tm2/`) | ≈ 60% | Regime classifier, Mode A/B/C, Obstacle Gate — đúng các phương án tối ưu của method |
| `TM Indicator` v1 (`pine/parts-tm/`), `TM XAU Signals` v1, `TM Signals` | thấp | Legacy — **không** đầu tư thêm |

## 2. Đối chiếu layer-by-layer (bảng chính)

| Quy tắc trong video / method doc | Code thật | Khớp |
|---|---|---|
| Xu hướng HH/HL/LH/LL, không chống trend (n06) | `pine/parts-xau2/30_structure.pine` `x2_isHH/isLH/isHL/isLL` + `x2_trend` | ✅ |
| S/R = đỉnh/đáy cũ, flip khi phá (n07) | `pine/parts-xau2/50_zones.pine` — S/R + supply/demand | ✅ |
| Phá vỡ giả / quét thanh khoản (n07) | `pine/parts-xau2/40_liquidity.pine` — kind `Sweep`, `FAILBRK` | ✅ |
| Pin bar (râu ≥ 2× thân), engulfing (n04) | `pine/parts-xau2/60_candle.pine` `x2_bullPin` (`x2_cp_pinRatio = 2.0`), `x2_cp_engulf`, `cp_score` | ✅ |
| MTF: H4 bối cảnh → M15/M5 lệnh (n08) | `pine/parts-xau2/75_mtf.pine` — Context (H4/D) + Setup (H1/M15), VETO ở `80_scoring_risk.pine` | ✅ |
| SL sau cấu trúc + TP theo R | `pine/parts-xau2/80_scoring_risk.pine` — Entry/SL/TP + gate | ✅ |
| Session Asia/London/NY | `pine/parts-xau2/20_core.pine` | ✅ |
| Hội tụ 3 yếu tố 0–3 (n08) | Score 0–100 gộp 11 nhóm — **không tách** "trend + level + nến" | ⚠️ |
| 2/3 đỉnh–đáy, Vai đầu vai (+ngược) (n05) | **Không có** (grep toàn `pine/parts*` = 0 match) | ❌ |
| Inside bar, Doji, 3 Soldiers/Crows (n04) | **Không có** | ❌ |
| TP = measured move (độ cao mô hình) | Chỉ RR / pivot | ❌ |
| 2 engulfing liên tiếp mạnh hơn (n10) | Không đếm chuỗi — bar độc lập | ❌ |
| Regime trend vs range (phương án tối ưu #7) | **Có sẵn ở** `pine/parts-tm2/03_regime_and_volatility.pine` — chưa port sang xau2 | ⚠️ |

**Ưu điểm vượt video:** anti-repaint, risk gate bắt buộc, MTF VETO, score số hóa thay
vàocảm tính, 118 input bật/tắt riêng từng lớp.
**Nhược điểm so với video:** 4 dòng ❌ + chưa có confluence 3-mắt tách bạch.

---

## 3. Afterfix riêng của bộ B

| ID | Việc | Ưu tiên | File đích |
|---|---|---|---|
| **B-P0-1** | **Double/Triple Top-Bottom + Vai đầu vai (+ngược)** — 3 pivot, band ±0.5×ATR, chỉ phát tín hiệu **khi phá neckline** (chờ xác nhận, n05) | P0 | `parts-xau3/30_structure.pine` |
| **B-P0-2** | **Inside bar, Doji, 3 Soldiers/Crows** — ngưỡng định lượng theo method doc §3, toggle riêng | P0 | `parts-xau3/60_candle.pine` |
| **B-P0-3** | **Confluence score 0–3**: ① trend khung lớn đúng chiều ② giá tại level ±tol ③ nến xác nhận — alert `setup` chỉ khi 3/3 | P0 | `parts-xau3/80_scoring_risk.pine` + `95_viz.pine` |
| **B-P1-1** | **Volume veto**: pin/engulf chỉ cộng điểm đầy đủ khi ratio ≥ 1.2 (dùng `f_vsaColor` — hợp nhất bộ A vào bộ B) | P1 | `parts-xau3/60_candle.pine` |
| **B-P1-2** | **Regime gate** port từ `pine/parts-tm2/03_regime_and_volatility.pine` | P1 | `parts-xau3/80_scoring_risk.pine` |
| **B-P1-3** | **Measured-move TP** (độ cao mô hình / đoạn đẩy) thành chế độ TP thứ 3 | P1 | `parts-xau3/80_scoring_risk.pine` |
| **B-P1-4** | **Đếm chuỗi engulfing** — dashboard `engulf streak n`, streak ≥ 2 cộng nhẹ điểm (chưa raise alert riêng) | P1 | `parts-xau3/60_candle.pine` |
| **B-P2-1** | Backtest PA signals XAU 1h/4h phí thật + **baseline ngẫu nhiên** → tài liệu riêng trong `xau/` | P2 | báo cáo mới |
| **B-P2-2** | Walk-forward ≥ 2 năm (tách cửa sổ tune/test — xử lý tương quan, theo §5f của VSA) | P2 | báo cáo mới |
| **B-P2-3** | Chỉ sau B-P2-1/2 mới quyết định đưa streak 2-engulfing / confluence 3/3 vào alert tradeable | P2 | doc này |

---

## 4. Hướng build TÁCH BIỆT — bộ mới `parts-xau3`

### 4.1 Nguyên tắc cô lập (copy-on-write)

- **Không sửa** `pine/parts-xau2/`, `pine/parts-tm2/`, `pine/parts-vsa/` — bản cũ
  giữ nguyên để so sánh A/B thật trên **cùng một chart**.
- Tạo **`pine/parts-xau3/`** = copy `pine/parts-xau2/` làm nền, rồi: port regime
  từ tm2 (P1-2), port volume veto từ shared (P1-1), thêm afterfix P0 (B-P0-1..3).
- Spec tổng quát đã ghi sẵn tại [xau-price-action-method.md](./xau-price-action-method.md) §5.

### 4.2 Target mới trong `tools/build.mjs` (thêm vào `TARGETS`)

```js
xau3: {
  file: 'TM XAU Price Action.pine',
  dir: 'parts-xau3',
  shared: ['common.pine', 'sess-inputs.pine'],
  decl: `indicator("TM XAU Price Action", "TM XAU PA", overlay = false, dynamic_requests = true, max_boxes_count = 500, max_lines_count = 500, max_labels_count = 500)`,
},
'xau3-strategy': {
  file: 'TM XAU PA Backtest.pine',
  dir: 'parts-xau3',
  shared: ['common.pine', 'sess-inputs.pine'],
  decl: `strategy("TM XAU PA Backtest", "TM XAU PA BT", overlay = true, pyramiding = 0, process_orders_on_close = true, dynamic_requests = true, max_boxes_count = 500, max_lines_count = 500, max_labels_count = 500, initial_capital = 10000, default_qty_type = strategy.percent_of_equity, default_qty_value = 100, commission_type = strategy.commission.percent, commission_value = 0.05, slippage = 0)`,
},
```

Cùng mô hình twin như `vsa` / `vsa-strategy`: bản indicator cắt `91_strategy.pine`
(dùng marker `@part skip:xau3`), bản strategy cắt phần vẽ riêng của pane — hai bản
dùng chung `30/60/80` → tín hiệu backtest = tín hiệu chart.

### 4.3 Script mới trong `package.json` (4 key)

```json
"pine:xau3": "node tools/build.mjs xau3",
"pine:xau3-strat": "node tools/build.mjs xau3-strategy",
"pine:copy:xau3": "node tools/build.mjs xau3 && node tools/copy.mjs \"TM XAU Price Action.pine\"",
"pine:copy:xau3-strat": "node tools/build.mjs xau3-strategy && node tools/copy.mjs \"TM XAU PA Backtest.pine\""
```

### 4.4 Cột mốc (mỗi mốc phải qua cổng §4.6)

| Mốc | Việc | Tiêu chí nghiệm thu |
|---|---|---|
| **M0** | Copy `parts-xau2/` → `parts-xau3/`, đổi tên decl (bỏ `{{DECL}}` cũ), thêm 4 target + 4 script | `npm run pine:build` build đủ 13 target; `npm run pine:test` smoke cũ **296/0** giữ nguyên; `npm run docs:check` không thêm fail mới |
| **M1** | B-P0-3 Confluence 0–3 (dashboard + alert `setup` 3/3) — **mang lại giá trị ngay cả khi chưa thêm pattern mới** | smoke ≥ 4: điểm 0–3 đúng từng case; alert chỉ khi 3/3 |
| **M2** | B-P0-1 mẫu hình giá + B-P0-2 candle mới (toggle riêng từng mẫu) | smoke ≥ 8: phát đúng khi đủ điều kiện, **không** phát trước khi phá neckline; toggle OFF = khớp y bản xau2 |
| **M3** | B-P1-1 volume veto + B-P1-2 regime gate + B-P1-4 streak | smoke ≥ 6: cùng nến, điểm khác khi volume thấp; range = không phát tiếp diễn |
| **M4** | B-P1-3 measured-move TP + bản strategy `xau3-strategy` | build 13 target; strategy exit dùng TP mode mới |
| **M5** | Đối chiếu A/B trên TV (§4.5) + ghi kết quả vào doc này | bạn tự xác nhận trên chart thật |

### 4.5 Giao thức kiểm tra KẾT QUẢ THẬT (TradingView)

1. Thêm **`TM XAU Signals 2`** (cũ) và **`TM XAU Price Action`** (mới) vào **cùng
   chart XAUUSD H4 + M15** — cùng mọi input mặc định.
2. So score + tín hiệu 200 bar gần nhất: khi mọi afterfix OFF phải **giống hệt**
   bản cũ; khi B-P0-3 ON phải xuất hiện dòng `Hop tu 0–3` và alert `setup` chỉ 3/3.
3. Strategy Tester song song 2 bản (commission 0.05%/side, spread XAU ~0.25–0.35):
   Net Profit / Percent Profitable / Max Drawdown — ghi bảng vào đây.
4. Lặp trên 1h/4h. **Không** chỉnh ngưỡng (pin ratio, band ATR…) trước khi có bảng (D12).

### 4.6 Cổg nghiệm thu chung (sau MỖI mốc)

```bash
npm run pine:build    # phải đủ 13 target, 0 warning
npm run pine:test     # smoke: assertion cũ giữ nguyên, mới tăng
npm run docs:check    # không thêm fail mới
```

---

## 5. Hạn chế

- Spec + lộ trình — code `parts-xau3` chưa có trên đĩa; bạn mới kiểm tra được kết quả
  thật từ mốc M0.
- Chưa có số liệu winrate/expectancy cho PA signals (B-P2-1) — **không con số lợi thế
  nào trong tài liệu này được xem là đã chứng minh**.
- Đánh giá mức độ khớp là tĩnh (code ↔ doc), chưa chạy chart thật.
