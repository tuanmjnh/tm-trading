# LongKaco VSA — bộ chỉ báo riêng theo phương pháp LongKaco VSA

> **Nguồn:** 7/11 video `D:\Trading\longkaco.1988` → spec tại
> [../vsa-wyckoff/vsa-wyckoff-method.md](../vsa-wyckoff/vsa-wyckoff-method.md),
> số liệu đo tại [../vsa-wyckoff/vsa-optimization.md](../vsa-wyckoff/vsa-optimization.md),
> lộ trình afterfix + đối chiếu Pine tại
> [../vsa-wyckoff/vsa-sweep-pine-build.md](../vsa-wyckoff/vsa-sweep-pine-build.md) (§3–§4).
>
> **Mục đích:** Bộ chỉ báo chuyên biệt **`LongKaco VSA`** (nguồn `pine/parts-longkaco-vsa/`, Version: 1.0.0)
> hiện thực hóa trọn vẹn phương pháp VSA thực chiến kết hợp 4 afterfix then chốt: Quét thanh khoản trước Retest (A-P0-1),
> Chốt lời Measured Move (A-P1-1), Cảnh báo Climax Exit (A-P1-2), và Nhồi lệnh Pyramiding (A-P1-3).

---

## 1. Cấu trúc build (Production Ready)

| Thành phần | Đường dẫn | Ghi chú |
|---|---|---|
| Nguồn parts | `pine/parts-longkaco-vsa/` | 8 files (00_header đến 70_alerts + 50_strategy) |
| Hàm dùng chung | `pine/shared/common.pine`, `pine/shared/sess-inputs.pine` | hàm chuẩn hệ thống TM |
| Output indicator | `pine/dist/LongKaco VSA.pine` | Version: 1.0.0, shorttitle: "LK VSA" |
| Output backtest | `pine/dist/LongKaco VSA Backtest.pine` | Version: 1.0.0, shorttitle: "LK VSA BT" |
| Docs bộ này | `docs/indicator/longkaco-vsa/` | thư mục tài liệu độc lập |

Target mới trong `tools/build.mjs`:

```js
'lk-vsa':          { file: 'LongKaco VSA.pine',          dir: 'parts-longkaco-vsa', shared: ['common.pine', 'sess-inputs.pine'], decl: indicator(...) },
'lk-vsa-strategy': { file: 'LongKaco VSA Backtest.pine', dir: 'parts-longkaco-vsa', shared: ['common.pine', 'sess-inputs.pine'], decl: strategy(..., pyramiding = 5, ...) },
```

Script mới trong `package.json`:

```bash
npm run pine:lk-vsa              # chỉ build bản indicator
npm run pine:lk-vsa:backtest     # chỉ build bản strategy
npm run pine:copy:lk-vsa         # build + copy LongKaco VSA.pine vào clipboard
npm run pine:copy:lk-vsa:backtest
```

**Marker cắt file** (đúng theo TÊN TARGET, không phải tên thư mục):

| Target | `50_strategy` | `60_viz` | Kết quả |
|---|---|---|---|
| `lk-vsa` | **cắt** (`@part skip:lk-vsa`) | giữ | indicator 678 dòng |
| `lk-vsa-strategy` | giữ | **cắt** (`@part skip:lk-vsa-strategy`) | strategy 600 dòng |

Hai bản dùng chung `10_inputs` / `20_volume` / `30_levels` / `40_events` nên **logic
sự kiện không thể lệch** — smoke test so trực tiếp các dòng `tm_sig* =`, `tm_stRaw* =`,
`tm_clxE =` và `tm_lvl* :=` của hai file dist.

---

## 2. Bốn khác biệt so với `TM VSA Wyckoff`

### 2.1 A-P0-1 — Sweep trước ST (P0, mặc định BẬT)

Luật method (§4.1, §5 Setup A bước 1 / Setup B bước 2): *trước khi retest phải có một
bar quét thanh khoản — râu vượt level rồi đóng cửa quay lại trong vùng* (fakeout/spring).
Bản cũ không kiểm điều này.

```pine
tm_sweepUpBar = tm_hasSV and low  < tm_svPx and close > tm_svPx   // quét đáy SV
tm_sweepDnBar = tm_hasBC and high > tm_bcPx and close < tm_bcPx   // quét đỉnh BC
tm_sigSTl = tm_stRawL and (not tm_sweepGateOn or tm_sweepL)
```

| Input | Default | Ý nghĩa |
|---|---|---|
| `tm_i_sweepReq` | **true** | BẬT = ST phải có bar sweep trước. **TẮT = hành vi y hệt bản cũ** |
| `tm_i_sweepWin` | 10 | cửa sổ nhìn lại tính bằng bar (`0` = không giới hạn) |

Chi tiết cài đặt:

- Bar sweep phải **sau** bar SV/BC (`tm_sweepUpBl >= tm_svBar`) — quét trước khi có
  climax không tính là retest.
- Cổng **chỉ áp cho chiến lược `VSA dao chieu`**. Ở chế độ `VSA loc + Wyckoff`, Spring/UTAD
  *đã là* "phá vỡ rồi đóng cửa trở lại" → áp thêm cổng nữa là thừa.
- Bản cũ dùng 1 dòng `tm_sigSTl`; bản này tách **`tm_stRawL/S`** (tín hiệu thô) khỏi
  **`tm_sigSTl/s`** (sau cổng) để còn cảnh báo được trường hợp *suýt đạt nhưng thiếu sweep*
  (`tm_noSweep` → alert `LK VSA NO SWEEP`).
- **A/B trung thực:** `tm_stRawL` là bản sao từng ký tự của `tm_sigSTl` bên bản cũ; smoke
  test so hai chuỗi này nên tuyên bố "tắt input = hành vi cũ" là assertion chứ không
  phải lời hứa.

### 2.2 A-P1-1 — TP measured move (P1, chế độ thứ 3)

`Kieu dat TP` có thêm lựa chọn **`Measured move (A-P1-1)`** cạnh `Theo R` / `Pivot doi dien`.
Mục tiêu = **chiều dài pha đẩy trước đó** chiếu tiếp từ mốc retest (§5 bước 6, §6):

```pine
tm_highRun1 = ta.highest(high, tm_i_run + 1)      // dữ liệu CHỈ từ quá khứ
tm_lowRun1  = ta.lowest(low,  tm_i_run + 1)
tm_mmUp     = tm_lastPHigh - tm_lowRun1           // chiều cao pha giảm (cho LONG)
tm_mmDn     = tm_highRun1  - tm_lastPLow          // chiều cao pha tăng (cho SHORT)
```

- LONG cần `tm_highFresh` và `tm_mmUp > risk`; SHORT cần `tm_lowFresh` và `tm_mmDn > risk`.
- Không thoả (ví dụ Setup C — cả hai pivot cùng hướng) → **dự phòng `rrFb × R`**, đúng
  tinh thần §8.4 "TP fallback".
- Luật "bỏ qua setup khi risk ≤ 0" giữ nguyên (`if rk1 > 0` / `if rk2 > 0`).

### 2.3 A-P1-3 — CLX-E (P1, climax tại target)

Volume cột TÍM xuất hiện khi giá **đã đi được ≥ `tm_i_clxR` × R** theo hướng có lợi
→ phản lực ngược chiều tại vùng lợi nhuận → **chốt / dời SL về entry** (§4.2 dòng CLX-E,
§7 bước 8).

```pine
if tm_sigST
    tm_clxE := false                                  // reset mỗi setup mới
if tm_isPurple and not tm_lvlDone and ... tm_lvlRisk > 0.0
    if tm_lvlDir == 1 and high >= tm_lvlE + tm_i_clxR * tm_lvlRisk
        tm_clxE := true
```

| Input | Default | Ý nghĩa |
|---|---|---|
| `tm_i_clxOn` | true | bật cảnh báo CLX-E |
| `tm_i_clxR` | 1.5 | khoảng cách tối thiểu tới entry, tính theo R |

Hiển thị: nhãn `CLX-E` (chữ ✕, màu fuchsia, `force_overlay`) trên nến, cộng dòng
dashboard `CLX-E` hiện `mức xa nhất đã đi / ngưỡng` (ví dụ `1.8R / 1.5R`). Cảnh báo riêng
`LK VSA CLX-E`. Đây là *cảnh báo*, không tự đóng lệnh — đúng như method doc ghi (CLX-E mới
ở mức "v1.1").

### 2.4 A-P1-2 — Pyramid (P1, chỉ ở bản `lk-vsa-strategy`)

| Input | Default | Ý nghĩa |
|---|---|---|
| `tm_i_btPyr` | **1** | số lệnh con cùng zone (1..5). **1 = không đổi hành vi** |
| `tm_i_btStep` | 0.25 | bước lệch mỗi lệnh con, × ATR |

- Khi `tm_i_btPyr > 1`: khối lượng chia đều (`qty` mỗi con = tổng ÷ N), N lệnh **limit**
  lệch nhau quanh entry: lệnh thứ i lệch `(i − (N+1)/2) × step × ATR`, cùng một bộ SL/TP,
  mỗi con một ID riêng (`L1..Ln` / `S1..Sn`) và một `strategy.exit` tương ứng.
- Vì sao N > 1 phải dùng **limit**: market sẽ khớp ngay tại `close`, các lệnh con chồng
  khít nhau và hệ số lệch thành vô nghĩa.
- ⚠️ **Bẫy P0 đã xử lý** — `pyramiding = 5` khiến **cùng một ID vẫn cộng dồn** (docs
  TradingView *Concepts/Strategies → Pyramiding*: ví dụ của chính tài liệu gọi
  `strategy.entry("Entry")` 4 lần và với `pyramiding = 4` thì **cả 4 lần đều thành lệnh**).
  Bản cũ để `pyramiding = 0` nên **bỏ qua** lệnh thứ 2 cùng chiều. Do đó đường N = 1 phải
  tự chặn lại:

  ```pine
  if tm_btLong  and not tm_btMulti and strategy.position_size >= 0
  if tm_btShort and not tm_btMulti and strategy.position_size <= 0
  ```

  Không có hai dòng này thì backtest A/B lệch **ngay từ input mặc định** — đây là lỗi
  suýt nữa lọt (`pyramiding = 5` được thêm chỉ để chạy được pyramid).

---

## 3. Dashboard (2 cột × 15 dòng)

Giữ nguyên 13 dòng của bản cũ, thêm 2 dòng:

| Dòng | Ý nghĩa |
|---|---|
| **Sweep truoc ST** | `Tat (kieu cu)` (input tắt) / `Dat (n bar truoc)` (xanh) / `Thieu sweep - dang cho` (cam) |
| **CLX-E** | `Tat` / `CO - xem xet CHOT` (fuchsia) / `mức xa nhất / ngưỡng` (ví dụ `1.8R / 1.5R`) |

Dòng **Vao lenh / TP** nay hiện `R` / `Pivot` / `MM`; dòng **Chien luoc** hiện thêm `+ sweep`
khi cổng sweep đang bật; nhãn **Entry** hiện thêm `· pyr xN` khi chạy pyramid.

---

## 4. Alerts

| Alert | Khi nào |
|---|---|
| `LK VSA SV` / `LK VSA BC` | volume tím tại H/T + momentum (như bản cũ) |
| `LK VSA ST LONG` / `LK VSA ST SHORT` | retest volume thấp **đã qua cổng sweep** |
| `LK VSA NS` / `LK VSA ND` | cột âm tại H/T |
| **`LK VSA NO SWEEP`** | retest đủ điều kiện nhưng **thiếu** bar sweep → bị loại (mới) |
| **`LK VSA CLX-E`** | volume tím tại vùng TP ngược chiều vị thế (mới) |

---

## 5. Giao thức kiểm tra kết quả THẬT (TradingView)

1. Dán **`LongKaco VSA`** và giữ **`TM VSA Wyckoff`** trên **cùng chart**
   (XAUUSD hoặc BTCUSDT 15m), cùng mọi input mặc định.
2. So từng tín hiệu `ST` trong 200 bar gần nhất:
   - `tm_i_sweepReq = OFF` → **giống hệt** bản cũ (số lượng, vị trí, timestamp).
   - `tm_i_sweepReq = ON` → **ít hơn** (loại setup thiếu sweep); đếm số alert `NO SWEEP`
     để biết mất bao nhiêu % setup.
3. Chạy song song 2 bản strategy trên Strategy Tester (commission 0.05%/side), điền bảng:

   | Cấu hình | Net Profit | % Profitable | Max DD | Số lệnh |
   |---|---|---|---|---|
   | `TM VSA Backtest` (bản cũ) | | | | |
   | `LongKaco VSA Backtest` — sweep OFF, TP theo R | | | | |
   | `LongKaco VSA Backtest` — sweep ON, TP theo R | | | | |
   | `LongKaco VSA Backtest` — sweep ON, TP MM | | | | |
   | `LongKaco VSA Backtest` — sweep ON, pyr 4 | | | | |

4. Lặp lại trên 1h và 4h. **Không** chỉnh tham số nào trước khi có bảng này (D12).

Ghi kết quả vào §6 bên dưới.

---

## 6. Kết quả đo (chưa có — chờ chart thật)

| Ngày | Chart / TF | Cấu hình | Net Profit | % Profitable | Max DD | Ghi chú |
|---|---|---|---|---|---|---|
| — | — | — | — | — | — | *chưa chạy* |

---

## 5.2 Webhook Alert Contract

Chỉ báo phát cảnh báo JSON kèm thông tin version:
```json
{
  "version": "1.0.0",
  "action": "LK VSA LONG",
  "sym": "BTCUSDT",
  "tf": "15",
  "p": 67500.0,
  "sl": 66800.0,
  "tp": 68900.0,
  "time": "2026-10-19T14:30:00Z"
}
```

---

## 7. Cổng nghiệm thu

```bash
npm run pine:build    # 7 active targets, 0 warning
npm run pine:test     # Smoke test active targets (253 pass)
npm run docs:check    # Consistency gate (1097 pass)
npm run verify        # Build + Docs check + 17 test suites (2381 pass)
```

Smoke thêm **37 assertion** cho bộ này (296 → 346), gồm các bất biến then chốt:

- `tm_stRawL/S` trùng bản cũ **từng ký tự** (tắt input = hành vi cũ).
- Bản cũ `TM VSA Wyckoff` **không** chứa afterfix nào (`tm_i_sweepReq` / `tm_clxE` / `tm_tpMM`).
- `pyramiding = 5` **phải** đi kèm guard `strategy.position_size` ở đường N = 1.
- Logic sự kiện của 2 bản LongKaco (indicator ↔ strategy) giống hệt nhau.

---

## 8. Hạn chế

- **Chưa có số liệu thật.** Bộ này chỉ *đo được* — method chưa chứng minh lợi thế
  (xem [../vsa-wyckoff/vsa-optimization.md](../vsa-wyckoff/vsa-optimization.md) §5f: 7/9
  cấu hình không vượt baseline ngẫu nhiên). **Build để đo, không phải để tin.**
- `tm_sweepBars` là **tuổi của lần sweep gần nhất**, không phải số bar thực sự đã trôi qua kể
  từ lần sweep *dùng để mở setup*; đủ dùng cho dashboard, đừng dùng làm số liệu nghiên cứu.
- CLX-E là **cảnh báo**, không tự đóng lệnh, và không có alert `exit` riêng.
- Pyramid chỉ có ở bản strategy (indicator chỉ vẽ 3 đường của setup, không vẽ N đường con).
- Level vẫn **auto pivot** (`tm_i_pivLen` = 20); video vẽ tay — muốn đúng video phải tự kẻ.
- Cảnh báo trên TradingView không chạy backtest; số liệu phải lấy từ Strategy Tester.