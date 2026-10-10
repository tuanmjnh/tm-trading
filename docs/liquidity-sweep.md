# TM Liquidity Sweep — Quét thanh khoản + râu từ chối + volume VSA

Chỉ báo **`TM Liquidity Sweep`** (Pine v6, `overlay = false`) kết hợp ý tưởng level của
**`Liquidity Swings [LuxAlgo]`** (`docs/Liquidity Swings [LuxAlgo].pine`) với phân loại
volume của **`VSA Volume.pine`** (`docs/VSA Volume.pine`).

Giống **`TM VSA Wyckoff`**: indicator có **pane riêng** hiển thị **histogram volume 6 màu**
(bucket VSA) + đường MA; mọi hình vẽ trên **pane giá** (level, vùng râu, nhãn SWEEP,
Entry/SL/TP, dashboard) đều dùng `force_overlay = true`.

> **Phương pháp:** giá **quét qua lấy thanh khoản** rồi **rút râu** (wick rejection), xác nhận
> bằng **volume VSA** + **xu hướng** → tín hiệu **đảo chiều**. Tham chiếu hình: `private/Capture.PNG`.

Nguồn: `pine/parts-sweep/` (00–70) → `pine/dist/TM Liquidity Sweep.pine` (`npm run pine:sweep`).
Logic còn được **port sang engine** (`engine/methods/sweep.mjs`) để **đo bằng backtest/league**.

---

## 1. Triết lý cốt lõi

1. **Level trước, tín hiệu sau** — chỉ xét khi giá chạm level thanh khoản tạo từ pivot swing
   (vùng *Wick Extremity* = phần râu), đúng kiểu LuxAlgo.
2. **Quét = râu vượt, thân quay lại** — thanh khoản nằm trên đỉnh / dưới đáy cũ. Giá wick
   xuyên qua nhưng **close quay trở lại** = phá vỡ thất bại → đảo chiều (wick trên → SHORT,
   wick dưới → LONG).
3. **Xác nhận VSA + xu hướng** — bar quét cần volume đủ lớn (`ratio ≥ volSweepMin`) và hướng
   phải **hợp xu hướng** (SMA nhanh/chậm): chỉ SHORT khi trend xuống, LONG khi trend lên.
4. **Vào lệnh có kỷ luật** — không fade ngay; chờ **retest** hoặc **confirm** (xem §2.4). Đây là
   đòn bẩy lớn nhất (đã đo — §5).

Cặp đối xứng:

| Quét | Level | Râu | Close | Tín hiệu |
|---|---|---|---|---|
| Buy-side (trên) | swing high | râu **trên** vượt `px` | `close < px` | **SWEEP SHORT** |
| Sell-side (dưới) | swing low | râu **dưới** vượt `px` | `close > px` | **SWEEP LONG** |

---

## 2. Định lượng

### 2.1 Level thanh khoản (`30_liquidity.pine`)

- Pivot: `ta.pivothigh/low(high|low, phLen, phLen)`, xác nhận trễ `phLen` nến như LuxAlgo.
- Vùng: **Wick Extremity** (đỉnh = giá pivot, đáy = `max(open, close)` / ngược cho đáy) hoặc
  **Full Range** (lấy cả thân).
- Mỗi level lưu `px`, `zTop/zBot`, `baridx`, `ratio`, **`touch`** (số lần giá chạm trong bán
  kính `tolAtr × ATR`), `swept` + object vẽ. Giữ tối đa `maxLvl` level/bên.
- **Huỷ level**: `close` vượt hẳn qua level (breakout) → đánh dấu `swept` (nét chấm).

### 2.2 Quét

- Buy-side: `high > px and close < px`, level còn hiệu lực, chưa `swept`; chọn level gần `high` nhất.
- Sell-side: `low < px and close > px`; chọn level gần `low` nhất.

### 2.3 Cổng xác nhận

| Điều kiện | Công thức | Input |
|---|---|---|
| Volume VSA (lúc quét) | `ratio ≥ volSweepMin` | `tm_i_volMinR` (1.2; 0 = tắt) |
| Râu lui theo biên độ | `upWick ≥ wickRng × (high-low)` | `tm_i_wickRng` (0.5) |
| Râu lui theo ATR | `upWick ≥ wickAtr × ATR` | `tm_i_wickAtr` (0 = tắt) |
| Xu hướng | SHORT cần `SMA fast < SMA slow`; LONG ngược lại | `tm_i_trendFast/Slow` (50/200; 0 = tắt) |
| Chất lượng level | `touch ≥ minTouches` | `tm_i_minTouches` (0 = tắt) |
| Nến đóng / phiên | `barstate.isconfirmed` / `f_sessionOk` | `tm_confirmOnly` / `tm_i_sessOn` |

### 2.4 Vào lệnh — `entryMode` (đòn bẩy chính)

| Mode | Hành vi | Kết quả đo |
|---|---|---|
| `Market` | vào ngay bar quét | **âm** (fade sớm) |
| `Retest` | chờ giá **test lại level** với volume `< volRetestMax` trong `retestBars` | **robust nhất** |
| `Confirm` | chờ bar **close vượt cực trị bar quét** (BOS nhỏ) trong `confirmBars` | tốt ở OOS nhưng lung lay |

Pending tự **huỷ** khi chạm SL / breakout / hết cửa sổ. Setup mới bị bỏ nếu còn pending.

### 2.5 Risk (`50_risk.pine`)

- **Entry** = close bar tín hiệu (market).
- **SL** = ngoài cực trị râu quét ± `slBuf × ATR`, **bắt buộc** trong `[slMinAtr, slMaxAtr] × ATR`
  (tránh phí ăn edge khi stop quá hẹp, tránh stop quá xa).
- **TP** = level thanh khoản đối diện gần nhất cho **`RR ≥ minRR`**; không có → fallback `rrFb × R`
  (chỉ dùng khi `rrFb ≥ minRR`, nếu không thì **bỏ lệnh**).
- Setup tự đóng khi chạm TP/SL (ưu tiên SL).

---

## 3. Inputs (mặc định = cấu hình robust)

| Nhóm | Input | Default | Ghi chú |
|---|---|---|---|
| Thanh khoản | `tm_i_phLen` / `tm_i_zoneMode` | 14 / Wick Extremity | pivot / `Wick Extremity`\|`Full Range` |
| Thanh khoản | `tm_i_lvlFresh` / `tm_i_maxLvl` | 300 / 8 | hiệu lực / số level mỗi bên |
| Thanh khoản | `tm_i_tolAtr` / `tm_i_minTouches` | 0.5 / 0 | bán kính chạm / số lần chạm tối thiểu |
| Sweep | `tm_i_wickRng` / `tm_i_wickAtr` | 0.5 / 0 | râu / biên độ; râu / ATR |
| Sweep | `tm_i_trendFast` / `tm_i_trendSlow` | 50 / 200 | lọc xu hướng (0 = tắt) |
| Volume | `tm_i_volMinR` / `tm_i_volRetestMax` | 1.2 / 1.2 | vol lúc quét / lúc retest |
| Volume | `tm_i_volLen` / `tm_i_showMA` | 20 / true | RMA Wilder / hiện MA |
| Volume | `tm_i_rP…rL` | 2.2/1.8/1.2/0.8/0.4 | ngưỡng bucket (TIM = 2.2) |
| Vào lệnh | `tm_i_entryMode` | Retest | `Market`\|`Retest`\|`Confirm` |
| Vào lệnh | `tm_i_retestBars`/`retestMax`/`confirmBars` | 10/1.2/10 | cửa sổ + ngưỡng |
| Vào lệnh | `tm_i_minRR` | 2.0 | RR tối thiểu |
| Risk | `tm_i_slBuf`/`slMinAtr`/`slMaxAtr` | 0.5/0.5/3.0 | buffer / sàn / trần SL (×ATR) |
| Risk | `tm_i_rrFb` | 2.0 | TP fallback (R) |
| Hiển thị | `tm_i_showViz` | true | master: tắt/bật toàn bộ viz |
| Hiển thị | `tm_i_showSig` / `tm_i_showVol` / `tm_i_showMA` | true | nhan SWEEP / histogram / MA |
| Hiển thị | `tm_i_showLvl/Zone/Lbl/lvlOn/dash/dashSize` | … | như bản trước |
| Session | `tm_i_sessTz` | America/New_York | múi giờ cho dòng `Session` (Asia/London/NY) trên dashboard |

---

## 4. Outputs

1. **Pane volume**: histogram 6 màu bucket VSA + Volume MA.
2. **Level thanh khoản** (trên giá): đường ngang (buy đỏ / sell teal) + vùng râu + nhãn `ratio + bucket`.
3. **Nhãn SWEEP** (▲ LONG / ▼ SHORT) tại bar tín hiệu (bar retest/confirm nếu không dùng Market).
4. **Entry/SL/TP** setup gần nhất + nhãn giá; tự đóng khi chạm TP/SL.
5. **Dashboard** 2×10 (gồm chế độ vào lệnh, setup, volume ratio/bucket, sweep gần nhất, dòng `Session` theo chuẩn `pine/parts-xau/80_viz.pine`).
6. **Alerts**: `SWEEP LONG`, `SWEEP SHORT`.

---

## 5. Đo lường & tối ưu (walk-forward)

Engine method: `engine/methods/sweep.mjs` (đã đăng ký trong `methods/all.mjs`).
Lưới đo: **7 symbol × TF 60/240 × 4000 nến**, chia **IS (nửa đầu) / OOS (nửa sau)**.

| Cấu hình | IS lệnh / WR% / net% | OOS lệnh / WR% / net% |
|---|---|---|
| market (fade ngay) | 186 / 17.2 / −169.2 | 171 / 25.1 / −79.1 |
| retest | 45 / 17.8 / +14.4 | 36 / 13.9 / −39.3 |
| confirm | 94 / 30.9 / −76.6 | 99 / 43.4 / +44.1 |
| **retest + trend50/200 + RR≥2 + SL[0.5,3]** | **21 / 23.8 / +22.6** | **17 / 23.5 / +16.0** |
| confirm + trend + RR≥2 | 20 / 25.0 / +28.9 | 33 / 18.2 / −54.8 |

**Kết luận từ số liệu:**
- Fade ngay (`Market`) **lệch âm rõ**. Chỉ cấu hình **`Retest + trend + RR≥2 + SL bounds`** dương ở
  **cả IS lẫn OOS** → chọn làm **mặc định**.
- Lọc thêm không tạo edge nếu bản thân entry sai — **entry timing là đòn bẩy số 1**.
- TF 60m > 15m (15m bị phí + nhiễu); lệnh rất thưa (low frequency) — cần thêm dữ liệu/nhiều symbol.
- ⚠️ League cùng lưới cho thấy **các method khác cũng âm** trên cửa sổ này → edge phụ thuộc
  **regime/market**, phải đo tiếp trên dữ liệu dài + walk-forward trước khi tin.

Chạy lại: `npm run engine:league -- --methods sweep --limit 3000 --no-write` (hoặc `engine/run.mjs`).

---

## 6. Build & cài

```bash
npm run pine:sweep        # build target sweep -> pine/dist/TM Liquidity Sweep.pine
npm run pine:build        # build tất cả
npm run pine:copy:sweep   # build + copy dist vào clipboard
npm test             # smoke + engine (gồm test method sweep)
```

Paste `pine/dist/TM Liquidity Sweep.pine` vào Pine Editor → **Add to chart**.

---

## 7. Lưu ý / giới hạn

1. **Chưa có strategy twin** (backtest trên TradingView) — đo bằng engine method thay thế. Muốn bản
   strategy() thì thêm target `sweep-strategy` (tách viz, bridge `strategy.entry/exit`).
2. Indicator **đã tính cả sweep trong confluence** (`listMethods()` = 5) — confluence trung bình
   điểm method nên có thêm sweep.
3. Level vẽ tự động từ pivot (ảnh LuxAlgo có thể vẽ tay).
4. Volume phụ thuộc sàn/symbol của chart (ratio nội tại nên so sánh được).
5. Config mặc định là **điểm khởi đầu đã đo**, không phải cam kết lợi nhuận — hãy tự walk-forward
   trên dữ liệu dài trước khi dùng thật.
