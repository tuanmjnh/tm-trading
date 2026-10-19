# LongKaco VSA — spec build chi tiết

Tài liệu này là **spec kỹ thuật** của bộ `LongKaco VSA` (nguồn `pine/parts-longkaco-vsa/`).
Tổng quan + giao thức kiểm tra: [README.md](./README.md).

> Trạng thái: **đã build, 7 active targets, verify PASS 17/17 suites**.
> Production VSA suite chính thức: `pine/parts-longkaco-vsa/` (Version: 1.0.0).

---

## 1. Nền tảng Phương pháp & Kiến trúc Độc lập

Bộ chỉ báo này kế thừa trọn vẹn phương pháp Volume Spread Analysis & Wyckoff từ series video LongKaco (nguồn `D:\Trading\longkaco.1988`), hoàn thiện 4 afterfix cốt lõi nhằm giải quyết triệt để các hạn chế của VSA truyền thống:

| Chỉ báo | Nguồn parts | Output dist | Vai trò |
|---|---|---|---|
| **LongKaco VSA** | `pine/parts-longkaco-vsa/` | `LongKaco VSA.pine` | Bản chỉ báo trực quan hóa tín hiệu, volume VSA, sweep levels & webhook alert |
| **LongKaco VSA Backtest** | `pine/parts-longkaco-vsa/` | `LongKaco VSA Backtest.pine` | Bản chiến lược tự động kiểm định trên TradingView Strategy Tester |

*(Lưu ý: Bộ mã nguồn cũ `parts-vsa` và `parts-sweep` đã được đóng gói và lưu trữ sau khi bộ LongKaco VSA hoàn thành kiểm định và được đưa vào sử dụng chính thức).*

Cả hai bản Indicator và Backtest chia sẻ chung toàn bộ các file tính toán logic (`10_inputs`, `20_volume`, `30_levels`, `40_events`), đảm bảo **tín hiệu kiểm định trên Strategy Tester đồng nhất 100% với tín hiệu phát trên chart**.

---

## 2. Sơ đồ phụ thuộc tín hiệu

```
20_volume ── tm_isPurple ─┬─→ 40_events: tm_sigSV / tm_sigBC        (volume tím tại H/T)
                          └─→ 40_events: tm_clxE                    (A-P1-3, climax tại target)
30_levels ── tm_lastPLow/PHigh, tm_lowFresh/highFresh ─┬─→ SV/BC (nearSup/nearRes)
                                                       └─→ A-P1-1: tm_mmUp / tm_mmDn (measured move)
40_events ── tm_svPx / tm_bcPx ──→ A-P0-1: tm_sweepUpBar / tm_sweepDnBar
40_events ── tm_stRawL/S ─(AND cổng sweep)─→ tm_sigSTl/S ─→ tm_lvlE/S/T ─→ tm_lvlFill/Done
50_strategy ── đọc thẳng tm_lvlE/S/T + tm_lvlDir (không tính lại)  → 2 bản không thể lệch
```

Nguyên tắc giữ nguyên từ bản cũ: **bridge đọc thẳng state**, không tính lại SL/TP; mọi
tín hiệu đi qua `tm_okBar` (chống repaint).

---

## 3. Thay đổi theo từng file

| File | Dòng | Thay đổi |
|---|---|---|
| `00_header.pine` | 3 | không đổi (`//@version=6` + `{{DECL}}` + `{{SHARED}}`) |
| `10_inputs.pine` | 84 → 105 | + `tm_i_tpMode` thêm lựa chọn MM, `tm_tpMM`, `tm_tpDash`; + `tm_i_sweepReq`, `tm_i_sweepWin`; + `tm_i_clxOn`, `tm_i_clxR` |
| `20_volume.pine` | 41 | không đổi |
| `30_levels.pine` | 65 | không đổi |
| `40_events.pine` | 137 → 235 | + A-P0-1 (sweep bar, `tm_stRawL/S`, `tm_noSweep`, state dashboard); + A-P1-1 (`tm_mmUp/Dn`, `tpM1/tpM2`); + A-P1-3 (`tm_clxE`, `tm_clxMax`) |
| `50_strategy.pine` | 26 → 60 | + pyramid (`tm_i_btPyr`, `tm_i_btStep`, `f_pyrEntry`, ID `L1..Ln`), guard `position_size` cho N = 1 |
| `60_viz.pine` | 131 → ~150 | + 2 `plotshape` CLX-E, nhãn `· pyr xN`, + 2 dòng dashboard, đổi `tm_tpDash` |
| `70_alerts.pine` | 6 → 8 | + `LK VSA NO SWEEP`, `LK VSA CLX-E`; đổi tiền tố `VSA …` → `LK VSA …` |

Đổi tiền tố alert là **cố ý**: hai bản gắn cùng chart sẽ cùng bắn alert, tiền tố khác nhau
giúp phân biệt nguồn trên webhook/telegram. Nếu bạn có rule tự động bắt chuỗi `"VSA SV"`,
phải cập nhật sang `"LK VSA SV"`.

---

## 4. A-P0-1 — chi tiết cài đặt sweep

```pine
tm_sweepUpBar = tm_hasSV and not na(tm_svPx) and low  < tm_svPx and close > tm_svPx
tm_sweepDnBar = tm_hasBC and not na(tm_bcPx) and high > tm_bcPx and close < tm_bcPx

var int tm_sweepUpBl = na
var int tm_sweepDnBl = na
if tm_sweepUpBar
    tm_sweepUpBl := bar_index
if tm_sweepDnBar
    tm_sweepDnBl := bar_index

tm_sweepL = tm_hasSV and not na(tm_sweepUpBl) and tm_sweepUpBl >= tm_svBar and f_sweepRecent(tm_sweepUpBl, tm_i_sweepWin)
tm_sweepS = tm_hasBC and not na(tm_sweepDnBl) and tm_sweepDnBl >= tm_bcBar and f_sweepRecent(tm_sweepDnBl, tm_i_sweepWin)
tm_sweepGateOn = tm_i_sweepReq and not tm_wyckoffMode

tm_sigSTl = tm_stRawL and (not tm_sweepGateOn or tm_sweepL)
tm_sigSTs = tm_stRawS and (not tm_sweepGateOn or tm_sweepS)
```

Quyết định thiết kế (kèm lý do — đọc trước khi định sửa):

1. **Không dùng lại UDT/mảng của `parts-sweep`.** Bản sweep theo dõi nhiều level trong mảng
   (`array<TmLevel>`); bộ này chỉ có **một** mốc SV và **một** mốc BC đang hiệu lực, nên hai
   biến `int` là đủ và rẻ hơn nhiều. Dùng chung code sẽ kéo theo cả state machine của sweep.
2. **Chỉ xét bar sweep SAU bar SV/BC** (`>= tm_svBar`). Quét xảy ra *trước* climax không
   phải "retest sau climax"; loại nó đi để cổng không bị vô hiệu.
3. **Không tính cổng ở chế độ Wyckoff.** Ở đó Spring/UTAD đã chính là "phá vỡ rồi đóng cửa
   trở lại" — thêm cổng nữa là điều kiện kép vô nghĩa.
4. **`tm_sweepBars` là tuổi lần sweep gần nhất**, không phải tuổi của lần sweep đã mở setup
   hiện tại. Với dashboard thì đủ; nếu đem đi nghiên cứu thì phải lưu lại mốc sweep **tại
   thời điểm ST** thành biến `var` riêng.
5. **Tín hiệu thô tách thành `tm_stRawL/S`** chứ không gộp — cần thiết để bắn alert `NO SWEEP`
   (cho biết đang mất bao nhiêu setup vì luật mới) và để smoke so với bản cũ.

Cổng sweep là **P0** trong backlog bộ A ([../vsa-wyckoff/vsa-sweep-pine-build.md](../vsa-wyckoff/vsa-sweep-pine-build.md) §3),
nên mặc định **BẬT**. Muốn A/B: tắt `tm_i_sweepReq` → điều kiện ST rút đúng về bản cũ.

---

## 5. A-P1-2 — chi tiết pyramid

```pine
tm_i_btPyr  = input.int(1, "Pyramid - so lenh con cung zone", minval = 1, maxval = 5, ...)
tm_i_btStep = input.float(0.25, "Pyramid - buoc lech entry (x ATR)", ...)
tm_btMulti  = tm_i_btPyr > 1

f_pyrEntry(int i, int n, float level, int dir) =>
    float off = (i - (n + 1) / 2.0) * tm_i_btStep * tm_atr
    dir == 1 ? level + off : level - off

if tm_btLong and not tm_btMulti and strategy.position_size >= 0
    strategy.entry("Long", strategy.long, qty = tm_btQty, comment = "LK VSA ST LONG")
if tm_btLong and tm_btMulti
    for i = 1 to tm_i_btPyr
        strategy.entry("L" + str.tostring(i), strategy.long, qty = tm_btQty, limit = f_pyrEntry(i, tm_i_btPyr, tm_lvlE, 1), ...)
```

Với N = 3 (`step` = 0.25 ATR): lệnh con lệch `−0.25, 0, +0.25` ATR quanh `tm_lvlE`.
N = 4: `−0.375, −0.125, +0.125, +0.375`.

### Vì sao phải có guard `strategy.position_size` (bẫy P0)

`strategy.entry` **cộng thêm** lệnh khi ID đã tồn tại, miễn là `pyramiding` cho phép. Nguồn:
docs TradingView *Concepts / Strategies → Pyramiding* — ví dụ của chính tài liệu gọi
`strategy.entry("Entry")` một lần mỗi 25 bar và ghi rõ: *"with pyramiding = 4 … all the
script's entry orders now result in new trades"* (cùng **một** ID).

Nên khi `pyramiding` được nâng từ **0 → 5** (để chạy được pyramid), đường N = 1 với
ID `"Long"`/`"Short"` sẽ **cộng dồn** — trong khi bản cũ (`pyramiding = 0`) **bỏ qua** lệnh
thứ hai cùng chiều. Đây là khác biệt hành vi **ngay ở input mặc định**, tức là backtest A/B
sẽ lệch mà không ai ngờ. Hai dòng guard khôi phục đúng ngữ nghĩa "một lệnh mỗi chiều"
nhưng vẫn cho phép đảo chiều (khác với dùng `strategy.close`/chặn cứng).

**Hệ quả còn lại (đã biết):** guard tính tại *thời điểm lệnh được tạo*, còn fill là một giai
đoạn sau — TradingView cũng mô tả khe hở này. Số lệnh có thể lệch trong trường hợp hiếm;
trước khi tin một so sánh A/B nào, phải **đo số trade trên cùng khoảng thời gian** trước đã.

**Cạm bẫy `pyramiding` không phải hằng số:** `pyramiding` yêu cầu `const int`, nên không thể
gán `pyramiding = tm_i_btPyr`. Nó bị khoá ở 5 trong `strategy()`; nếu người dùng hạ
"Pyramiding" trong Settings/Properties của chart xuống thấp hơn số lệnh con thì các lệnh
thừa bị bỏ — im lặng.

---

## 6. A-P1-1 — measured move, không nhìn tương lai

`tm_highRun1` / `tm_lowRun1` chỉ dùng `high`/`low` của **cửa sổ `tm_i_run + 1` bar hiện tại
và quá khứ**, còn `tm_lastPHigh` / `tm_lastPLow` đã được chốt tại bar pivot (`tm_i_pivLen`
bar sau khi pivot hình thành). Không có `request.security` với `lookahead_on`, không tham
chiếu bar tương lai → **không repaint**.

Điều kiện dùng MM (một trong hai, đối xứng):

```pine
tpM1 = tm_highFresh and not na(tm_mmUp) and tm_mmUp > rk1 ? e1 + tm_mmUp : tpR1
tpM2 = tm_lowFresh  and not na(tm_mmDn) and tm_mmDn > rk2 ? e2 - tm_mmDn : tpR2
```

- `tm_highFresh` (LONG): phải còn một **đỉnh kháng cự** hiệu lực làm bờ trên của pha giảm.
  Nếu không có, "chiều cao pha đẩy" là vô nghĩa (Setup C: cả hai pivot cùng hướng) → fallback.
- `> rk1` (dài hơn 1R): MM mà ngắn hơn 1R thì không phải mục tiêu, rơi về `rrFb × R`.

---

## 7. A-P1-3 — CLX-E

```pine
var bool tm_clxE = false
if tm_sigST
    tm_clxE := false
if tm_isPurple and not tm_lvlDone and not na(tm_lvlE) and not na(tm_lvlRisk) and tm_lvlRisk > 0.0
    if tm_lvlDir == 1 and high >= tm_lvlE + tm_i_clxR * tm_lvlRisk
        tm_clxE := true
    else if tm_lvlDir == -1 and low <= tm_lvlE - tm_i_clxR * tm_lvlRisk
        tm_clxE := true
```

- Reset **mỗi setup mới** để một lần climax không "dính" mãi.
- Điều kiện là "giá **đã đi xa ≥ 1.5R** *và* volume cột tím xuất hiện" — không phải
  "volume tím nói chung". Volume tím tại retest là SV/BC (chuyện khác), tại target mới là CLX-E.
- **Cảnh báo, không tự đóng lệnh** — method doc ghi CLX-E ở mức "v1.1, chưa bật"; ở đây bật
  phần *nhìn thấy được* (nhãn + dashboard + alert), phần tự động chốt cố ý để người dùng quyết.
- `tm_clxMax` chia cho `tm_lvlRisk` không được bảo vệ `> 0`; an toàn **chỉ dựa vào** việc
  `tm_lvlRisk > 0` đã được kiểm trước khi gán setup (`if rk1 > 0` / `if rk2 > 0`). Sửa hai
  guard đó thì phải bọc cả `tm_clxMax`.

---

## 8. Định vị so với bản cũ (kiểm tĩnh, chưa chạy chart)

| Đặc điểm | `TM VSA Wyckoff` | `LongKaco VSA` |
|---|---|---|
| Level trước, volume sau | ✅ auto pivot ± `lvTol`×ATR | ✅ như cũ |
| Cột tím ratio ≥ 2.2 = gate | ✅ | ✅ như cũ |
| SV / BC tại level + momentum | ✅ | ✅ như cũ |
| ST = retest volume thấp < 1.2 | ✅ | ✅ **+ cổng sweep trước** (A-P0-1) |
| Entry/SL/TP tự động, tự đóng setup | ✅ | ✅ như cũ (+ nhãn `· pyr xN`) |
| TP theo R / Pivot | ✅ | ✅ + **MM** (A-P1-1) |
| Phí ăn hết lời (`fee_R`) | ✅ | ✅ như cũ |
| Session XAU | ✅ | ✅ như cũ |
| CLX-E | ❌ | ✅ cảnh báo (A-P1-3) |
| Pyramid 3–5 lệnh | ❌ | ✅ bản strategy (A-P1-2) |
| Tiền tố alert | `VSA …` | `LK VSA …` |

Bảng đối chiếu đầy đủ với video: [../vsa-wyckoff/vsa-sweep-pine-build.md](../vsa-wyckoff/vsa-sweep-pine-build.md) §2.

---

## 9. Việc nên làm tiếp

1. **Đo trước, sửa sau (D12).** Chạy bảng ở [README.md](./README.md) §5 rồi mới động tham số.
2. Nếu `NO SWEEP` bắn quá nhiều (mất > 60% setup) → thử `tm_i_sweepWin` = 20–30, hoặc nới
   định nghĩa sweep (ví dụ cho phép râu vượt `tm_lvl` thay vì `tm_svPx`) — **đo lại từ đầu**.
3. CLX-E tự động (dời SL về entry khi có tín hiệu) chỉ nên thêm **sau** khi có số liệu cho
   thấy climax tại target thực sự báo trước đảo chiều.
4. Nếu pyramid được dùng thật: kiểm số trade khớp kỳ vọng trên một khoảng thời gian cố định
   trước khi so bất kỳ chỉ số nào.