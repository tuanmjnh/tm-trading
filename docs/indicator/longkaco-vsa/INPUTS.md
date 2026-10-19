# LongKaco VSA — inputs & outputs

Tên input là **tên thật trong code** (`pine/parts-longkaco-vsa/`). Mọi giá trị dưới đây là
**giá trị mặc định** khi dán vào TradingView.

---

## 1. Bảng input — phần giữ nguyên từ `TM VSA Wyckoff`

| Input | Default | Nhóm | Ghi chú |
|---|---|---|---|
| `tm_confirmOnly` | true | TM · Chung | chỉ chốt tín hiệu khi nến đóng (chống repaint) |
| `tm_i_len` | 20 | TM · Volume | cửa sổ MA volume (Wilder `ta.rma`) |
| `tm_i_rP` | **2.2** | TM · Volume | **NGƯỠNG CHÍNH** — cột TÍM; dưới mức này không có SV/BC |
| `tm_i_rVH` / `tm_i_rH` / `tm_i_rN` / `tm_i_rL` | 1.8 / 1.2 / 0.8 / 0.4 | TM · Volume | màu bối cảnh, không gate tín hiệu |
| `tm_i_purWin` | 20 | TM · Volume | cửa sổ đếm cột tím (dashboard) |
| `tm_i_volMin` | 0.0 (tắt) | TM · Volume | volume tuyệt đối tối thiểu — alt coin thanh khoản thấp |
| `tm_i_evtOn` | true | TM · Su kien | bật SV/BC/ST |
| `tm_i_quietOn` | true | TM · Su kien | bật NS/ND |
| `tm_i_run` | 5 | TM · Su kien | số nến tính momentum (`close` vs `close[run]`) |
| `tm_i_lvTol` | 0.5 | TM · Su kien | bề rộng vùng H/T (× ATR) |
| `tm_i_lvFresh` | 60 | TM · Su kien | H/T còn hiệu lực (nến) |
| `tm_i_testR` | 1.2 | TM · Su kien | ngưỡng nhận ST (ratio < ngưỡng) |
| `tm_i_retestT` | 1.0 | TM · Su kien | bán kính test lại (× ATR) |
| `tm_i_atrLen` | 14 | TM · Su kien | ATR |
| `tm_i_pivLen` | 20 | TM · Su kien | độ dài pivot H/T |
| `tm_i_slBuf` | 0.5 | TM · Hien thi | buffer SL ngoài cực trị (× ATR) |
| `tm_i_rrFb` | 2.0 | TM · Hien thi | TP fallback (R) — dùng cả khi MM không thoả |
| `tm_i_entryMode` | Market (xac nhan ST) | TM · Vao lenh | vào tại `close` bar ST; tùy chọn Limit tại cực trị |
| `tm_i_feePct` / `tm_i_feeMaxR` | 0.05% / 0.15 | TM · Phi & Rui ro | phí taker 1 chiều & ngưỡng cảnh báo `fee_R` |
| `tm_i_signalMode` | VSA dao chieu | TM · Chien luoc | tùy chọn `VSA loc + Wyckoff` |
| `tm_i_wyckoffEvent` | LPS | TM · Chien luoc | Spring / SOS / LPS |
| `tm_i_sosSpread` / `tm_i_sosVol` / `tm_i_lpsTol` | 1.0 / 1.2 / 0.5 | TM · Chien luoc | ngưỡng Wyckoff |
| `tm_i_showViz` | true | TM · Hien thi | **master** tắt/bật toàn bộ hiển thị |
| `tm_i_showSig` / `tm_i_showVol` / `tm_i_dash` / `tm_i_pivOn` / `tm_i_lvlOn` | true | TM · Hien thi | từng thành phần |
| `tm_i_dashSize` | Small | TM · Hien thi | Tiny / Small / Normal |
| `tm_i_sessOn` / `tm_i_sess` / `tm_i_tz` | false / 0800-1600 / Asia/Ho_Chi_Minh | TM · Volume | **bắt buộc bật với XAU/XAG/forex** |
| `tm_i_sessTz` | America/New_York | TM · Session | múi giờ cho dòng Session của dashboard |

## 2. Input MỚI của bộ LongKaco

| Input | Default | Nhóm | Ý nghĩa |
|---|---|---|---|
| `tm_i_sweepReq` | **true** | TM · Sweep (A-P0-1) | yêu cầu có bar sweep trước ST. **TẮT = hành vi y hệt `TM VSA Wyckoff`** |
| `tm_i_sweepWin` | 10 | TM · Sweep (A-P0-1) | cửa sổ nhìn lại (bar); `0` = không giới hạn |
| `tm_i_clxOn` | true | TM · CLX-E (A-P1-3) | bật cảnh báo climax tại target |
| `tm_i_clxR` | 1.5 | TM · CLX-E (A-P1-3) | giá phải đã đi ≥ ngưỡng này × R |
| `tm_i_btOn` | true | TM · Backtest | *(chỉ bản strategy)* bật đặt lệnh theo ST |
| `tm_i_btPct` | 100.0 | TM · Backtest | *(chỉ bản strategy)* khối lượng % equity |
| `tm_i_btPyr` | **1** | TM · Backtest | *(chỉ bản strategy)* số lệnh con cùng zone (1..5). **1 = không đổi hành vi** |
| `tm_i_btStep` | 0.25 | TM · Backtest | *(chỉ bản strategy)* bước lệch mỗi lệnh con (× ATR) |

`tm_i_tpMode` (TM · Vao lenh) có **3** lựa chọn: `Theo R (co dinh)` *(mặc định)* /
`Pivot doi dien` / `Measured move (A-P1-1)`.

---

## 3. Output

### 3.1 Trên giá (`force_overlay = true`)

| Nhãn | Hình | Vị trí | Ý nghĩa |
|---|---|---|---|
| `SV` | ▲ tím | dưới nến | Stopping Volume tại support → chuẩn bị LONG |
| `BC` | ▼ đỏ | trên nến | Buying Climax tại resistance → chuẩn bị SHORT |
| `ST` | ↑ teal | dưới nến | Secondary Test LONG — **điểm vào lệnh** |
| `ST` | ↓ cam | trên nến | Secondary Test SHORT |
| `NS` / `ND` | ◆ xanh dương / bạc | dưới / trên nến | No Supply / No Demand |
| **`CLX-E`** | ✕ fuchsia | trên nến (LONG) / dưới nến (SHORT) | **mới** — climax tại vùng TP → xem xét chốt |

Cộng thêm: đường H/T dashed vàng (anchor tại bar pivot), 3 đường **Entry** (trắng, liền) /
**SL** (đỏ, dashed) / **TP** (xanh lá, dashed) của setup ST gần nhất, mỗi loại **1 nhãn giá**
tại bar cuối; setup chạm TP/SL → xóa 3 đường, để lại nhãn `TP`/`SL` tại bar chạm.
Nhãn **Entry** hiện thêm `· pyr xN` khi `tm_i_btPyr > 1`.

### 3.2 Dashboard (2 cột × 15 dòng, góc phải trên)

13 dòng như bản cũ (`Che do`, `TF`, `Volume ratio`, `Bucket`, `Cot TIM/20`, `Su kien gan nhat`,
`EoM`, `Session`, `TIM gan nhat`, `Phi/R`, `slBuf toi thieu`, `Vao lenh / TP`, `Chien luoc`)
cộng 2 dòng mới:

| Dòng | Giá trị có thể gặp |
|---|---|
| **Sweep truoc ST** | `Tat (kieu cu)` · `Dat (n bar truoc)` (xanh) · `Thieu sweep - dang cho` (cam) |
| **CLX-E** | `Tat` · `CO - xem xet CHOT` (fuchsia) · `1.8R / 1.5R` (mức xa nhất đã đi / ngưỡng) |

Dòng `Vao lenh / TP` nay hiện `R` / `Pivot` / **`MM`**; `Chien luoc` hiện thêm `+ sweep`.

### 3.3 Alerts (8 loại)

`LK VSA SV` · `LK VSA BC` · `LK VSA ST LONG` · `LK VSA ST SHORT` · `LK VSA NS` · `LK VSA ND`
· **`LK VSA NO SWEEP`** · **`LK VSA CLX-E`**

> Tiền tố `LK VSA` (không phải `VSA`) là cố ý, để phân biệt với alert của `TM VSA Wyckoff`
> khi hai bản gắn cùng một chart. Rule tự động bắt chuỗi `"VSA SV"` phải đổi thành `"LK VSA SV"`.

---

## 4. Cấu hình gợi ý (bắt đầu từ đây)

| Mục tiêu | Cách đặt |
|---|---|
| **Đối chiếu với bản cũ** | `tm_i_sweepReq = OFF`, `tm_i_tpMode = Theo R`, `tm_i_btPyr = 1` → phải khớp `TM VSA Wyckoff` |
| Đo ảnh hưởng của luật sweep | giữ nguyên mọi thứ, chỉ lật `tm_i_sweepReq` ON/OFF; đếm alert `NO SWEEP` |
| Thử TP theo cấu trúc zone | `tm_i_tpMode = Measured move (A-P1-1)` |
| Thử pyramid 4 lệnh | bản strategy: `tm_i_btPyr = 4`, `tm_i_btStep = 0.25`, giữ tpMode như trên |
| XAU/XAG/forex | **bật** `tm_i_sessOn`, đặt `tm_i_sess` + `tm_i_tz` theo phiên của bạn |
| Crypto 24/7 | để `tm_i_sessOn = OFF` |

---

## 5. Nguồn chân lý

- Nguồn code: **`pine/parts-longkaco-vsa/`** — sửa ở đây, **không** sửa trong `pine/dist/`.
- Sinh file dist: `npm run pine:build` (cả 13 target) hoặc `npm run pine:lk-vsa`.
- Sao chép vào clipboard để dán: `npm run pine:copy:lk-vsa` / `npm run pine:copy:lk-vsa:backtest`.
- Lỗi compile TradingView (nó chỉ báo `line N` trên file dist):
  `node tools/errors.mjs loi.txt --target lk-vsa` → đổi về đúng dòng trong parts + đoạn mã.
- Kiểm thử: `npm run pine:test` (346 assertion) · `npm run docs:check` (1093) · `npm run verify`.