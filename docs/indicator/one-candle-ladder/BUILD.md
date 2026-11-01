# One-Candle Ladder — Đặc tả build chỉ báo

Tài liệu này là **spec kỹ thuật** để dựng chỉ báo từ phương pháp đã phân tích trong [README.md](./README.md).

> **Trạng thái 2026-10-31: ĐÃ DỰNG XONG bản 1.0.0** — 11 module trong `pine/parts-one-candle-ladder/`,
> hai target `ocl` + `ocl-strategy`, đã build lint sạch và qua smoke test. Xem §11 để biết đã kiểm cái gì
> và **cái gì chưa** (chưa từng chạy trên TradingView, chưa có số liệu backtest).

---

## 1. Định danh & vị trí trong hệ sinh thái

| Hạng mục | Giá trị đề xuất |
|---|---|
| Tên chỉ báo | `One-Candle Ladder` (shorttitle `OCL`) |
| Nguồn parts (dự kiến) | thư mục `parts-one-candle-ladder` trong `pine/` |
| Output | `One-Candle Ladder.pine` + `One-Candle Ladder Backtest.pine` |
| Version | `1.0.0` |
| Alert schema | `ocl.signal.v1.0` |
| Thị trường | XAUUSD, USOIL trước; mở rộng BTC/Futures sau |
| Twin architecture | indicator trực quan + strategy backtest dùng chung `10_config`→`90_state` |

Hai target **đã có** trong `tools/build.mjs` (cùng khuôn với `pa-mtf`; chỉ dùng `common.pine` vì bộ này không dùng
hạ tầng zone/FVG của `zones.pine`):

```js
'ocl': {
  file: 'One-Candle Ladder.pine',
  dir: 'parts-one-candle-ladder',
  version: '1.0.0',
  shared: ['common.pine'],
  decl: `indicator("One-Candle Ladder", shorttitle = "OCL", overlay = true, dynamic_requests = true, max_boxes_count = 500, max_lines_count = 500, max_labels_count = 500, max_bars_back = 1000)`,
},
'ocl-strategy': {
  file: 'One-Candle Ladder Backtest.pine',
  dir: 'parts-one-candle-ladder',
  version: '1.0.0',
  shared: ['common.pine'],
  decl: `strategy("One-Candle Ladder Backtest", shorttitle = "OCL BT", overlay = true, pyramiding = 4, calc_on_order_fills = true, process_orders_on_close = true, dynamic_requests = true, max_boxes_count = 500, max_lines_count = 500, max_labels_count = 500, max_bars_back = 1000, initial_capital = 10000, default_qty_type = strategy.percent_of_equity, default_qty_value = 100, commission_type = strategy.commission.percent, commission_value = 0.05, slippage = 1)`,
},
```

Ghi chú: `pyramiding = 4` = L0 + 3 lần nhồi, khớp cứng với `ocl_pyramidMaxMult = 4`.

Script `package.json` **đã thêm**: `pine:ocl`, `pine:ocl:backtest`, `pine:copy:ocl`, `pine:copy:ocl:backtest`.

Marker cắt file (dùng lại đúng cơ chế `@part skip:<target>` của các bộ khác):

| Target | `91_strategy.pine` | Pane phụ trong `95_viz.pine` | Kết quả |
|---|---|---|---|
| `ocl` | cắt | giữ | indicator overlay + dashboard |
| `ocl-strategy` | giữ | cắt | strategy thuần overlay |

---

## 2. Bản đồ module — ĐÃ DỰNG (11 file, xem §11 để biết trạng thái)

```
parts-one-candle-ladder/
├── 00_header.pine     # //@version=6 + {{DECL}} + {{SHARED}}
├── 10_config.pine     # Toàn bộ input (nhóm 1..8, xem §3)
├── 20_core.pine       # ATR, volume/VSA bucket, session, ADX/regime  ← gộp cả 70_regime
├── 30_tf_ladder.pine  # T1..T4: bias D1, vùng H4, cấu trúc H1, mức M30  ← trái tim
├── 40_ref_candle.pine # T5: phát hiện + chấm điểm nến tham chiếu (§3.2 README)
├── 50_trigger.pine    # Entry/SL/TP1/partial + hai kiểu vào + bộ lọc RR
├── 60_state.pine      # Vòng đời vị thế: PENDING → OPEN → partial → BE → TP1 → CLOSED
├── 65_pyramid.pine    # Bậc nhồi L0..L3 + đếm đơn vị (mặc định TẮT, cap ×4)
├── 91_strategy.pine   # Cầu nối orders cho backtest  (// @part skip:ocl)
├── 95_viz.pine        # Hộp nến tham chiếu, Entry/SL/TP, dashboard 2×12
└── 99_alerts.pine     # Alert JSON ocl.signal.v1.0 + alertcondition
```

**Vì sao không còn `70_regime.pine`:** Pine **không có forward declaration** — trigger ở `50_trigger`
đọc `ocl_regimeOk` / `ocl_vsaVeto` / `ocl_sessOk`, nên các biến đó **phải được khai báo trước** file 50.
Số thứ tự tên file chính là thứ tự ghép, nên regime buộc phải nằm trong `20_core`. Tương tự, `state` phải
đứng trước `pyramid` (65 đọc `ocl_posDir`/`ocl_posRisk` của 60).

Luồng dữ liệu (một chiều, không vòng lặp ngược; số = thứ tự file):

```
20_core (ATR/vol/VSA/session/ADX)
   └─→ 30_tf_ladder ──┬─→ bias + vùng + mức vào + allowedDir
                      └─→ 40_ref_candle ──→ 50_trigger (RR ≥ 2.5)
                                              └─→ 60_state ──→ 65_pyramid
                                                              ├─→ 91_strategy (chỉ bản backtest)
                                                              ├─→ 95_viz
                                                              └─→ 99_alerts
```

---

## 3. Input (nhóm + mặc định)

### Nhóm 1 — Thang khung (T1..T5)

| Input | Kiểu | Mặc định | Ghi chú |
|---|---|---|---|
| `ocl_tf1` | timeframe | `D` | T1 bối cảnh |
| `ocl_tf2` | timeframe | `240` | T2 vùng |
| `ocl_tf3` | timeframe | `60` | T3 cấu trúc |
| `ocl_tf4` | timeframe | `30` | mức vào (LMT) |
| `ocl_tf5` | timeframe | `15` | T4 nến mồi |
| `ocl_tf6` | timeframe | `5` | T5 quản lý/nhồi |
| `ocl_enforceLadder` | bool | `true` | chặn tín hiệu nếu T1/T2/T3 không đồng thuận |

### Nhóm 2 — Vùng & cấu trúc

| Input | Mặc định | Ghi chú |
|---|---|---|
| `ocl_pivotLen` | `8` | pivot cho swing H4/H1 |
| `ocl_zoneBandATR` | `0.35` | band gom pivot thành vùng (× ATR H4) |
| `ocl_clusterBars` | `4` | số nến tối thiểu để coi là "cụm nến" (chỉ dùng để hiển thị; tương ứng thao tác khoanh tròn ở video 1) |
| `ocl_showZone` | `true` | hiển thị band vùng T2 lên chart |

Vùng T2 thực tế không lưu mảng nhiều vùng có `age`: nó lấy **pivot H4 đã xác nhận gần giá nhất** rồi mở band
±`ocl_zoneBandATR` × ATR(H4) — xem §4.1.

### Nhóm 3 — Nến mồi (T4)

| Input | Mặc định | Ghi chú |
|---|---|---|
| `ocl_refMinScore` | `2` | cần ≥ 2/4 điều kiện (§3.2 README) |
| `ocl_bodyMaxPct` | `0.35` | điều kiện 1 |
| `ocl_insideBarOn` | `true` | điều kiện 2 |
| `ocl_wickMinPct` | `0.5` | điều kiện 3 |
| `ocl_rangeMaxATR` | `0.6` | điều kiện 4 |
| `ocl_requireAtZone` | `true` | nến mồi phải nằm trong band vùng T2/T3 |

### Nhóm 4 — Entry / SL / TP

| Input | Mặc định | Ghi chú |
|---|---|---|
| `ocl_entryMode` | `ZoneLimit` | `ZoneLimit` (chờ giá hồi vào biên vùng/nến rồi khớp LMT — đúng lệnh chờ thật `BUY LMT 4375.646` ở video 2) hoặc `CandleBreak` (phá biên nến mồi) |
| `ocl_entryBufferATR` | `0.05` | đệm khi phá biên nến mồi (`CandleBreak`) |
| `ocl_slBufferATR` | `0.20` | SL sau nến + đệm |
| `ocl_minRR` | `2.5` | chặn tín hiệu nếu RR < ngưỡng. Số đo 3 kèo: 2.4 / 3.1 / **6.8** (README §2.3) — 1.5 là quá thấp |
| `ocl_tp1Mode` | `Pivot` | `Pivot` (cấu trúc đối diện H1/H4) là mặc định vì khớp cả 3 phép đo; `R2` chỉ dùng khi thiếu pivot |

| `ocl_partialAtR` | `2.0` | chốt một phần tại 2R. Bắt buộc có vì tác giả tự cắt TP từ 102.473 → 101.063 ở giây 264 (README §5.2 dòng 5); phần còn lại phải chạy tới TP1 cấu trúc |
| `ocl_beAtR` | `0.5` | dời SL về entry khi đạt 0.5R |

### Nhóm 5 — Nhồi lệnh (mặc định TẮT)

| Input | Mặc định | Ghi chú |
|---|---|---|
| `ocl_pyramidOn` | `false` | bắt buộc phải bật tay |
| `ocl_pyramidMaxMult` | `4.0` | tổng khối lượng ≤ 4×L0 (chặn martingale) |
| `ocl_pyramidStepR` | `0.5` | bước nhồi theo R |
| `ocl_pyramidResetOnBE` | `true` | sau khi dời SL về BE không nhồi thêm |

### Nhóm 6 — Bộ lọc phụ

| Input | Mặc định | Ghi chú |
|---|---|---|
| `ocl_regimeOn` | `true` | lọc theo ADX (bỏ qua thị trường đi ngang) |
| `ocl_adxLen` / `ocl_adxSmooth` | `14` / `14` | tham số ADX |
| `ocl_adxMin` | `18.0` | ADX tối thiểu để vào lệnh (dưới ngưỡng → skip `REGIME`) |
| `ocl_adxTrend` | `25.0` | từ mức này gọi là `TRENDING` |
| `ocl_sessionOn` | `false` | lọc phiên, dùng `f_sessionOk` của `pine/shared/common.pine` |
| `ocl_session` / `ocl_tz` | `0700-2000` / `UTC` | cửa sổ giờ (định dạng session của Pine) |
| `ocl_vsaOn` | `false` | veto khi volume quá yếu |
| `ocl_vsaMinRatio` | `0.8` | ngưỡng `volume / RMA(volume,20)` tối thiểu |
| `ocl_feeR` | `0.05` | phí ước tính trên R (chỉ để hiển thị) |
| `ocl_confirmOnly` | `true` | chỉ phát tín hiệu khi nến đóng |

### Nhóm 7 — Hiển thị

| Input | Mặc định | Ghi chú |
|---|---|---|
| `ocl_showViz` | `true` | công tắc tổng: tắt là bỏ MỌI điểm vẽ |
| `ocl_showDash` | `true` | dashboard 2×12 |
| `ocl_showLevels` | `true` | đường Entry / SL / TP1 của vị thế đang mở |
| `ocl_showRef` | `true` | hộp quanh nến tham chiếu |
| `ocl_cBull` / `ocl_cBear` | `#089981` / `#f23645` | màu tăng/giảm |
| `ocl_font` | `tiny` | cỡ chữ dashboard |

---

## 4. Thuật toán

### 4.1 T1–T3: thang khung (`30_tf_ladder.pine`)

```
htf(tf, expr, off) => request.security(syminfo.tickerid, tf, expr[off], lookahead = barmerge.lookahead_on)

// T1 — bias D1 từ cấu trúc pivots (HH+HL / LH+LL), KHÔNG dùng EMA
f_oclBias(ph0, ph1, pl0, pl1) => ph0 > ph1 and pl0 > pl1 ? 1 : ph0 < ph1 and pl0 < pl1 ? -1 : 0
ph0/ph1 = hai pivot high D1 đã xác nhận gần nhất ; pl0/pl1 = hai pivot low D1
d1Ph = htf(ocl_tf1, ta.pivothigh(high, ocl_pivotLen, ocl_pivotLen), 1)
d1Pl = htf(ocl_tf1, ta.pivotlow (low,  ocl_pivotLen, ocl_pivotLen), 1)
bias = f_oclBias(ph0, ph1, pl0, pl1)          // 0 khi thiếu dữ liệu

// T2 — vùng H4: pivot H4 ĐÃ XÁC NHẬN gần giá nhất, mở band ± k*ATR(H4)
h4Ph, h4Pl, h4Atr = htf(ocl_tf2, [pivothigh, pivotlow, atr(14)], 1)   // giữ lại giá trị cuối khác na
zoneMid = |close - h4Ph| <= |close - h4Pl| ? h4Ph : h4Pl
zoneTop = zoneMid + ocl_zoneBandATR * h4Atr
zoneBot = zoneMid - ocl_zoneBandATR * h4Atr
inZone  = close >= zoneBot and close <= zoneTop

// T3 — cấu trúc H1 + mức vào M30
h1Bias  = bias từ 2 cặp pivot H1 đã xác nhận (f_oclBias)
lmtLvl  = htf(ocl_tf4, close[1], 1)          // mức tham chiếu M30 (hiển thị)
resLvl  = max(h1Ph, h4Ph)                    // kháng cự gần nhất -> TP1 cho lệnh mua
supLvl  = min(h1Pl, h4Pl)                    // hỗ trợ gần nhất  -> TP1 cho lệnh bán
```

Khác spec đầu: **không dùng mảng nhiều vùng có hạn tuổi**. Một band quanh pivot gần nhất là đủ để trả lời
câu hỏi duy nhất của T2 ("vùng hiện hành ở đâu"), và nó không cần state phức tạp để chống repaint.

**Quy tắc cứng:** `allowedDir = (bias == h1Bias) ? bias : 0`. Khi `ocl_enforceLadder = true` và `allowedDir == 0`
→ **không sinh tín hiệu**, dashboard hiện `LADDER BLOCK`.

### 4.2 T4: nến mồi (`40_ref_candle.pine`)

Mỗi nến trên `ocl_tf5` tính `refScore` theo 4 điều kiện §3.2 README

```
body   = math.abs(close - open)
rng    = high - low
score  = 0
score += body <= ocl_bodyMaxPct * rng ? 1 : 0
score += (high <= high[1] and low >= low[1]) ? 1 : 0            // inside bar
score += (bias >= 0 ? (math.min(open, close) - low) : (high - math.max(open, close))) / rng >= ocl_wickMinPct ? 1 : 0
score += rng <= ocl_rangeMaxATR * ta.atr(14) ? 1 : 0

isRef  = score >= ocl_refMinScore and (not ocl_requireAtZone or inZone)
```

Chỉ **một** nến được chọn làm tham chiếu tại mỗi lần setup (`ocl_refArmed`). Nến mới chỉ được arm khi:
(1) `ocl_tf5` vừa đóng một nến khác, (2) `score >= ocl_refMinScore`, (3) `ocl_allowedDir != 0`,
(4) nằm trong vùng nếu `ocl_requireAtZone = true`. Setup bị huỷ khi quá `ocl_refMaxBars` nến chart,
hoặc giá đóng cửa vượt biên đối diện + đệm ATR. Không cộng dồn nhiều nến — đây là điểm khác biệt cốt lõi
so với các bộ đang có.

### 4.3 Entry / SL / TP (`50_trigger.pine`)

```
refHigh = high  của nến mồi
refLow  = low   của nến mồi
buf     = ocl_entryBufferATR * atr

// Hai kiểu vào, cùng một thước R = biên độ nến mồi:
//  (a) CandleBreak — phá biên nến (stop)
//  (b) ZoneLimit   — LMT tại biên vùng/nến, khớp khi giá hồi về (đúng lệnh chờ thật của video)
longStop  = allowedDir > 0 and close > refHigh + buf and barstate.isconfirmed
shortStop = allowedDir < 0 and close < refLow  - buf and barstate.isconfirmed

longLmt  = ocl_entryMode == 'ZoneLimit' and allowedDir > 0 and low  <= refHigh + buf and not longStop
shortLmt = ocl_entryMode == 'ZoneLimit' and allowedDir < 0 and high >= refLow  - buf and not shortStop

longTrigger  = ocl_entryMode == 'ZoneLimit' ? longLmt  : longStop
shortTrigger = ocl_entryMode == 'ZoneLimit' ? shortLmt : shortStop

entry = longTrigger ? (ocl_entryMode == 'ZoneLimit' ? math.min(refHigh + buf, open) : close) :
        shortTrigger ? (ocl_entryMode == 'ZoneLimit' ? math.max(refLow  - buf, open) : close) : na
sl    = longTrigger ? refLow  - ocl_slBufferATR * atr : refHigh + ocl_slBufferATR * atr
risk  = math.abs(entry - sl)

// TP1 = cấu trúc đối diện trên H1/H4 (không phải 2R). 2R chỉ là mốc chốt một phần.
tp1     = ocl_tp1Mode == 'Pivot' ? nearestOppositePivot(bias, entry) : (longTrigger ? entry + 2*risk : entry - 2*risk)
partial = longTrigger ? entry + ocl_partialAtR * risk : entry - ocl_partialAtR * risk
rr      = math.abs(tp1 - entry) / risk

signal = (longTrigger or shortTrigger) and rr >= ocl_minRR and regimeOk and not vsaVeto and not na(tp1)
```

`nearestOppositePivot` lấy pivot H1/H4 gần nhất **phía trước** entry trong bán kính $\\le 6R$; nếu không có → fallback
$2R$. Nếu $RR < ocl_{minRR}$ → `skipReason = 'RR_LOW'` (hiện lên dashboard, không bắn alert).

### 4.4 Nhồi lệnh (`60_pyramid.pine`)

```
L0: units = 1.0                     // base, khoi luong 1 don vi
maxStage = int(ocl_pyramidMaxMult) - 1        // cap 4 -> toi da 3 lan nhoi
L(k): (close - entry) * dir >= k * ocl_pyramidStepR * risk
      and nen dong cung chieu
      and stage < maxStage
      and (khong bat ocl_pyramidResetOnBE, hoac SL chua doi ve hoa von)
      => stage += 1 ; units += 1.0
```

Khối lượng mỗi bậc là **đúng 1 đơn vị** (không nhân ×2/×3/×4 như bản spec đầu) — vì tổng bị chặn ở
`ocl_pyramidMaxMult`, và cách đếm đơn vị này giữ được cả hai điều kiện: tổng ≤ 4×L0 **và** số bậc ≤ 3.

**Ghi chú trung thực về nguồn:** video 1 tăng khối lượng từ **0.01 → 0.73 lô** (×73) rồi cộng thêm các vé 0.73/0.65/0.55
ở vùng 100.48–100.51, tức tổng có lúc ~2.66 lô. `ocl_pyramidMaxMult = 4` là **giới hạn an toàn do mình đặt**, không phải
hành vi của tác giả — bản strategy mặc định phải tắt nhồi để backtest không bị nhiễm chính sách tăng size này.

Mỗi bậc: dashboard hiển thị `L{k}/maxStage` + tổng đơn vị (`ocl_pyrText`); SL đặt lại theo bảng §3.4 README. Tắt mặc định.

### 4.5 Máy trạng thái (`60_state.pine`)

```
PENDING ──trigger──> OPEN ──+ocl_partialAtR·R──> đã chốt một phần (ocl_evPartial)
                        │
                        ├─ +ocl_beAtR·R → dời SL về entry (ocl_beMoved)
                        ├─ chạm TP1  → CLOSED (win, ghi R thực)
                        └─ chạm SL   → CLOSED (loss)
   └─ chưa vào lệnh mà nến tham chiếu hết hiệu lực (quá ocl_refMaxBars nến chart,
      hoặc giá đóng cửa vượt biên đối diện + đệm ATR) → giải giáp (ocl_refArmed = false)
```

Trạng thái được đánh dấu bằng **cờ boolean + biến vô hướng**, không dùng mảng event buffer: bộ này chỉ có một
vị thế tại một thời điểm nên không cần cửa sổ sự kiện. (Bản spec đầu dự định dùng buffer 500 phần tử như
`price-action-mtf` — đã bỏ vì thừa.)

---

## 5. Chống repaint (bắt buộc, cùng chuẩn toàn hệ)

1. Mọi `request.security` dùng `expr[1]` + `lookahead_on` (lấy dữ liệu **đã đóng** của khung lớn).
2. Tín hiệu/alert đi qua `ocl_okBar = ocl_confirmOnly ? barstate.isconfirmed : true`.
3. Không dùng offset sâu kiểu `close[k]` với k lớn (tránh runtime RE10143): chỉ so `[1]`/`[2]` của khung T5, và
   khi vẽ box/line thì kẹp mốc trái bằng `math.max(bar_index - 500, ...)`.
4. Nến tham chiếu đã arm là **bất biến** cho tới khi setup đóng hoặc hết hiệu lực (không đổi sang nến khác giữa chừng).
5. Kiểm chứng tự động: `tools/smoke.mjs` §2e đếm **số `request.security` == số `lookahead_on`** để không có
   lần gọi nào lọt lưới.

---

## 6. Dashboard (2 cột × 12 hàng)

Bảng **2 cột × 12 hàng** (`table.new(position.top_right, 2, 12)`), `table.clear(ocl_tbl, 0, 0, 1, 11)` mỗi lần vẽ lại:

| Hàng | Cột trái (key) | Cột phải (value) |
|---|---|---|
| 0 | `ONE-CANDLE LADDER` | `{timeframe} {ocl_entryMode}` |
| 1 | `T1 {tf1} bias` | `UP / DOWN / RANGE` |
| 2 | `T2 {tf2} zone` | `{zoneBot} - {zoneTop}` (vàng khi giá trong vùng) |
| 3 | `T3 {tf3} -> allowed` | `BUY / SELL / NONE` + `OK / BLOCK` |
| 4 | `T4 {tf4} level` | mức M30 |
| 5 | `T5 {tf5} ref candle` | `{refLow} - {refHigh}  {score}/4` |
| 6 | `Trigger` | `LONG / SHORT / -` |
| 7 | `Entry / SL / TP1` | 3 mức giá |
| 8 | `RR (min {ocl_minRR})` | RR, đỏ nếu dưới ngưỡng |
| 9 | `Regime  ADX {adx}` | `TRENDING / RANGING / CHOPPY` |
| 10 | `Pyramid  {state}` | `OFF` hoặc `L{k}/{max}  {units}x` |
| 11 | `R%  {riskPct}` | lý do skip: `PASS / RR LOW / LADDER BLOCK / REGIME / SESSION / VOL WEAK` |

Bố cục dùng lại chuẩn hiển thị trong suốt của hệ (nền đen mờ, key xám, value bạc) để không lệch style 4 bộ còn lại.

---

## 7. Alert contract (`ocl.signal.v1.0`)

```json
{
  "v": 1,
  "version": "1.0.0",
  "schema": "ocl.signal.v1.0",
  "ts": "2026-10-31T09:45:00Z",
  "symbol": "XAUUSD",
  "tf": "15",
  "action": "ENTRY",
  "ladder": { "d1": "UP", "h1": "UP", "zoneLo": 4387.3, "zoneHi": 4399.9, "m30": 4396.2, "refHi": 4398.1, "refLo": 4395.2, "refScore": 3 },
  "plan": { "side": "LONG", "entry": 4398.3, "sl": 4394.6, "tp1": 4409.4, "partial": 4405.7, "rr": 2.7, "riskPct": 0.084, "mode": "ZoneLimit", "skip": "PASS" }
}
```

Ba `action`: `ENTRY` (kèm `ladder` + `plan`), `PARTIAL` (kèm `at`), `TAKE_PROFIT` / `STOP_LOSS` (kèm `level`, `r`).
Số trong payload là **số thật của setup đang chạy**, không phải giá trị mẫu — `ladder` là ảnh chụp tại thời điểm
phát lệnh, `plan` là các mức đã chốt lúc vào.

Alert bắn **chỉ** khi: `signal == true`, `rr >= ocl_minRR`, và (nếu bật) `ocl_pyramidOn` không làm vượt `ocl_pyramidMaxMult`.
Các alert phụ (không tradeable): `ocl.ref` (có nến mồi), `ocl.skip` (bị chặn vì RR/ladder/regime).

---

## 8. Bản backtest (twin)

- Vào lệnh tại `close` của nến kích hoạt (`process_orders_on_close = true`), không dùng giá tick.
- `pyramiding = 4` khớp L0 + 3 lần nhồi (cap ×4). Khi `ocl_pyramidOn = false` thì không có lệnh `Add*` nào được gửi,
  nên tham số **đứng yên vẫn an toàn** — không sửa declaration khi tắt nhồi.
- Phí mặc định `commission_value = 0.05`, `slippage = 1` (tick) — bắt buộc để không lặp lại lỗi "RR 1:1 mà quên phí".
- Exit: chốt 50% tại `ocl_posPartial` (`strategy.exit` id `Partial L/S`), phần còn lại theo `ocl_posTp1` / `ocl_posSl`
  (id `Exit L/S`); dọn hết bằng `strategy.close_all` khi state báo đã đóng.
- Bắt buộc xuất 4 bảng: tổng lệnh, winrate theo `refScore` (2/3/4), phân bố RR thực, và **so sánh 2 chế độ quản lý**:
  (a) giữ TP1 = cấu trúc (RR 2.4–6.8 như nguồn) vs (b) cắt một phần ở 2R rồi để phần còn lại chạy (đúng hành vi ở giây 264).
  Đây là thí nghiệm trả lời câu hỏi "R nhỏ + TP xa có thật sự tốt hơn cắt sớm" bằng số, không bằng niềm tin.

---

## 9. Nghiệm thu

Đã chạy trên bản 1.0.0 (xem §11 cho kết quả):

```bash
npm run pine:build        # build toàn bộ target, 0 warning
npm run pine:test         # smoke test toàn bộ dist
npm run docs:check        # kiểm tra tài liệu ↔ mã nguồn
npm run verify            # gate toàn diện (build + docs + test suites)
```

Kiểm tra thủ công trên TradingView:

1. XAUUSD M15: bật chỉ báo, xác nhận 5 hàng đầu dashboard khớp với việc đổi khung tay D1/H4/H1/M30/M15.
2. **Kiểm tra số học trên đúng 2 mốc của nguồn:** dựng lại kèo SELL ngày 15/08 quanh 4396 trên M15 → dashboard phải ra
   R ≈ 3.7 điểm và RR ≈ 2.4 (TP1 ở 4387.3); nếu lệch quá 0.5 điểm nghĩa là cách chọn nến mồi hoặc band vùng đang sai.
   Với USOIL M10 quanh 100.0 → R ≈ 0.36 và TP1 ≈ 102.47 (RR ≈ 6.8).
3. So 20 setup gần nhất: nến mồi phải là **nến nhỏ trong vùng** (không bắt buộc ở cực trị — xem README §2.2 lưu ý) và **score ≥ 2**.
4. Tắt `ocl_enforceLadder` → số tín hiệu tăng rõ rệt; đây là thước đo mức độ lọc của thang khung.
5. Bật `ocl_pyramidOn` trên bản strategy → kiểm tra tổng khối lượng không vượt `ocl_pyramidMaxMult` và SL dời đúng bậc.
6. A/B trên cùng chart với `Price Action MTF`: đếm số tín hiệu trùng (kỳ vọng 30–50% nếu cùng trend/vùng).

---

## 10. Thứ tự thực hiện

1. ~~`10_config` + `20_core` + `30_tf_ladder`~~ — xong.
2. ~~`40_ref_candle` + `50_trigger`~~ — xong.
3. ~~`60_state` + `95_viz` + `99_alerts`~~ — xong (bản indicator dùng được).
4. `91_strategy` — **đã viết, CHƯA chạy số** (bước còn lại duy nhất).
5. `65_pyramid` + nhóm regime — có sẵn nhưng mặc định TẮT; chỉ bật sau khi bước 4 có số liệu.

> Chưa bước nào được coi là "xong" nếu chưa qua bước 4: tín hiệu price-based trên M5/M15 **không tự động có lợi thế**
> sau phí. Bản 1.0.0 này mới chỉ chứng minh **build đúng**, chưa chứng minh **có lãi**.

---

## 11. Trạng thái build 1.0.0 (2026-10-31)

| Hạng mục | Trạng thái | Bằng chứng |
|---|---|---|
| 11 module Pine | ✅ viết xong | `pine/parts-one-candle-ladder/` |
| Build 2 target | ✅ | `npm run pine:ocl`, `npm run pine:ocl:backtest` → 697 + 748 dòng |
| Lint Pine (hàm/tham số/kiểu int) | ✅ 0 cảnh báo | `node tools/build.mjs` không in dòng `!` nào |
| Smoke test | ✅ 348 pass / 0 fail | `tools/smoke.mjs` §2e có 14 assertion riêng cho OCL |
| Inventory | ✅ đã sinh lại | `npm run pine:inventory` (14 script) |
| **Chạy trên TradingView** | ❌ **chưa** | Bộ này chưa từng được compile trên TradingView; `pine:build` chỉ kiểm được những lỗi đã biết (CE10120/10123/10271), **không** thay trình biên dịch |
| **Backtest có số** | ❌ **chưa** | Chưa có winrate / phân bố RR |

**Việc còn lại trước khi tin được chỉ báo:** copy `pine/dist/One-Candle Ladder.pine` lên TradingView, dán vào XAUUSD M15,
sửa các lỗi compile còn lọt (nếu có) rồi ghi lại; sau đó chạy bản Backtest và xuất 4 bảng ở §8.
