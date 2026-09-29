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
│  ├─ parts/               ← SOURCE OF TRUTH (sửa ở đây, không sửa dist/)
│  │  ├─ 00_header.pine    ← @version, indicator()/strategy() declaration
│  │  ├─ 10_config.pine    ← toàn bộ input.* (nhóm: chung, module, filter, risk, hiển thị)
│  │  ├─ 20_core.pine      ← tiện ích chung, ATR, swing/pivot, đoạn session
│  │  ├─ 30_signal.pine    ← signal engine: mỗi module trả score ∈ [-1, +1]
│  │  ├─ 40_risk.pine      ← risk engine: entry/SL/TP1-3/partial/trailing
│  │  ├─ 50_state.pine     ← máy trạng thái vị thế + repaint + cooldown
│  │  ├─ 60_viz.pine       ← vẽ marker, box TP/SL, label, dashboard
│  │  └─ 70_alerts.pine    ← alertcondition + alert() JSON payload
│  └─ dist/                ← OUTPUT của build tool (dán vào TradingView)
│     ├─ tm-signals.pine
│     └─ tm-backtest.pine
├─ tools/
│  ├─ build.mjs            ← assembler: parts/*.pine → dist/*.pine
│  └─ notify/
│     └─ server.mjs        ← webhook receiver (Node, không dependency)
└─ README.md
```

**Quy tắc số tiền tố file = thứ tự ghép.** `00` → `70`. Bộ lọc comment `// @part` cho phép
build tool bỏ qua hoặc thay thế khối khi sinh `strategy()` so với `indicator()`.

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
node tools/build.mjs          # ghép parts → dist, in cảnh báo token
node tools/build.mjs --watch  # tự build lại khi parts thay đổi
```

Sau đó dán nội dung `pine/dist/tm-signals.pine` vào Pine Editor → Add to chart.
`tm-backtest.pine` dùng cho Strategy Tester, tách phần `60_viz.pine` bằng `// @part skip:strategy`.

Quy trình chuẩn khi đổi logic:

1. Sửa **chỉ trong `pine/parts/`**.
2. `node tools/build.mjs`.
3. Dán lại vào TradingView, kiểm tra không lỗi biên dịch.
4. Nếu đổi logic tín hiệu → chạy lại `tm-backtest.pine` để xem winrate/RR có còn chấp nhận được không.

## 10. Lộ trình

- **Giai đoạn 1 (đang làm)** — 5 module tín hiệu, ATR risk, 2 chế độ repaint, dashboard, webhook.
- **Giai đoạn 2** — bộ lọc theo phiên/ngày, đếm lệnh trong ngày, cảnh báo trùng lặp.
- **Giai đoạn 3** — module `volProfile`, điểm POI (order block / FVG), quản lý nhiều vị thế.
- **Giai đoạn 4** — thống kê thắng/thua theo module (đánh giá từng module có đáng bật không).
- **Giai đoạn 5** — bộ lọc Pine Screener, xuất CSV để phân tích ngoài.
