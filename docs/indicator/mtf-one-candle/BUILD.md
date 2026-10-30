# MTF One-Candle — Đặc tả build chỉ báo

Tài liệu này là **spec kỹ thuật** để dựng chỉ báo từ phương pháp đã phân tích trong [README.md](./README.md).
Chưa có mã nguồn nào được tạo ở bước này — đây là bản thiết kế để duyệt trước khi viết Pine.

---

## 1. Định danh & vị trí trong hệ sinh thái

| Hạng mục | Giá trị đề xuất |
|---|---|
| Tên chỉ báo | `MTF One-Candle` (shorttitle `MTF1C`) |
| Nguồn parts (dự kiến) | thư mục `parts-mtf-one-candle` trong `pine/` |
| Output | `MTF One-Candle.pine` + `MTF One-Candle Backtest.pine` |
| Version | `1.0.0` |
| Alert schema | `mtf1c.signal.v1.0` |
| Thị trường | XAUUSD, USOIL trước; mở rộng BTC/Futures sau |
| Twin architecture | indicator trực quan + strategy backtest dùng chung `10_config`→`90_state` |

Target mới cần thêm vào `tools/build.mjs` (cùng khuôn với `pa-mtf` đang chạy):

```js
'mtf1c': {
  file: 'MTF One-Candle.pine',
  dir: 'parts-mtf-one-candle',
  shared: ['common.pine', 'zones.pine'],
  decl: `indicator("MTF One-Candle", "MTF1C", overlay = true, dynamic_requests = true, max_boxes_count = 500, max_lines_count = 500, max_labels_count = 500)`,
},
'mtf1c-strategy': {
  file: 'MTF One-Candle Backtest.pine',
  dir: 'parts-mtf-one-candle',
  shared: ['common.pine', 'zones.pine'],
  decl: `strategy("MTF One-Candle Backtest", "MTF1C BT", overlay = true, pyramiding = 3, calc_on_order_fills = true, process_orders_on_close = true, dynamic_requests = true, initial_capital = 10000, default_qty_type = strategy.percent_of_equity, default_qty_value = 100, commission_type = strategy.commission.percent, commission_value = 0.05, slippage = 1)`,
},
```

Script `package.json` dự kiến (đặt tên theo quy ước `pine:<target>` hiện có, **chưa thêm vào lúc này**):
`pine:mtf1c`, `pine:mtf1c:backtest`, `pine:copy:mtf1c`, `pine:copy:mtf1c:backtest`.

Marker cắt file (dùng lại đúng cơ chế `@part skip:<target>` của các bộ khác):

| Target | `91_strategy.pine` | Pane phụ trong `95_viz.pine` | Kết quả |
|---|---|---|---|
| `mtf1c` | cắt | giữ | indicator overlay + dashboard |
| `mtf1c-strategy` | giữ | cắt | strategy thuần overlay |

---

## 2. Bản đồ module (11 file)

```
parts-mtf-one-candle/
├── 00_header.pine     # //@version=6 + {{DECL}} + {{SHARED}}
├── 10_config.pine     # Toàn bộ input (nhóm 1..6, xem §3)
├── 20_core.pine       # ATR, EMA, volume ratio, session, phí/R
├── 30_tf_ladder.pine  # T1..T3: bias D1, vùng H4, cấu trúc H1, mức M30  ← trái tim của phương pháp
├── 40_ref_candle.pine # T4: phát hiện + chấm điểm nến mồi (§3.2 README)
├── 50_trigger.pine    # Entry/SL/TP1/TP2 + bộ lọc RR
├── 60_pyramid.pine    # Bậc nhồi L0..L3 + dời SL (chỉ chạy ở bản strategy hoặc mô phỏng)
├── 70_regime.pine     # Regime gate + session/news gate + VSA veto (tuỳ chọn)
├── 90_state.pine      # Vòng đời vị thế: PENDING → OPEN → BE → TP1 → CLOSED
├── 91_strategy.pine   # Cầu nối orders cho backtest
├── 95_viz.pine        # Vẽ vùng, nến mồi, Entry/SL/TP, dashboard 2×12
└── 99_alerts.pine     # Alert JSON + alertcondition
```

Luồng dữ liệu (một chiều, không vòng lặp ngược):

```
20_core (ATR/EMA/vol/session)
   └─→ 30_tf_ladder ──┬─→ bias + vùng + mức vào
                      ├─→ 40_ref_candle ──→ 50_trigger ──→ 70_regime (veto)
                      │                                        │
                      └──────────────→ 90_state ←──────────────┘
                                          ├─→ 60_pyramid
                                          ├─→ 91_strategy
                                          ├─→ 95_viz
                                          └─→ 99_alerts
```

---

## 3. Input (nhóm + mặc định)

### Nhóm 1 — Thang khung (T1..T5)

| Input | Kiểu | Mặc định | Ghi chú |
|---|---|---|---|
| `oc_tf1` | timeframe | `D` | T1 bối cảnh |
| `oc_tf2` | timeframe | `240` | T2 vùng |
| `oc_tf3` | timeframe | `60` | T3 cấu trúc |
| `oc_tf4` | timeframe | `30` | mức vào (LMT) |
| `oc_tf5` | timeframe | `15` | T4 nến mồi |
| `oc_tf6` | timeframe | `5` | T5 quản lý/nhồi |
| `oc_enforceLadder` | bool | `true` | chặn tín hiệu nếu T1/T2/T3 không đồng thuận |

### Nhóm 2 — Vùng & cấu trúc

| Input | Mặc định | Ghi chú |
|---|---|---|
| `oc_pivotLen` | `8` | pivot cho swing H4/H1 |
| `oc_zoneBandATR` | `0.35` | band gom pivot thành vùng (× ATR H4) |
| `oc_zoneMaxAge` | `40` | số nến H4 tối đa một vùng còn hiệu lực |
| `oc_clusterBars` | `4` | số nến tối thiểu để coi là "cụm nến" (tương ứng thao tác khoanh tròn ở video 1) |
| `oc_lmtFromT4` | `true` | lấy mức vào từ khung M30 như video 2 |

### Nhóm 3 — Nến mồi (T4)

| Input | Mặc định | Ghi chú |
|---|---|---|
| `oc_refMinScore` | `2` | cần ≥ 2/4 điều kiện (§3.2 README) |
| `oc_bodyMaxPct` | `0.35` | điều kiện 1 |
| `oc_insideBarOn` | `true` | điều kiện 2 |
| `oc_wickMinPct` | `0.5` | điều kiện 3 |
| `oc_rangeMaxATR` | `0.6` | điều kiện 4 |
| `oc_requireAtZone` | `true` | nến mồi phải nằm trong band vùng T2/T3 |

### Nhóm 4 — Entry / SL / TP

| Input | Mặc định | Ghi chú |
|---|---|---|
| `oc_entryBufferATR` | `0.05` | đệm phá biên nến mồi |
| `oc_slBufferATR` | `0.20` | SL sau nến + đệm |
| `oc_minRR` | `1.5` | chặn tín hiệu nếu RR < ngưỡng |
| `oc_tp1Mode` | `Pivot` | `Pivot` (vùng đối diện) hoặc `R2` |
| `oc_tp2Mode` | `R` | `R` (=2R) hoặc `MeasuredMove` |
| `oc_beAtR` | `0.5` | dời SL về entry khi đạt 0.5R |

### Nhóm 5 — Nhồi lệnh (mặc định TẮT)

| Input | Mặc định | Ghi chú |
|---|---|---|
| `oc_pyramidOn` | `false` | bắt buộc phải bật tay |
| `oc_pyramidMaxMult` | `4.0` | tổng khối lượng ≤ 4×L0 (chặn martingale) |
| `oc_pyramidStepR` | `0.5` | bước nhồi theo R |
| `oc_pyramidResetOnBE` | `true` | sau khi dời SL về BE không nhồi thêm |

### Nhóm 6 — Bộ lọc phụ

| Input | Mặc định | Ghi chú |
|---|---|---|
| `oc_sessionFilter` | `false` | dùng hàm session của `pine/shared/common.pine` |
| `oc_vsaVeto` | `false` | veto nến phá có volume yếu |
| `oc_feeR` | `0.05` | phí % để hiển thị `Phí/R` như các bộ khác |
| `oc_confirmOnly` | `true` | chỉ phát tín hiệu khi nến đóng |

---

## 4. Thuật toán

### 4.1 T1–T3: thang khung (`30_tf_ladder.pine`)

```
htf(tf, expr, off) => request.security(syminfo.tickerid, tf, expr[off], lookahead = barmerge.lookahead_on)

// T1 — bias D1 từ cấu trúc pivots, KHÔNG dùng EMA một mình
d1High = htf(oc_tf1, ta.pivothigh(high, oc_pivotLen, oc_pivotLen), 1)
d1Low  = htf(oc_tf1, ta.pivotlow (low,  oc_pivotLen, oc_pivotLen), 1)
bias   = d1High > d1High[1] and d1Low > d1Low[1] ? +1 :
         d1High < d1High[1] and d1Low < d1Low[1] ? -1 : 0

// T2 — vùng H4: gom các pivot trong band ±oc_zoneBandATR*ATR → "cụm nến"
zoneTop / zoneBot / zoneAge  (mảng vòng, tối đa 8 vùng, huỷ khi age > oc_zoneMaxAge)

// T3 — cấu trúc H1 trong vùng + mức vào M30
inZone  = close >= zoneBot and close <= zoneTop
h1Bias  = htf(oc_tf3, ta.pivothigh(...) / pivotlow(...), 1)
lmtLvl  = oc_lmtFromT4 ? htf(oc_tf4, close[1], 1) : (bias > 0 ? zoneBot : zoneTop)
```

**Quy tắc cứng:** `allowedDir = (bias == h1Bias) ? bias : 0`. Khi `oc_enforceLadder = true` và `allowedDir == 0`
→ **không sinh tín hiệu**, dashboard hiện `LADDER BLOCK`.

### 4.2 T4: nến mồi (`40_ref_candle.pine`)

Mỗi nến trên `oc_tf5` tính `refScore` theo 4 điều kiện §3.2 README

```
body   = math.abs(close - open)
rng    = high - low
score  = 0
score += body <= oc_bodyMaxPct * rng ? 1 : 0
score += (high <= high[1] and low >= low[1]) ? 1 : 0            // inside bar
score += (bias >= 0 ? (math.min(open, close) - low) : (high - math.max(open, close))) / rng >= oc_wickMinPct ? 1 : 0
score += rng <= oc_rangeMaxATR * ta.atr(14) ? 1 : 0

isRef  = score >= oc_refMinScore and (not oc_requireAtZone or inZone)
```

Chỉ **một** nến được chọn làm tham chiếu tại mỗi lần setup (`refArmed`), reset khi giá phá khỏi vùng hoặc setup
bị huỷ. Không cộng dồn nhiều nến — đây là điểm khác biệt cốt lõi so với các bộ đang có.

### 4.3 Entry / SL / TP (`50_trigger.pine`)

```
refHigh = high  của nến mồi
refLow  = low   của nến mồi
buf     = oc_entryBufferATR * atr

longTrigger  = allowedDir > 0 and close > refHigh + buf and barstate.isconfirmed
shortTrigger = allowedDir < 0 and close < refLow  - buf and barstate.isconfirmed

entry = longTrigger ? close : shortTrigger ? close : na
sl    = longTrigger ? refLow  - oc_slBufferATR * atr : refHigh + oc_slBufferATR * atr
risk  = math.abs(entry - sl)

tp1 = oc_tp1Mode == 'Pivot' ? nearestOppositePivot(bias, entry) : (longTrigger ? entry + 2*risk : entry - 2*risk)
rr  = math.abs(tp1 - entry) / risk

signal = (longTrigger or shortTrigger) and rr >= oc_minRR and regimeOk and not vsaVeto
```

`nearestOppositePivot` lấy pivot H1/H4 gần nhất **phía trước** entry trong bán kính $\\le 6R$; nếu không có → fallback
$2R$. Nếu $RR < oc_{minRR}$ → `skipReason = 'RR_LOW'` (hiện lên dashboard, không bắn alert).

### 4.4 Nhồi lệnh (`60_pyramid.pine`)

```
stage 0 (L0): qty = baseQty
kích hoạt L(k) khi: (close - entry) * dir >= k * oc_pyramidStepR * risk
                    and close đóng nến cùng chiều
                    and qtyTotal + addQty <= oc_pyramidMaxMult * baseQty
                    and not hitTP1 and not beMoved
```

Mỗi bậc: đặt SL mới theo bảng §3.4 README; `pyramidCount` hiển thị trên dashboard. Tắt mặc định.

### 4.5 Máy trạng thái (`90_state.pine`)

```
PENDING ──trigger──> OPEN ──+0.5R──> BE ──TP1──> TP1_HIT ──TP2/ngược chiều──> CLOSED
   │                  │
   │                  ├─ SL hit → CLOSED (loss)
   └─ hết hiệu lực (phá vùng ngược / quá oc_zoneMaxAge nến) → CANCELLED
```

Mọi chuyển trạng thái đẩy 1 event vào buffer giới hạn (mảng tĩnh ≤ 500 phần tử, cùng mẫu chống `RE10143` đã dùng ở
`docs/indicator/price-action-mtf/BUILD.md` §2.2).

---

## 5. Chống repaint (bắt buộc, cùng chuẩn toàn hệ)

1. Mọi `request.security` dùng `expr[1]` + `lookahead_on` (lấy dữ liệu **đã đóng** của khung lớn).
2. Tín hiệu/alert đi qua `oc_okBar = oc_confirmOnly ? barstate.isconfirmed : true`.
3. Neckline/pivot dùng mảng buffer thay offset sâu (tránh lỗi runtime RE10143).
4. Không vẽ lại vùng đã đóng; vùng hết hạn thì xoá box, không "kéo dài cho đẹp".
5. Nến mồi đã chọn là bất biến cho tới khi setup đóng (không đổi sang nến khác giữa chừng).

---

## 6. Dashboard (2 cột × 12 hàng)

| Hàng | Nội dung |
|---|---|
| 1 | `T1 D1: UP / DOWN / RANGE` (màu theo bias) |
| 2 | `T2 H4 zone: {bot} – {top}` + age (nến) |
| 3 | `T3 H1: bias` + `allowed: BUY/SELL/NONE` |
| 4 | `T4 M30 level (LMT): {lmtLvl}` |
| 5 | `T5 M15 ref candle: high / low / score x/4` |
| 6 | `Trigger: phá {refHigh/refLow} + buf` |
| 7 | `Entry / SL / TP1 / TP2` |
| 8 | `RR: {rr}` (đỏ nếu < minRR) |
| 9 | `Regime: TRENDING/RANGING/CHOPPY` + `[SQZ]` |
| 10 | `Pyramid: L0..L3` + tổng khối lượng (×L0) |
| 11 | `Phí/R: {feeR}` + `Session: OK/BLOCK` |
| 12 | `Trạng thái: PENDING/OPEN/BE/TP1/CLOSED` + lý do skip |

Bố cục dùng lại chuẩn hiển thị trong suốt của hệ (nền đen mờ, key xám, value bạc) để không lệch style 4 bộ còn lại.

---

## 7. Alert contract (`mtf1c.signal.v1.0`)

```json
{
  "v": 1,
  "version": "1.0.0",
  "schema": "mtf1c.signal.v1.0",
  "action": "BUY",
  "sym": "XAUUSD",
  "tf": "15",
  "ladder": { "d1": "UP", "h4zone": [4375.6, 4396.2], "h1": "UP", "m30Lmt": 4396.2 },
  "ref": { "high": 4396.8, "low": 4394.9, "score": 3 },
  "p": 4397.1,
  "sl": 4394.6,
  "tp1": 4409.8,
  "tp2": 4402.1,
  "rr": 2.8,
  "skips": "none",
  "time": "2026-10-30T09:45:00Z"
}
```

Alert bắn **chỉ** khi: `signal == true`, `rr >= oc_minRR`, và (nếu bật) `oc_pyramidOn` không làm vượt `oc_pyramidMaxMult`.
Các alert phụ (không tradeable): `mtf1c.ref` (có nến mồi), `mtf1c.skip` (bị chặn vì RR/ladder/regime).

---

## 8. Bản backtest (twin)

- Vào lệnh tại `close` của nến kích hoạt (`process_orders_on_close = true`), không dùng giá tick.
- `pyramiding = 3` khớp bậc L1–L3; khi `oc_pyramidOn = false` thì `pyramiding = 0`.
- Phí mặc định `commission_value = 0.05`, `slippage = 1` (tick) — bắt buộc để không lặp lại lỗi "RR 1:1 mà quên phí".
- Exit: SL → TP1 (một phần nếu bật nhồi) → TP2; hoặc exit sớm khi đóng nến ngược chiều mạnh trên M5.
- Bắt buộc xuất 3 bảng: tổng lệnh, winrate theo `refScore` (2/3/4), phân bố RR thực.

---

## 9. Nghiệm thu

Chạy sau khi hoàn tất mã nguồn (các lệnh dưới đây đã tồn tại trong repo):

```bash
npm run pine:build        # build toàn bộ target, 0 warning
npm run pine:test         # smoke test toàn bộ dist
npm run docs:check        # kiểm tra tài liệu ↔ mã nguồn
npm run verify            # gate toàn diện (build + docs + test suites)
```

Kiểm tra thủ công trên TradingView:

1. XAUUSD M15: bật chỉ báo, xác nhận 5 hàng đầu dashboard khớp với việc đổi khung tay D1/H4/H1/M30/M15.
2. So 20 setup gần nhất: nến mồi được đánh dấu phải là nến **tại biên vùng** và **score ≥ 2**.
3. Tắt `oc_enforceLadder` → số tín hiệu tăng rõ rệt; đây là thước đo mức độ lọc của thang khung.
4. Bật `oc_pyramidOn` trên bản strategy → kiểm tra tổng khối lượng không vượt `oc_pyramidMaxMult` và SL dời đúng bậc.
5. A/B trên cùng chart với `Price Action MTF`: đếm số tín hiệu trùng (kỳ vọng 30–50% nếu cùng trend/vùng).

---

## 10. Thứ tự thực hiện đề xuất

1. `10_config` + `20_core` + `30_tf_ladder` — chạy được dashboard 4 hàng đầu (chưa tín hiệu).
2. `40_ref_candle` + `50_trigger` — tín hiệu + Entry/SL/TP, chưa nhồi.
3. `90_state` + `95_viz` + `99_alerts` — đủ bản indicator dùng được.
4. `91_strategy` — bản backtest, chạy A/B trên XAU M15.
5. `60_pyramid` + `70_regime` — chỉ bật sau khi bước 4 có số liệu.

> Chưa bước nào được coi là "xong" nếu chưa qua bước 4: như đã ghi ở các tài liệu audit trước, tín hiệu price-based
> trên M5/M15 **không tự động có lợi thế** sau phí.
