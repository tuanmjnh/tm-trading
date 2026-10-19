# Bộ A — LongKaco VSA + Sweep: độ khớp Pine & hướng build riêng

> **Nguồn:** 7 video `D:\Trading\longkaco.1988` → phương pháp chuẩn hóa tại
> [vsa-wyckoff-method.md](./vsa-wyckoff-method.md), số liệu đo tại
> [vsa-optimization.md](./vsa-optimization.md). Đây là **nửa Bộ A** của câu hỏi
> *"2 bộ video giống chỉ báo nào trong pine/"* — nửa Bộ B (Nh Kiến Thức, PA)
> nằm ở [../xau/xau-pa-pine-build.md](../xau/xau-pa-pine-build.md).
>
> **Mục đích:** (1) đối chiếu từng quy tắc bộ A với code Pine hiện có, (2) chốt
> afterfix riêng, (3) định hướng build **một indicator mới tách biệt** để bạn
> chạy song song với bản cũ trên TradingView và tự kiểm tra kết quả thật.

---

## 1. Mapping — bộ A giống chỉ báo nào

| Chỉ báo | Mức độ | Vai trò |
|---|---|---|
| **`TM VSA Wyckoff`** (`pine/parts-vsa/`) | **≈ 90%** | **Khớp nhất** — chính là hệ thống hóa method này |
| `TM Liquidity Sweep` (`pine/parts-sweep/`) | ≈ 70% | Nắm đúng khía cạnh "quét thanh khoản + volume" (v01/v02) |
| `TM Indicator 2` (`pine/parts-tm2/`) Mode B | ≈ 50% | Sweep + engulfing confirm trong 3 bar — hợp nhất 2 yếu tố |

## 2. Đối chiếu layer-by-layer (bảng chính)

| Quy tắc trong video / method doc | Code thật | Khớp |
|---|---|---|
| Level trước, volume sau | `pine/parts-vsa/30_levels.pine` — pivot H/T ± 0.5×ATR, `lvFresh` 60 | ✅ |
| Cột tím ratio ≥ 2.2 = gate | `pine/parts-vsa/20_volume.pine` — `tm_i_rP = 2.2`, 6 bucket | ✅ |
| SV/BC tại level + momentum | `pine/parts-vsa/40_events.pine` `tm_sigSV = tm_isPurple and tm_runDown and tm_nearSup and close > open` | ✅ |
| ST = retest volume thấp `< 1.2` | `tm_sigSTl/s` — `tm_quietST` + bán kính `retestT`×ATR | ✅ |
| Entry + SL ngoài cực trị + buffer | `tm_i_entryMode` (Market mặc định / Limit) + `tm_i_slBuf`×ATR | ✅ |
| TP theo R / pivot | `tm_i_tpMode` — `Theo R` mặc định (đã đo tốt hơn Pivot, §5c) | ✅ |
| Phí ăn hết lời 5m/15m | `fee_R` + `feeOk` + dashboard `Phi/R` | ✅ |
| Session XAU | `pine/shared/sess-inputs.pine` `f_sessionOk` | ✅ |
| **Sweep xảy ra TRƯỚC** SV/BC (râu vượt level rồi đóng lại) | ST không yêu cầu bar sweep trước | ❌ |
| **Pyramid** 3–5 lệnh con cùng zone (§6) | `pine/parts-vsa/50_strategy.pine` chỉ 1 lệnh/signal | ❌ |
| **CLX-E** — volume nổ tại target → chốt | Chưa có (method doc §8.4 ghi "v1.1") | ❌ |
| TP = zone đối diện / measured move | Chỉ R-cố định hoặc pivot | ⚠️ một phần |

**Ưu điểm vượt video:** chống repaint, tự đóng setup + hiện R thật, cảnh báo phí,
bản strategy twin cùng nguồn (không thể lệch indicator ↔ backtest).
**Nhược điểm so với video:** 3 dòng ❌ ở trên; level chỉ auto-pivot (video vẽ tay).

---

## 3. Afterfix riêng của bộ A

| ID | Việc | Ưu tiên | File đích |
|---|---|---|---|
| **A-P0-1** | Điều kiện **sweep-trước-ST**: ST chỉ hợp lệ nếu trong N bar trước có bar râu vượt level + đóng cửa quay lại (nếu tắt → y hệt hành vi cũ) | P0 | `parts-vsa2/40_events.pine` |
| **A-P1-1** | **TP measured-move** — thành chế độ thứ 3 cạnh `Theo R` / `Pivot` | P1 | `parts-vsa2/40_events.pine` |
| **A-P1-2** | **Pyramid option** cho bản strategy (`bt_pyramid = 1..5`, mặc định 1 = không đổi hành vi) | P1 | `parts-vsa2/50_strategy.pine` |
| **A-P1-3** | **CLX-E** — volume tím ngược chiều tại zone TP → cảnh báo chốt | P1 | `parts-vsa2/40_events.pine` + `60_viz.pine` |
| **A-P2-1** | Backtest method vsa 1h/4h + baseline ngẫu nhiên trước mọi chỉnh tham số (D12) | P2 | báo cáo `docs/indicator/vsa-wyckoff/` |

---

## 4. Hướng build TÁCH BIỆT — bộ mới `parts-vsa2`

> **✅ ĐÃ TRIỂN KHAI (2026-10-19) — khác tên so với spec ban đầu.** Bộ tách biệt đã có
> thật trên đĩa, nhưng đặt tên theo sản phẩm chứ không theo số phiên bản:
>
> | Spec ban đầu (mục này) | Đã triển khai thật |
> |---|---|
> | `parts-vsa2/` | **`pine/parts-longkaco-vsa/`** |
> | target `vsa2` / `vsa2-strategy` | **`lk-vsa` / `lk-vsa-strategy`** |
> | `TM VSA Wyckoff 2.pine` | **`LongKaco VSA.pine`** (678 dòng) |
> | `TM VSA Backtest 2.pine` | **`LongKaco VSA Backtest.pine`** (600 dòng) |
> | script `pine:vsa2` / `pine:vsa2-strat` | **script `pine:lk-vsa` / `pine:lk-vsa:backtest`** (+ 2 script `pine:copy:*`) |
> | docs `docs/indicator/vsa-wyckoff/` | **thư mục riêng `docs/indicator/longkaco-vsa/`** |
>
> **Trạng thái 4 mốc:** M0 (copy + target + script) ✅ · M1 (A-P0-1 sweep-trước-ST) ✅ ·
> M2 (A-P1-1 measured-move + A-P1-3 CLX-E + dashboard) ✅ · M3 (A-P1-2 pyramid) ✅ ·
> M4 (đối chiếu A/B trên TradingView) ⏳ **chưa chạy — chờ chart thật**.
>
> **Cổng nghiệm thu sau mỗi mốc (§4.6) — số thật trên máy này:**
> `npm run pine:build` → **13/13 target, 0 warning**; `npm run pine:test` →
> **PASS 346/0** (trước khi thêm bộ này: 296/0, tức **+37** assertion mới);
> `npm run docs:check` → **PASS 1093/0** (trước: 1060/0); `npm test` →
> **2474 pass / 0 fail, 17 suite**.
>
> **Đọc chi tiết tại [../longkaco-vsa/README.md](../longkaco-vsa/README.md)** (kiến trúc,
> afterfix, dashboard, alert, giao thức A/B) và
> [../longkaco-vsa/BUILD.md](../longkaco-vsa/BUILD.md) (spec từng file + 2 bẫy P0 phát hiện
> khi build). Hai điều chỉnh so với spec dưới đây, đều có lý do đã kiểm chứng:
>
> 1. **Pyramid KHÔNG chỉ đổi số lệnh** — `pyramiding` phải nâng 0 → 5, mà Pine **cộng dồn
>    lệnh cùng ID** khi pyramiding cho phép (docs TradingView *Concepts/Strategies →
>    Pyramiding*). Vì vậy đường N = 1 phải tự chặn bằng `strategy.position_size >= 0` /
>    `<= 0`, nếu không backtest A/B lệch ngay ở input mặc định.
> 2. **`calc_on_order_fills = true` được giữ** trong khai báo strategy mới (spec §4.2 bỏ sót),
>    để khớp chính xác bản cũ `TM VSA Backtest`.
>
> Phần dưới giữ nguyên như **biên bản spec gốc** để đối chiếu.

### 4.1 Nguyên tắc cô lập (copy-on-write)

- **Không sửa** `pine/parts-vsa/` hay `pine/parts-sweep/` — hai bản cũ giữ nguyên
  để so sánh A/B thật trên **cùng một chart**.
- Tạo **`pine/parts-vsa2/`** bằng cách copy toàn bộ `pine/parts-vsa/`, rồi apply
  afterfix ở §3. Tên file dist mới → cả 2 indicator gắn song song được.
- Mốc kiểm chứng của bản cũ (smoke cũ) **không đổi** — proving không có gì bị phá.

### 4.2 Target mới trong `tools/build.mjs` (thêm vào `TARGETS`)

```js
vsa2: {
  file: 'TM VSA Wyckoff 2.pine',
  dir: 'parts-vsa2',
  shared: ['common.pine', 'sess-inputs.pine'],
  decl: `indicator("TM VSA Wyckoff 2", "TM VSA Wyckoff 2", overlay = false, dynamic_requests = true, max_boxes_count = 500, max_lines_count = 500, max_labels_count = 500)`,
},
'vsa2-strategy': {
  file: 'TM VSA Backtest 2.pine',
  dir: 'parts-vsa2',
  shared: ['common.pine', 'sess-inputs.pine'],
  decl: `strategy("TM VSA Backtest 2", "TM VSA Backtest 2", overlay = true, pyramiding = 0, process_orders_on_close = true, dynamic_requests = true, max_boxes_count = 500, max_lines_count = 500, max_labels_count = 500, initial_capital = 10000, default_qty_type = strategy.percent_of_equity, default_qty_value = 100, commission_type = strategy.commission.percent, commission_value = 0.05, slippage = 0)`,
},
```

Marker `@part skip:` giữ nguyên mô hình của bản cũ: bản **vsa2** cắt `50_strategy`,
bản **vsa2-strategy** cắt `60_viz` — hai bản dùng chung `20/30/40` nên logic
sự kiện không thể lệch.

### 4.3 Script mới trong `package.json` (4 key)

```json
"pine:vsa2": "node tools/build.mjs vsa2",
"pine:vsa2-strat": "node tools/build.mjs vsa2-strategy",
"pine:copy:vsa2": "node tools/build.mjs vsa2 && node tools/copy.mjs \"TM VSA Wyckoff 2.pine\"",
"pine:copy:vsa2-strat": "node tools/build.mjs vsa2-strategy && node tools/copy.mjs \"TM VSA Backtest 2.pine\""
```

### 4.4 Cột mốc (mỗi mốc phải qua cổng §4.6)

| Mốc | Việc | Tiêu chí nghiệm thu |
|---|---|---|
| **M0** | Copy `parts-vsa/` → `parts-vsa2/`, đổi tên indicator/strategy trong `00_header.pine` (bỏ `{{DECL}}` cũ), thêm 4 target + 4 script | `npm run pine:build` build đủ 13 target; `npm run pine:test` smoke cũ vẫn **296/0** (bản cũ không đổi); `npm run docs:check` không thêm fail mới |
| **M1** | A-P0-1 sweep-trước-ST (input `tm_i_sweepReq`, mặc định bật) + alert mới | smoke mới ≥ 4 assertion: (a) tắt input = khớp y bản cũ, (b) bật = có bar sweep → ST, (c) thiếu bar sweep → bị loại |
| **M2** | A-P1-1 measured-move TP + A-P1-3 CLX-E + dashboard 2 dòng | build OK; smoke ≥ 4; dashboard hiện `TP mode: R/Pivot/MM` |
| **M3** | A-P1-2 pyramid cho `50_strategy.pine` | `bt_pyramid = 4` → 4 entry con cùng `tm_lvlT`; mặc định 1 = không đổi |
| **M4** | Bản đồ cảnh báo + đối chiếu A/B trên TV (§4.5) + ghi kết quả vào doc này | bạn tự xác nhận trên chart thật |

### 4.5 Giao thức kiểm tra KẾT QUẢ THẬT (TradingView)

1. Thêm **`TM VSA Wyckoff`** (bản cũ) và **`TM VSA Wyckoff 2`** (bản mới) vào **cùng chart**
   XAUUSD hoặc BTCUSDT 15m — cùng mọi input mặc định.
2. So từng tín hiệu `ST` trong 200 bar gần nhất: số lượng, vị trí, timestamp —
   kỳ vọng: **giống hệt** khi `sweepReq = OFF`; **ít hơn** khi `ON` (loại setup thiếu sweep).
3. Chạy song song 2 bản strategy trên Strategy Tester (commission 0.05%/side):
   Net Profit / Percent Profitable / Max Drawdown — ghi bảng so sánh vào đây.
4. Lặp lại trên 1h và 4h. **Không** chỉnh tham số nào trước khi có bảng này (D12).

### 4.6 Cổng nghiệm thu chung (sau MỖI mốc)

```bash
npm run pine:build    # phải đủ 13 target, 0 warning
npm run pine:test     # smoke: assertion cũ giữ nguyên, mới tăng
npm run docs:check    # không thêm fail mới
```

---

## 5. Hạn chế

- Hướng dẫn này là **spec + lộ trình**, chưa có code `parts-vsa2` trên đĩa — sau M0
  bạn mới có file để paste lên TV.
- Method chưa chứng minh lợi thế (xem [vsa-optimization.md](./vsa-optimization.md) §5f:
  7/9 cấu hình không vượt baseline ngẫu nhiên) — build để **đo**, không phải để tin.
- Đánh giá mức độ khớp là tĩnh (code ↔ doc), chưa chạy chart thật.
