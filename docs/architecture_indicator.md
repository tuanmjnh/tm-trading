# TM Trading — Kiến trúc bộ chỉ báo TradingView

## 1. Mục tiêu

Bộ công cụ Pine Script v6 phát tín hiệu **đảo chiều BUY/SELL** kèm **vùng TP / SL** cụ thể,
đồng thời xuất payload JSON để gửi qua webhook (Telegram / Discord / MT5 / Binance…).

Yêu cầu thiết kế:
- Logic **mở rộng được**: thêm module tín hiệu mới không phải sửa code cũ.
- Chạy được ở **chế độ nến đóng** (không repaint) và **chế độ realtime** (có repaint, đánh dấu rõ).
- Một **logic nghiệp vụ duy nhất**, dùng lại được cho cả `indicator()` và `strategy()`.

## 2. Hạn chế nền tảng quyết định kiến trúc

| Hạn chế Pine Script | Hệ quả | Giải pháp |
|---|---|---|
| Không có `#include` / import file cục bộ | Không tách module thành file thật sự | Source-of-truth nằm ở `pine/parts/*.pine` (file rời), build tool ghép ra file duy nhất |
| Biến phải khai báo tuần tự, không có namespace | Dễ xung đột tên | Quy ước tiền tố `tm_` cho mọi identifier |
| Tối đa ~500 box/line/label đồng thời | Vẽ nhiều plan sẽ vỡ | Vòng đời object có giới hạn (giữ N plan gần nhất, xoá phần cũ) |
| Alert chỉ gửi string, không có object | Không gửi được cấu trúc | Serialize thủ công sang JSON trong `50_alerts.pine` |
| Một script = một indicator overlay | Không tách module ra panel riêng | Gom tất cả vào 1 script, panel bật/tắt bằng input |

## 3. Cây thư mục

```
tm-trading/
├─ docs/
│  ├─ architecture.md      ← tài liệu này
│  └─ alert-schema.md      ← đặc tả payload JSON webhook
├─ pine/
│  ├─ parts/               ← SOURCE OF TRUTH bản TM Signals/Backtest (sửa ở đây)
│  │  ├─ 00_header.pine    ← @version, marker {{DECL}} + {{SHARED}}
│  │  ├─ 10_config.pine    ← toàn bộ input.* (nhóm: chung, module, filter, risk, hiển thị)
│  │  ├─ 20_core.pine      ← tiện ích chung, ATR, swing/pivot, đoạn session
│  │  ├─ 30_signal.pine    ← signal engine: mỗi module trả score ∈ [-1, +1]
│  │  ├─ 40_risk.pine      ← risk engine: entry/SL/TP1-3/partial/trailing
│  │  ├─ 50_state.pine     ← máy trạng thái vị thế + repaint + cooldown
│  │  ├─ 60_viz.pine       ← vẽ marker, box TP/SL, label, dashboard
│  │  └─ 70_alerts.pine    ← alertcondition + alert() JSON payload
│  ├─ parts-vsa/           ← SOURCE OF TRUTH bản TM VSA Wyckoff (00–70, riêng biệt)
│  │  ├─ 10_inputs.pine    ← input VSA (TIM ratio, session, H/T, dashboard)
│  │  ├─ 20_volume.pine    ← ta.rma, 6 bucket qua f_vsaColor, gate sự kiện
│  │  ├─ 30_levels.pine    ← pivot auto → support/resistance + momentum
│  │  ├─ 40_events.pine    ← SV/BC (bắt buộc qua cột TIM) + ST/NS/ND
│  ├─ parts-vsa/           ← 7 lớp + 50_strategy (bridge backtest) của bộ VSA
│  │  └─ 60_viz.pine       ← histogram pane + nhãn force_overlay + dashboard
│  ├─ parts-sweep/         ← SOURCE OF TRUTH bản TM Liquidity Sweep (00–70, riêng biệt)
│  │  ├─ 30_liquidity.pine ← pivot swing → level thanh khoản + phát hiện quét (sweep)
│  │  ├─ 40_events.pine    ← cổng volume VSA + râu từ chối + pha đẩy → SWEEP LONG/SHORT
│  │  └─ 60_viz.pine       ← level + vùng râu + Entry/SL/TP + dashboard
│  ├─ shared/              ← code dùng chung (xem §4.3): common.pine (mọi target),
│                            sess-inputs.pine (vsa+sweep), zones.pine (xau+xau2)
│  └─ dist/                ← OUTPUT của build tool (dán vào TradingView)
│     ├─ TM Signals BTC.pine
│     ├─ TM Backtest BTC.pine
│     ├─ TM VSA Wyckoff.pine
│     ├─ TM VSA Backtest.pine
│     └─ TM Liquidity Sweep.pine
├─ server/
│  └─ webhook.mjs           ← webhook receiver (dời từ tools/notify, Node không dependency)
├─ engine/                  ← BACKBONE tín hiệu/backtest (Phase 2–5, xem docs/roadmap.md)
├─ exec/                    ← risk gate + paper/real execution (Phase 6+)
├─ app/                     ← UI Nuxt dashboard (Phase 7+)
├─ services/                ← market intelligence + heartbeat (Phase 8+)
├─ ai/                      ← AI copilot gateway (Phase 11+)
├─ data/                    ← cache klines/indicators (không commit)
├─ reports/                 ← báo cáo PNG/MD/CSV (không commit)
├─ tools/
│  ├─ build.mjs            ← assembler: parts*/ + shared/ → dist (đa target)
│  └─ ...
└─ README.md
```

**Quy tắc số tiền tố file = thứ tự ghép.** `00` → `70`. Bộ lọc comment `// @part` cho phép
build tool bỏ qua hoặc thay thế khối khi sinh `strategy()` so với `indicator()`.

**Đa target.** Mỗi target trong `TARGETS` (`tools/build.mjs`) khai báo `file` (tên dist),
`dir` (thư mục parts: `parts` hay `parts-vsa`) và `shared` (danh sách file trong
`pine/shared/` chèn vào marker `{{SHARED}}` của `00_header`). Hàm chung (`f_vsaColor`,
`f_sessionOk`, ...) chỉ định nghĩa một lần ở `shared/` và được mọi bản dùng lại.

### 4.3. `pine/shared/` — code dùng chung (2026-10 refactor)

| File | Target include | Nội dung |
|---|---|---|
| `common.pine` | **mọi target** (7 bản) | `f_sessionOk`, `f_vsaColor`, `f_vsaName` (6 bucket VSA); `f_clamp`, `f_fmtPx`, `f_isNewDay` (math/format thuần); `f_ts`, `f_sym` (webhook JSON helpers —CE10123 warning nằm cạnh đây); `f_sessAsia/London/Ny/Name` (cửa sổ phiên chuẩn 1700-0200/0200-1000/0700-1500 — trước đây copy ở **5 nơi**: parts, vsa, sweep, xau, xau2 dashboard) |
| `sess-inputs.pine` | `vsa`, `vsa-strategy`, `sweep` | Input session trùng lặp 2 bản: `tm_i_sessOn` / `tm_i_sess` / `tm_i_tz` (group *TM · Volume*) + `tm_i_sessTz` (group *TM · Session*) |
| `zones.pine` | `xau`, `xau2` | Engine S/R zones: UDT `SrZone` + `var array sr_zones` + `f_addZone` / `f_nearSupport` / `f_nearResistance` — trước đây là 2 bản copy `SrZone`/`X2SrZone` (xau2 đã rename array về tên chung `sr_zones`; mỗi dist là script độc lập nên không xung đột) |

**Quy tắc chọn chỗ:** hàm thuần không phụ thuộc input → `common.pine`; input declarations
chỉ dùng cho 1-2 target → file shared riêng + khai báo trong `TARGETS[].shared` của
`build.mjs`. Hàm nhận **mọi biến phụ thuộc làm tham số** (vd `f_addZone(zones, px, side,
atr, width, maxZone)`) vì shared được chèn **trước** `10_config`/`20_core` — không được
tham khao biến toàn cục của target.

**Bẫy đã gặp:** marker `{{SHARED}}` được `build.mjs` thay bằng **toàn bộ nội dung file** —
không được ghi chuỗi `{{SHARED}}` trong comment của parts (sẽ chèn sai + làm lệch ngoặc).

> Các block viz (dashboard table, box TP/SL) **không** gộp vào shared: chúng phụ thuộc
> biến `var` (bxTp1, lnEntry, tm_tbl) + tên cột riêng của từng target, gộp sẽ phải truyền
> 10+ tham số — chi phí > lợi ích.

### 4.4. Múi giờ — 2 họ input và mối quan hệ với chart TradingView

Mọi indicator Pine dùng **2 họ input múi giờ**, cả hai đều truyền tz **tường minh** vào
`time(...)` — không hàm nào đọc múi giờ của chart:

| Họ input | Label trên UI | Mặc định | Dùng để | Ví dụ hàm |
|---|---|---|---|---|
| **Phiên của bạn** | `Múi giờ phiên của bạn` | `Asia/Ho_Chi_Minh` | Lọc khung giờ giao dịch 0800-1600 theo giờ địa phương (`tm_flt_tz`, `xau_vol_tz`, `x2_vol_tz`, `tm_i_tz`) | `f_sessionOk(sess, tz)` |
| **Thị trường** | `Múi giờ thị trường (NY)` | `America/New_York` | Nhận diện phiên Á/London/NY cho scoring + dashboard (`tm_sessTz`, `xau_sess_tz`, `x2_sessTz`, `tm_i_sessTz`) | `f_sessAsia/London/Ny(tz)`, neo NY để 3 cửa sổ `1700-0200/0200-1000/0700-1500` đúng bản chất thị trường + tự theo DST |

**Đổi cài đặt chart TradingView sang `Asia/Ho_Chi_Minh` (UTC+7) KHÔNG ảnh hưởng tính toán** —
Pine không đọc được chart timezone; setting đó chỉ đổi hiển thị trục thời gian.

**Ranh giới ngày (`f_isNewDay` = `ta.change(time("D"))`) dùng EXCHANGE timezone** (mặc định của
`time("D")`), không phải chart hay input — nên bộ đếm “Lệnh hôm nay” reset theo ngày sàn.
Lưu ý: `docs/time-rules.md` (T2: ngày UTC) áp cho **engine server-side**, không áp cho Pine
indicator chạy trên chart.

**Strategy twin (VSA).** `vsa` và `vsa-strategy` dùng **chung** `parts-vsa`, nên logic sự kiện
chỉ tồn tại ở một chỗ:

| Target | Dist | `50_strategy` | `60_viz` |
|---|---|---|---|
| `vsa` | `TM VSA Wyckoff.pine` | cắt (`@part skip:vsa`) | giữ |
| `vsa-strategy` | `TM VSA Backtest.pine` | giữ | cắt (`@part skip:vsa-strategy`) |

Marker `@part skip:<target>` là **công tắc theo target**, không phải theo file — tên target có
gạch nối vẫn hoạt động (regex `[\w-]+`). Bridge đọc thẳng `tm_lvlE/S/T` do `40_events` tính,
nên SL/TP của lệnh backtest chính là mức mà indicator vẽ ra.

## 4. Kiến trúc lớp (Layered pipeline)

```
                 ┌─────────────────────────────────────────────┐
  INPUTS         │ 10_config  — chỉ khai báo input, KHÔNG logic  │
                 └─────────────────────────────────────────────┘
                                     │
                 ┌────────────────────────────────────────────┐
  CORE           │ 20_core    — ATR, pivot, session, helpers   │  ← thuần hàm
                 └─────────────────────────────────────────────┘
                                     │
        ┌────────────────────────────┼────────────────────────────┐
        │                            │                            │
  ┌─────▼──────┐  ┌─────▼──────┐  ┌──▼───────┐  ┌──────▼─────┐  ┌──────▼─────┐
  │ module 1   │  │ module 2   │  │ module 3 │  │  module 4  │  │  module 5  │
  │ trendFlip  │  │ divergence │  │ bollinger│  │ priceAction│  │ (thêm sau) │
  │  ±1 / 0    │  │  ±1 / 0    │  │  ±1 / 0  │  │   ±1 / 0   │  │            │
  └─────┬──────┘  └─────┬──────┘  └──┬───────┘  └──────┬─────┘  └──────┬─────┘
        └────────────────┴─────────────┴─────────────────┴──────────────┘
                                     │  weighted average → tm_score ∈ [-1, +1]
                 ┌───────────────────▼─────────────────────────────────┐
  FILTER         │ 30_signal — HTF trend, session, volatility gate,  │
                 │            min-confidence, cooldown, RR tối thiểu   │
                 └───────────────────┬─────────────────────────────────┘
                                     │  tm_signal ∈ {-1, 0, +1} + tm_conf
                 ┌───────────────────▼─────────────────────────────────┐
  RISK           │ 40_risk  — entry, SL (ATR/clamp/structure),      │
                 │            TP1-3 theo thang R, % đóng, trailing   │
                 └───────────────────┬─────────────────────────────────┘
                                     │  tm_plan (UDT Plan)
                 ┌───────────────────▼─────────────────────────────────┐
  STATE          │ 50_state — theo dõi vị thế, phát hiện chạm TP/SL, │
                 │            hết hạn theo bar, sinh sự kiện         │
                 └───────────────────┬─────────────────────────────────┘
                        ┌────────────┴────────────┐
                 ┌──────▼──────┐          ┌───────▼────────┐
  OUTPUT        │ 60_viz      │          │ 70_alerts      │
                 │ box/label/  │          │ alertcondition  │
                 │ marker/table│          │ + alert(JSON)   │
                 └─────────────┘          └────────────────┘
```

Ràng buộc phụ thuộc: chỉ đi xuống. `config` không được biết gì về `risk`;
`signal` không biết gì về `viz`. Nhờ vậy thêm module mới chỉ chạm `30_signal.pine`.

### 4.1. Chuẩn viz — theo `pine/parts-xau/80_viz.pine`

Bộ chỉ báo nào có phần hiển thị (`parts`, `parts-vsa`, `parts-sweep`, `parts-xau`,
`parts-xau2`) đều
tuân cùng một chuẩn:

- **Toggle từng thành phần** trong group `… · Hien thi` / `XAU · Display`: marker
  (`showSig`), histogram (`showVol`), Volume MA (`showVolMA`), vùng TP/SL (`showZone`),
  dashboard (`showDash`)…
- **Master switch** `tm_showViz` / `tm_i_showViz` / `xau_showViz` / `x2_showViz` — bật/tắt *toàn bộ*
  phần viz của bộ (marker, label, box, line, plot, dashboard).
- **Dashboard**: `table.clear` trên bar cuối, key `color.new(color.gray, 10)`, value
  `color.silver`, nền `color.new(color.black, 100)`, cỡ chữ theo `dashSize`.
- **Dòng `Session`**: phiên Asia / London / NY / Overlap tính bằng `time()` trên múi giờ
  riêng (`tm_sessTz` / `tm_i_sessTz` / `x2_sessTz`, mặc định `America/New_York`) với đúng cửa sổ
  `1700-0200` / `0200-1000` / `0700-1500` như bộ chuẩn.
- **Pane volume**: `plot(showVol ? vol : na, …)` + `plot(showMA ? volMA : na, …)`,
  màu 6 bucket VSA qua `f_vsaColor`.

### 4.2. TM XAU Signals 2 (`parts-xau2`) — master-prompt v2

Bản nâng cấp của `parts-xau` theo `docs/indicator-XAU/master-prompt v2.md`, build
qua `npm run pine:xau2` → `pine/dist/TM XAU Signals 2.pine` (`overlay = false`, nên
mọi hình vẽ trên giá đều có `force_overlay = true`). Các chương v2 §5–9 (ablation,
backtest, statistical validation, feature selection, AI) thuộc engine side, không
đặt trong Pine. Khác biệt chính so với bản v1:

| Chương v2 | Cài đặt trong `parts-xau2` |
|---|---|
| §1 Price Action | UDT `X2Event {kind, dir, srcBar, srcTime, tf, confirmed, level}` + buffer 50 sự kiện; BOS/CHoCH/**MSS** (break + displacement), **Retest**, **Failed Breakout**, **Continuation**, **Pullback** — mỗi loại có toggle riêng |
| §2 Indicators | `ta.macd` + `ta.dmi` (ADX) + `ta.bb` (BBW) + `ta.vwap` + RelVol + OBV (tính thủ công — `ta.obv` không có trong Pine v6); nhóm correlated được **average** bên trong (`(RSI+MACD+DMI)/3`, `(RelVol+OBV+VSA)/3`) |
| §3 Liquidity | PDH/PDL, PWH/PWL, Session Hi/Lo, Equal Hi/Lo, Sweep, **Trendline 2 pivot** (slope + touch tolerance), **S/R zones + FVG + Order Block** — 8 toggle `x2_liq_*` / `x2_fvg_*` / `x2_ob_*` / `x2_sr_*` |
| §4 Timeframes | Context TF (`240`/`D`/`W`/`M`) + Setup TF (`15`/`60`), `request.security [1] + lookahead_on`; **HTF VETO** — tín hiệu ngược Context bị chặn thẳng (`x2_htfVeto → x2_okFilter`), không “lén” override |
| Scoring | 11 nhóm trọng số (`x2_w_*`, tổng 100) + 5 ngưỡng quality; dashboard 2×23 đủ mọi chỉ số |
| Alerts | Payload webhook có `action: ENTRY/TAKE_PROFIT/STOP_LOSS/EVENT` — event kèm `kind/dir/ts/tf/confirmed/level` |

Guard: `tools/smoke.mjs` có ~29 assertion riêng cho `xau2` (UDT field đủ, event kinds,
indicators có đủ, veto bắt đúng form, pivot 2–3 tham số, dashboard `2, 23` +
`table.clear(… 1, 22)`, `force_overlay ≥ 20`).

## 5. Signal Engine — giao thức chuẩn hoá

Mỗi module tín hiệu là một khối `if` trả về **score số thực trong [-1, +1]**:

- `+1` — tín hiệu tốt, hướng tăng
- `0.5` — tín hiệu yếu
- `0` — trung lập / module không kích hoạt
- `-1` — tín hiệu tốt, hướng giảm

```pine
// Ưu chuẩn bắt buộc cho mọi module
//   đầu vào: bar hiện tại (đã xử lý repaint ở tầng state)
//   đầu ra : tm_m_<name> (float [-1,1]), tm_m_<name>_on (bool)
```

Tổng hợp có trọng số:

```
tm_raw   = Σ (score_i × weight_i) / Σ (weight_i của module đang bật)
tm_score = clamp(tm_raw, -1, 1)
```

Tín hiệu phát khi `tm_score` chạm ngưỡng `tm_confMin` **và** vượt qua tất cả filter.

### 5.1. Danh sách module (mở rộng được)

| # | Tên | Bật mặc định | Nguyên lý |
|---|---|---|---|
| 1 | `trendFlip` | ✅ | Supertrend lật hướng — nền tảng, ổn định nhất |
| 2 | `divergence` | ✅ | Phân kỳ RSI/MACD tại pivot |
| 3 | `bollingerRev` | ✅ | Đóng ngoài band 2.0 + nến từ chối |
| 4 | `priceAction` | ✅ | Pin bar / engulfing tại vùng cấu trúc |
| 5 | `emaCross` | ✅ | EMA nhanh cắt EMA chậm |
| 6 | `volProfile` | ❌ (chờ) | Vùng giá trị cao — để trục cho module sau |

Thêm module mới = thêm 1 khối vào `30_signal.pine` + 3 input trong `10_config.pine`.
Không cần sửa `40_risk`, `60_viz`, `70_alerts`.

## 6. Risk Engine

### 6.1. SL — thang ưu tiên (lấy giá trị chặn trên/dưới)

1. **Cấu trúc**: `swingLow` gần nhất (hoặc `swingHigh` cho SELL), cộng `slPadPct`.
2. **ATR**: `atr × slAtrMult`.
3. **Kẹp (clamp)**: giới hạn trong `[0.5×atr, maxAtrClamp×atr]`.

Hệ số pha trộn: nếu module cấu trúc bật và swing hợp lệ → dùng swing,
nhưng vẫn bị clamp bởi ATR để tránh SL quá xa khi thị trường trending mạnh.

### 6.2. TP — thang nhiều tầng theo R

```
rRisk = |entry - sl|
tp1 = entry ± rRisk × rr1      (đóng 30%)
tp2 = entry ± rRisk × rr2      (đóng 40%)
tp3 = entry ± rRisk × rr3      (đóng 30%, phần dư chạy trailing)
```

Input cho phép chuyển `mode = simple` (1 TP) ↔ `ladder` (3 TP).
Guard: nếu `rRisk == 0` hoặc TP nằm sai hướng → không phát tín hiệu.

### 6.3. Quản lý vị thế

- **Breakeven**: khi giá đạt `beAtR` (mặc định 1R) → SL về entry + phí.
- **Trailing**: sau khi đạt `trailStartR`, SL bám theo `trailAtrMult × atr` hoặc swing.
- **Timeout**: đóng vị thế sau `maxHoldBars` nếu chưa chạm TP cuối.

## 7. Chống repaint

| Chế độ | Điều kiện | Hành vi |
|---|---|---|
| `confirm` (mặc định) | `barstate.isconfirmed` | Chỉ phát tín hiệu khi nến đóng. Không repait, chậm hơn |
| `realtime` | luôn | Phát ngay trên nến đang chạy; marker vẽ **màu mờ/nét đứt** để cảnh báo "chưa xác nhận" |

Bật/tắt bằng input `tm_confirmOnly`. Nếu `realtime`, mọi box TP/SL cũng bị ghi đè mỗi tick
nên người dùng không bị hiểu nhầm là giá đã chốt.

## 8. Giao thức cảnh báo

4 `alertcondition()` cho UI của TradingView:

| Tên | Điều kiện |
|---|---|
| `tm_BUY` | Tín hiệu BUY mới |
| `tm_SELL` | Tín hiệu SELL mới |
| `tm_TP` | Giá chạm bất kỳ TP nào của vị thế đang mở |
| `tm_SL` | Giá chạm SL |

`alert()` với payload JSON cho webhook — xem `docs/alert-schema.md`.

## 9. Quy trình phát triển

```bash
node tools/build.mjs          # ghép parts* + shared → dist, in cảnh báo token
node tools/build.mjs --watch  # tự build lại khi parts/shared thay đổi
node tools/build.mjs vsa      # chỉ build một target (indicator | strategy | vsa)
```

Sau đó dán nội dung `pine/dist/TM Signals BTC.pine` vào Pine Editor → Add to chart.
`TM Backtest BTC.pine` dùng cho Strategy Tester, tách phần `60_viz.pine` bằng `// @part skip:strategy`.
`TM VSA Wyckoff.pine` là indicator volume (overlay = false), dán độc lập — xem `docs/vsa-wyckoff-method.md`.

Quy trình chuẩn khi đổi logic:

1. Sửa **chỉ trong `pine/parts/`** (bản TM) hoặc **`pine/parts-vsa/`** (bản VSA) — không sửa `pine/dist/`.
2. `node tools/build.mjs`.
3. Dán lại vào TradingView, kiểm tra không lỗi biên dịch.
4. Nếu đổi logic tín hiệu → chạy lại `TM Backtest BTC.pine` để xem winrate/RR có còn chấp nhận được không.

## 10. Lộ trình

- **Giai đoạn 1 (đang làm)** — 5 module tín hiệu, ATR risk, 2 chế độ repaint, dashboard, webhook.
- **Giai đoạn 2** — bộ lọc theo phiên/ngày, đếm lệnh trong ngày, cảnh báo trùng lặp.
- **Giai đoạn 3** — module `volProfile`, điểm POI (order block / FVG), quản lý nhiều vị thế.
- **Giai đoạn 4** — thống kê thắng/thua theo module (đánh giá từng module có đáng bật không).
- **Giai đoạn 5** — bộ lọc Pine Screener, xuất CSV để phân tích ngoài.
