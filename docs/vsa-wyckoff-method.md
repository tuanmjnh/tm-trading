# Phương pháp giao dịch VSA – Wyckoff Volume (bộ LongKaCo)

Tài liệu chuẩn hóa từ 11 ảnh trong `private/longkaco/` — 5 cặp *setup → kết quả* + 1 ảnh standalone.
Mục đích: chuẩn hóa method + spec cho **bộ chỉ báo riêng** — nay đã triển khai là
**`TM VSA Wyckoff`** (`pine/parts-vsa/`, cài bằng `npm run copy:vsa` — chi tiết §8).
**Không nhét vào `TM Signals BTC`** — bản đó chỉ có filter volume + histogram phụ; `TM VSA Wyckoff` là indicator độc lập.

> **TRỌNG TÂM: cột TÍM (purple, ratio ≥ 2.2× MA) = volume đột biến.** Toàn bộ method xoay quanh
> việc tìm bar tím **tại level**. Các màu còn lại (đỏ/cam/lá/xanh/xám) chỉ là bối cảnh — không
> phải tín hiệu. Bản trên chart có thêm vàng/cyan ở bucket trung tính, không ảnh hưởng vì
> **tím luôn là bucket cao nhất ở cả hai phiên bản**.

---

## 1. Triết lý cốt lõi (4 nguyên tắc)

1. **Level trước, volume sau** — volume event chỉ có nghĩa khi nằm tại support/resistance/zone đã vẽ,
   sau một pha đẩy (run) đủ mạnh. Không level → bỏ qua tín hiệu, dù volume xanh tím cỡ nào.
2. **Volume là nhiệt kế sự chú ý** — cột purple (≥2.2× MA) = climax/stopping (đối ứng lớn được hấp thụ);
   cột xanh/silver (<0.8× MA) = trầm lặng (test thành công, no supply/no demand).
3. **Nhận tín hiệu trên CLIMAX, vào lệnh trên TEST** — bar climax cho *chữ ký* vùng có hấp thụ;
   lệnh mở khi giá **retest** level với volume thường/thấp (secondary test). Ví dụ: ETH 5m vào ở nến
   test (blue) *sau* spike 3M; BTC 4m vào 4 lệnh limit *sau* cụm stopping volume.
4. **Theo dõi volume dọc đường** — giữa trend mà volume khô (<0.8× MA nhiều bar liên tiếp) = ease of
   movement → giữ lệnh (XAU slide 4,293 → 4,210 với volume gần như biến mất). Volume nổ lại purple
   **tại target** = stopping/climax ở chiều ngược → chốt lời.

---

## 2. Thanh volume chuẩn hóa (nguồn `docs/VSA Volume.pine`)

### 2.1 Công thức

```
volMA    = ta.rma(volume, len)            // Wilder MA, len mặc định 20
ratio    = volume / volMA
```

Wilder MA (bản v4 trong file gốc, tương đương `ta.rma`):

```
volMA := nz(volMA[1]) + (volume - nz(volMA[1])) / len
```

Lưu ý kỹ thuật:
- Khoảng `len` bar đầu tiên MA ramp từ 0 → ratio bị thổi phồng, màu chưa đáng tin (vô hại trên chart dài).
- Volume lấy theo **exchange/symbol của chart đang xem** (Binance, Bybit, OKX, MEXC, HTX khác nhau).

### 2.2 Bảng bucket màu (6 mức — đúng theo file nguồn)

| ratio (volume/MA20) | Màu | Tên | Diễn giải VSA |
|---|---|---|---|
| ≥ 2.2 | purple | Ultra High | **Unusual volume** — stopping volume, buying/selling climax, splash |
| 1.8 – 2.2 | red | Very High | Effort lớn — test/khẳng định supply-demand |
| 1.2 – 1.8 | orange | High | Nỗ lực trên trung bình — attack / test |
| 0.8 – 1.2 | green | Normal | Bình thường — vô nghĩa riêng lẻ |
| 0.4 – 0.8 | blue | Low | **Quiet** — no demand (nến lên) / no supply (nến xuống) |
| < 0.4 | silver | Very Low | Rất trầm lặng — exhaustion trong trend |

Pipeline phân loại (từ file nguồn, 6 bucket phủ kín không sót):

```pine
volUltraHigh = volume >= 2.2 * volMA
volVeryHigh  = volume >= 1.8 * volMA and volume < 2.2 * volMA
volHigh      = volume >= 1.2 * volMA and volume < 1.8 * volMA
volNormal    = volume >= 0.8 * volMA and volume < 1.2 * volMA
volLow       = volume >= 0.4 * volMA and volume < 0.8 * volMA
volVeryLow   = volume <  0.4 * volMA
palette      = purple : red : orange : green : blue : silver
```

### 2.3 Ý nghĩa then chốt

- **Volume cao tại level** không tự nó là tín hiệu — nó chỉ nói "có người khổng lồ đang hấp thụ ở đây".
  Hướng đi tiếp do giá quyết định (close vượt qua hay bị phản kháng lại).
- **Volume thấp khi retest** = không còn lực chống → test thành công (Wyckoff *Secondary Test*).
- **Volume thấp khi trend** = ít lực cản (ease of movement) → tin tưởng di chuyển.

> **Ghi chú palette:** ảnh trên chart có thêm vàng/cyan (bản mở rộng, rơi vào bucket trung tính/thấp).
> Không quan trọng — **chỉ màu tím (≥2.2) là tín hiệu**, và tím luôn là bucket cao nhất cả hai phiên bản.
> Bảng trên lấy theo file `VSA Volume.pine` (nguồn chuẩn).

---

## 3. Ngữ cảnh bắt buộc (level-first)

Quan sát cả 5 cặp ảnh — **luôn luôn** có ít nhất 2 trong 3 yếu tố:

1. **Đường ngang** (màu vàng): support/resistance, đường kẻ tay.
2. **Zone** (band xám / xanh đậm): supply-demand zone, vùng tích lũy.
3. **Pha đẩy trước đó**: downtrend/uptrend đủ lâu (hoặc mô hình W-bottom, breakout–retest).

Volume event đứng một mình, giữa vùng loạn → **bỏ**. Rule: nếu không chỉ ra được level
trong vòng ±0.3% quanh bar signal thì không phải setup.

---

## 4. Thư viện event VSA – Wyckoff chuẩn hóa

**Nhóm tín hiệu chính (cột TÍM, ratio ≥ 2.2):** **SV, BC, CLX-E** — chỉ 3 event này phát tín hiệu,
phải luôn kèm điều kiện "cột tím". **Nhóm bối cảnh:** ST (trigger vào lệnh), NS/ND/EoM (xác nhận /
giữ / loại — theo bucket xanh–xám, KHÔNG phải tín hiệu độc lập).

### 4.1 Chú thích ký hiệu nhanh (legend)

| Ký hiệu | Tên (EN) | Ý nghĩa | Nhãn trên chart | Hướng |
|---|---|---|---|---|
| **SV** | Stopping Volume | **Dừng bán** — áp lực bán cạn kiệt, nến đóng phục hồi tại support | ▲ tím, dưới nến | Chuẩn bị **LONG** — chờ ST |
| **BC** | Buying Climax | **Đỉnh mua** — mua hưng phấn bị đánh bật (upper-wick) tại resistance | ▼ đỏ, trên nến | Chuẩn bị **SHORT** — chờ ST |
| **ST** | Secondary Test | **Thử lại** — retest cực trị SV/BC với volume thấp = điểm vào lệnh | ↑ teal (LONG) / ↓ cam (SHORT) | **ENTRY** |
| **NS** | No Supply | **Không cung** — nến down hẹp, volume thấp: seller hết lực | ◆ xanh dương, dưới nến | Xác nhận **LONG** |
| **ND** | No Demand | **Không cầu** — nến up hẹp, volume thấp: buyer hết lực | ◆ bạc, trên nến | Xác nhận **SHORT** |
| **EoM** | Ease of Movement | **Dễ di chuyển** — volume thấp kéo dài, giá trôi theo trend | dashboard `EoM: Yes (n)` | **GIỮ** lệnh đến target |
| **CLX-E** | Climax Exit | **Climax tại target** — volume tím ngược chiều tại zone TP để chốt | — (chưa bật, v1.1) | **CHỐT** / dời SL |
| **TIM** | Purple bar | **Cột tím** — volume ≥ 2.2× MA(20); gate bắt buộc để SV/BC được phát | cột histogram màu tím | gate tín hiệu |

Màu cột histogram theo bucket volume: xem **§2.2**. Nhãn ST/NS/ND xuất hiện theo điều kiện
trong bảng §4.2; chú thích từng dòng dashboard: xem **§8.3**.

### 4.2 Điều kiện định lượng

Định lượng ban đầu (mặc định để test; chỉnh theo TF khi có số liệu backtest):

| Mã | Event | Điều kiện định lượng | Vị trí | Hành động |
|---|---|---|---|---|
| **SV** | Stopping Volume | ratio ≥ 2.2 (purple), bar đóng phục hồi (close > open, có tick up) | tại support sau pha giảm | Chuẩn bị **LONG** — chờ TEST |
| **BC** | Buying Climax | ratio ≥ 2.2 (purple), bar có upper-wick (nỗ lực bị đánh bật) | tại resistance/supply sau pha tăng | Chuẩn bị **SHORT** — chờ TEST |
| **ST** | Secondary Test (entry trigger) | retest lại cực trị của SV/BC với ratio < 1.2 (green/blue/silver) | cùng level | **ENTRY** (limit) |
| **NS** | No Supply | nến down hẹp, ratio < 0.8 (blue/silver) | tại support | Xác nhận LONG / nạp lệnh |
| **ND** | No Demand | nến up hẹp, ratio < 0.8 (blue/silver) | tại resistance / sau pha tăng | Cảnh báo distribution — né LONG, chuẩn bị SHORT |
| **EoM** | Ease of Movement | ratio < 0.8 kéo dài ≥ 3 bar trong khi giá đi xa theo trend | giữa trend | **GIỮ** lệnh đến target |
| **CLX-E** | Climax tại target | ratio ≥ 2.2 (purple) tại zone/level TP (chiều ngược vị thế) | tại target | **CHỐT** / dời SL về entry |

Minh họa trong ảnh:
- **SV + ST**: BTC 4m (cụm purple ở 85,1xx → vào 85,26x), ETH 5m (spike 3M ở 2,630 → test blue → vào 2,657).
- **BC**: XAU 15m (purple 10M ở 4,300), ZEC 10m (cụm purple 1,650–1,675), ETH 1h (tại zone 2,715).
- **EoM**: XAU slide — volume gần như 0 suốt 4,293 → 4,210.
- **CLX-E**: XAU ở vùng TP 4,213 xuất hiện purple dừng lại.
- **ND/NS**: chưa có mũi tên minh họa trong ảnh → giả định theo chuẩn VSA, cần kiểm chứng.

## 5. Các setup chuẩn hóa (rút từ 5 cặp ảnh)

### Setup A — LONG Stopping Volume tại support
**Ảnh:** `photo_2026-09-22_16-26-51.jpg` → `photo_2026-09-29_22-43-57.jpg` (BTC 4m),
`photo_2026-09-29_22-43-28.jpg` → `photo_2026-09-29_22-43-30.jpg` (ETH 5m)

1. Giá chạy xuống support, **phá nhẹ rồi hút về** (spring/fakeout) — BTC 4m break 85,400 xuống 85,100.
2. **SV** xuất hiện tại cực trị (cụm purple / spike 3M).
3. Giá retest lại support với volume thường/thấp (**ST**) — ETH 5m nến test blue ở 2,650–2,660.
4. **Entry limit** tại/vừa trên level (không market chase).
5. **SL** dưới cực trị nến SV + buffer.
6. **TP** = zone/level đối diện kế tiếp (chốt bớt khi chạm zone đầu).

Thực tế trong ảnh:
- BTC 4m: SV ~85,100–85,300 → 4 lệnh limit 0.25 @ 85,261–85,288 → TP 86,090 → 87,400 (resistance).
- ETH 5m: capitulation 3M @2,630 → test @2,650–2,660 → entry 2,657.31, SL 2,630, TP zone ~2,825.

### Setup B — SHORT Buying Climax tại resistance/supply
**Ảnh:** `photo_2026-09-28_09-45-29.jpg` → `photo_2026-09-29_22-42-42.jpg` (XAU 15m),
`photo_2026-09-24_07-04-59.jpg` → `photo_2026-09-29_22-43-37.jpg` (ZEC 10m)

1. Giá chạy lên supply/resistance zone (band xám / đường vàng).
2. **BC** — purple bar + upper-wick (hoặc cụm purple) ngay tại zone.
3. Nến đỏ đóng dưới → **ST/retest vào lại zone** với volume thường → entry.
4. **SL** trên đỉnh BC + buffer (red box).
5. **TP** = demand zone bên dưới / trendline; giữ khi volume khô (**EoM**), chốt khi **CLX-E**.

Thực tế trong ảnh:
- XAU 15m: BC purple 10M @4,300 → entry 4,293.5, SL 4,305.6, TP 4,213.3 (trendline) → **+2,072.70**;
  volume khô suốt đường rơi, purple dừng lại ở đáy.
- ZEC 10m: supply 1,640–1,650 → entry ~1,623, SL ~1,675, target zone thấp hơn nhiều
  (green box mở rộng về ~790); kết quả dừng tại 1,506 (gần liquidation 1,502) → **+745.63%**.

### Setup C — SHORT đảo chiều support → resistance (supply flip)
**Ảnh:** `photo_2026-09-29_22-41-59.jpg` → `photo_2026-09-29_22-42-22.jpg` (ETH 1h)

1. Vùng 2,715–2,725 từng là support → bị break.
2. Giá hồi từ dưới lên **test lại zone đã flip thành resistance** (không cần climax rõ — zone tự
   là supply) → short tại 2,711.
3. SL trên zone (2,745), TP cấu trúc bên dưới: 2,650 (zone trung gian) → mở rộng 2,380.
4. Kết quả: **Short 500X +1,176.55%**, giá dừng 2,639.

### Setup D — LONG W-bottom + pyramid limit (scaling)
**Ảnh:** `photo_2026-09-25_07-42-00.jpg` (BTC 30m, standalone — đã có kết quả)

1. Mô hình **W** (đáy đôi, đáy 2 sâu hơn = spring) tại support 83,600–83,835.
2. **SV** cụm purple ở đáy (mũi tên vàng).
3. **Pyramid**: 5 lệnh limit 0.15 chồng nhau 83,724–83,785, cùng TP 84,587, SL 82,786 (dưới đáy 2).
4. RR ≈ 1:1.5 mỗi lệnh, tổng basket ~1:2.

> Các setup khác nhau nhưng **cùng một bộ khung**: `level + event + test + entry limit + SL ngoài
> cực trị + TP zone đối diện`.

---

## 6. Quy tắc execution chuẩn hóa

| Hạng mục | Quy tắc chuẩn | Số đo từ ảnh |
|---|---|---|
| **Vào lệnh** | LIMIT tại level, chỉ sau nến xác nhận (retest/test). Không market chase. | entry luôn "đến" level, không rượt giá |
| **Pyramid** | 3–5 lệnh con cùng zone, cùng TP (tuỳ size) | 4×0.25 (BTC 4m), 5×0.15 (BTC 30m) |
| **SL** | Ngoài cực trị nến SV/BC + buffer (đề xuất 0.5×ATR(14)) | 0.3–1.2% tùy TF |
| **TP** | Zone/level đối diện kế tiếp; partial khi vào zone | RR quan sát ~1:2 → 1:5 |
| **Giữ lệnh** | Volume khô (EoM) → giữ. Volume nổ purple tại target → chốt (CLX-E) | XAU slide |
| **TF** | Intraday: 4m / 5m / 10m / 15m / 1h | 11 ảnh |
| **Sản phẩm** | Crypto perp (BTC/ETH/ZEC) + XAU perp | Binance/Bybit/OKX/MEXC/HTX |
| **Leverage / risk** | ⚠️ Ảnh dùng 100X–500X và thoát gần liquidation — **KHÔNG chuẩn hóa theo**. Đề xuất: risk ≤ 1–2% vốn/lệnh, leverage ≤ 10–20X | 3 thẻ +1.176%, +745%, +460% |
| **Chốt lời** | KHÔNG lấy liquidation price làm target (ảnh ZEC/ETH gần liq mới thoát) | |

---

## 7. Checklist giao dịch (8 bước)

1. [ ] Xác định **TF** (4m–1h) và **level** (đường vàng / zone) đang có hiệu lực.
2. [ ] Chờ **pha đẩy** (run) rõ ràng tới level đó.
3. [ ] Quan sát **volume event** tại level: SV/BC (purple ≥2.2) hoặc zone flip (Setup C).
4. [ ] Chờ **ST/test**: retest level với volume < 1.2× MA + nến xác nhận.
5. [ ] Đặt **entry limit** tại level (pyramid 3–5 lệnh nếu muốn).
6. [ ] **SL** ngay khi vào: ngoài cực trị signal + 0.5×ATR.
7. [ ] **TP** zone đối diện; đặt sẵn; partial vào zone đầu.
8. [ ] Theo dõi dọc đường: **EoM giữ** — **CLX-E chốt**. Volume nổ tại target chiều ngược → đóng.

---

## 8. Chỉ báo đã triển khai — `TM VSA Wyckoff` (Pine v6)

> **Đã build, smoke PASS 158/0.** Cài: `npm run copy:vsa` → Pine Editor → `Ctrl+V` → **Add to chart**.
> ⚠️ **Sửa 2026-10-01** (xem [vsa-optimization.md](./vsa-optimization.md)): Entry là lệnh **limit**
> nên auto-close nay **chỉ xét TP/SL sau khi entry đã khớp** (`tm_lvlFill`); cùng bar vừa khớp vừa
> xuyên SL → tính SL. Dashboard thêm dòng **Phi/R** + **slBuf tối thiểu** — ràng buộc toán học:
> `fee_R = phí_round-trip / (slBuf × ATR%)`, và **`slBuf = 0.5` là bất khả thi trên 5m/15m**.
> Cột TÍM (ratio ≥ `tm_i_rP` = 2.2× MA Wilder) là **gate bắt buộc**: SV/BC chỉ được phát khi có cột TIM.
> Kinh nghiệm `TM Signals BTC`: mọi creation vẽ **phải** gắn `force_overlay = true` (có 9 chỗ);
> histogram/MA là pane của chính indicator nên KHÔNG cần `display.pane`; chạy `npm run verify` trước khi dán.

### 8.1 Cấu trúc (đã có thật)

- `indicator("TM VSA Wyckoff", "TM VSA Wyckoff", overlay = false, dynamic_requests = true, max_* = 500)` — 397 dòng dist.
- Nguồn: `pine/parts-vsa/` — `00_header, 10_inputs, 20_volume, 30_levels, 40_events, 50_strategy, 60_viz, 70_alerts`; **không đụng** `pine/parts/` của TM.
- Dùng chung `pine/shared/common.pine` (marker `{{SHARED}}`): `f_sessionOk` (loc phiên XAU/XAG), `f_vsaColor` / `f_vsaName` (6 bucket) — `TM Signals BTC` cũng dùng lại 2 hàm này.
- Target `vsa` trong `tools/build.mjs` (`dir: parts-vsa`); scripts: `npm run vsa`, `npm run copy:vsa`.

### 8.1b Bản twin backtest — `TM VSA Backtest` (263 dòng)

Cùng một nguồn `parts-vsa`, chỉ khác **khai báo `strategy(...)`** và bị cắt phần vẽ:

| Target | File dist | `50_strategy` | `60_viz` |
|---|---|---|---|
| `vsa` | `TM VSA Wyckoff.pine` | **cắt** (`@part skip:vsa`) | giữ |
| `vsa-strategy` | `TM VSA Backtest.pine` | giữ | **cắt** (`@part skip:vsa-strategy`) |

- Vì dùng chung `20_volume` / `30_levels` / `40_events`, **logic sự kiện không thể lệch** giữa 2 bản — smoke test so sánh trực tiếp các dòng `tm_sig* =` và `tm_lvl* :=` của hai file dist.
- Bridge **đọc thẳng** `tm_lvlE/S/T` do `40_events` tính, không tính lại SL/TP → backtest và indicator dùng đúng một bộ mức.
- Vào lệnh ngay bar tạo setup ST (`tm_btLong = tm_i_btOn and tm_sigSTl and tm_hasSV`), khối lượng = `%equity / close`.
- Scripts: `npm run vsa:backtest`, `npm run copy:vsa:backtest`.
- `alertcondition` có ở **cả hai** bản (`flags.topLevelOnly`, hợp lệ trong cả indicator lẫn strategy).

### 8.2 Inputs (tên thật, mặc định)

| Input | Default | Ghi chú |
|---|---|---|
| `tm_i_rP` (TIM) | 2.2 | **NGƯỠNG CHÍNH** — dưới đây không có SV/BC |
| `tm_i_len` (MA volume) | 20 | Wilder `ta.rma` |
| `tm_i_rVH / rH / rN / rL` | 1.8 / 1.2 / 0.8 / 0.4 | màu bối cảnh, không gate tín hiệu |
| `tm_i_run` | 5 | momentum: `close` so với `close[run]` |
| `tm_i_testR` | 1.2 | ngưỡng nhận ST (ratio < ngưỡng; luôn giữ < TIM) |
| `tm_i_lvTol` / `tm_i_lvFresh` | 0.5 × ATR / 60 nến | bề rộng + hiệu lực vùng H/T |
| `tm_i_pivLen` | 20 | auto level qua `ta.pivotlow/high` |
| `tm_i_volMin` | 0 (tắt) | volume tuyệt đối tối thiểu — cho alt coin thanh khoản thấp |
| Session (`tm_i_sessOn` / `tm_i_sess` / `tm_i_tz`) | OFF | **bắt buộc bật với XAU/XAG/forex** (crypto để tắt) |
| `tm_confirmOnly` | true | chỉ chốt tín hiệu khi nến đóng (chống repaint) |
| `tm_i_lvlOn` | true | vẽ 3 đường **Entry/SL/TP** tự động từ setup ST gần nhất |
| `tm_i_slBuf` | 0.5 | buffer SL = `0.5` × ATR(14) ngoài cực trị nến SV/BC (§6) |
| `tm_i_rrFb` | 2.0 | TP fallback = 2R — chỉ dùng khi pivot đối diện thiếu/nhầm chiều |

### 8.3 Outputs

1. **Histogram 6 màu** + line MA trong pane riêng của indicator.
2. **Nhãn trên giá** (`plotshape`, `force_overlay = true`): SV (tím ▲), BC (đỏ ▼), ST LONG/SHORT, NS/ND (kim cương).
3. **Đường H/T dashed** vàng, anchor tại bar pivot, tạo lại mỗi tick cuối (xóa cũ trước khi vẽ).
4. **Đường Entry/SL/TP** tự động (`tm_i_lvlOn`), cập nhật khi có ST — anchor từ bar ST đến bar cuối, tạo lại mỗi tick cuối:
   - **Entry** (trắng, liền) = cực trị nến SV (long) / BC (short) — đúng vị trí "limit tại level" của §6;
   - **SL** (đỏ, dashed) = cực trị ± `tm_i_slBuf` × ATR(14) — đúng quy tắc §6;
   - **TP** (xanh lá, dashed) = pivot đối diện nếu RR ≥ 1 ("zone đối diện kế tiếp"), ngược lại fallback `tm_i_rrFb` × R;
   - nhãn `Entry`/`SL`/`TP` tại **bar cuối, kèm giá trị** (đọc được số chính xác cạnh trục giá) — **mỗi loại đúng 1 nhãn**;
   - cây nến vào lệnh = **bar ST** (đã có nhãn `ST` trên giá) — *không* vẽ thêm nhãn `Entry` thứ hai tại đó để tránh trùng/chồng label;
   - **tự đóng setup**: theo dõi từng bar sau ST — giá chạm TP hoặc SL (ưu tiên SL nếu cùng 1 bar) → xóa 3 đường, chỉ còn nhãn `TP`/`SL` (xanh/đỏ) tại **bar chạm** để xem lại kết quả;
   - setup ST mới hơn thay thế setup cũ (chỉ giữ 1 setup gần nhất); tắt bằng `tm_i_lvlOn`.
5. **Dashboard** 2×9 (`force_overlay`): Che do, TF, Volume ratio (tím nếu ≥ 2.2), Bucket, số cột TIM/20, sự kiện gần nhất + tuổi, EoM, phiên, TIM gần nhất.
6. **Alerts** 6 loại: `VSA SV`, `VSA BC`, `VSA ST LONG`, `VSA ST SHORT`, `VSA NS`, `VSA ND`.

Chú thích từng dòng dashboard (2 cột × 9 dòng, góc phải trên chart):

| Dòng | Ý nghĩa |
|---|---|
| **Che do** | `Nen dong` = chỉ chốt tín hiệu khi nến đóng (chống repaint); `Realtime` = tính cả tick chưa đóng |
| **TF** | khung thời gian của chart (`timeframe.period`) |
| **Volume ratio** | volume bar hiện tại / MA(20) Wilder — hiển thị **tím** nếu ≥ `tm_i_rP` (2.2) |
| **Bucket** | bucket volume hiện tại theo bảng màu §2.2 — **tím** nếu đang ở mức cực trị |
| **Cot TIM/20** | số cột tím trong 20 bar gần nhất |
| **Su kien gan nhat** | sự kiện VSA gần nhất + số bar đã qua (vd `ST 62 bar`) |
| **EoM** | `Yes (n)` = trạng thái Ease of Movement liên tiếp n bar (n ≥ 3) → quy tắc **GIỮ**; `No` = chưa có |
| **Phien** | phiên giao dịch: `Tat` (tắt session) / `Trong phien` / `Ngoai phien` |
| **TIM gan nhat** | số bar tính từ cột tím gần nhất; `chua co` = chưa có cột tím nào |

### 8.4 So với spec v1 — khác biệt có chủ đích

| Mục | Spec v1 (§8 cũ) | Đã triển khai |
|---|---|---|
| Đặt tên | `VSA Wyckoff [v1]` | **`TM VSA Wyckoff`** (quy ước TM: file dist = tên TV) |
| Momentum | ≥ 8 bar directional | `close ≠ close[tm_i_run]`, mặc định 5 bar — đơn giản, đủ |
| ST | retest ±0.3% cực trị SV/BC | ± `tm_i_retestT` × ATR quanh giá SV/BC + nến phục hồi + volume < `tm_i_testR` |
| NS/ND | range < 0.5×ATR | volume < bucket **Normal** + tại H/T + hướng nến (không chết vì ATR nhỏ) |
| EoM | sự kiện riêng | trạng thái dashboard `tm_eomRun ≥ 3` (ratio < 0.8 + \|Δclose\| ≥ 0.5×ATR) → quy tắc **GIỮ** lệnh |
| CLX-E | alert exit | **chưa có** — cần vị thế/TP zone → v1.1 kèm strategy twin |
| Level tay | mode manual | v1 chỉ auto pivot (vẽ tay để TradingView, như trong ảnh) |
| Entry/SL/TP | checklist tính tay | **auto**: Entry = cực trị SV/BC, SL = ± `tm_i_slBuf`×ATR, TP = pivot đối diện (RR≥1) hoặc `tm_i_rrFb`×R — 3 đường + 3 nhãn giá tại bar cuối (mỗi loại 1 nhãn), **tự đóng khi chạm TP/SL** (nhãn kết quả tại bar chạm) |

Quy tắc chống repaint: mọi tín hiệu đi qua `tm_okBar = tm_confirmOnly ? barstate.isconfirmed : true`.


---

## 9. Bảng nguồn ảnh (11 file)

| # | File | Nội dung | Cặp |
|---|---|---|---|
| 1 | photo_2026-09-22_16-26-51.jpg | BTC 4m — setup LONG (mũi tên SV) | cặp 5 |
| 2 | photo_2026-09-24_07-04-59.jpg | ZEC 10m — setup SHORT tại 1,650 | cặp 4 |
| 3 | photo_2026-09-25_07-42-00.jpg | BTC 30m — setup W-bottom + 5 lệnh (standalone) | lẻ |
| 4 | photo_2026-09-28_09-45-29.jpg | XAU 15m — setup SHORT (mũi tên BC) | cặp 3 |
| 5 | photo_2026-09-29_22-41-59.jpg | ETH 1h — setup SHORT supply flip | cặp 1 |
| 6 | photo_2026-09-29_22-42-22.jpg | ETH 1h — kết quả Short 500X +1,176.55% | cặp 1 |
| 7 | photo_2026-09-29_22-42-42.jpg | XAU 15m — kết quả +2,072.70 | cặp 3 |
| 8 | photo_2026-09-29_22-43-28.jpg | ETH 5m — setup LONG (mũi tên) | cặp 2 |
| 9 | photo_2026-09-29_22-43-30.jpg | ETH 5m — kết quả Long 500X +460.41% | cặp 2 |
| 10 | photo_2026-09-29_22-43-37.jpg | ZEC 10m — kết quả Short 100X +745.63% | cặp 4 |
| 11 | photo_2026-09-29_22-43-57.jpg | BTC 4m — kết quả 4 lệnh buy +201…+207 | cặp 5 |

---

## 10. Rủi ro & câu hỏi mở

1. **Palette ảnh ≠ palette file** — ảnh có thêm vàng/cyan; file `VSA Volume.pine` chỉ 6 màu.
   Cần đối chiếu indicator đang gắn trên chart.
2. **Level vẽ tay hay auto** — ảnh 100% vẽ tay; v1 nên bắt đầu manual, auto pivot là option.
3. **ND/NS/EoM chưa có minh họa** trong ảnh → theo chuẩn VSA, cần backtest xác nhận.
4. **Volume khác nhau giữa sàn** — ratio tính nội tại nên OK, nhưng absolute volume không so sánh được.
5. **XAU**: volume theo session (giờ vàng), spread/swap chưa mô hình hoá → cần session filter.
6. **Survivorship** — ảnh chỉ khoe lệnh thắng; trước khi tin edge, chạy bản strategy(backtest) với
   đúng rule mục 5–6 để đo winrate/RR.
7. **Leverage 100–500X + thoát gần liq** là thói quen ảnh chụp, KHÔNG phải một phần chuẩn hóa.

