# TM Trading

Bộ chỉ báo TradingView (Pine Script **v6**) phát tín hiệu **đảo chiều BUY/SELL** kèm
**vùng TP / SL** cụ thể, và gửi thông báo tự động qua webhook.

```
tm-trading/
├─ docs/
│  ├─ architecture.md      kiến trúc, luồng dữ liệu, quy ước mở rộng
│  └─ alert-schema.md      đặc tả payload JSON
├─ pine/
│  ├─ parts/*.pine         ← SỬA Ở ĐÂY (nguồn duy nhất)
│  └─ dist/*.pine          ← output, dán vào TradingView
├─ tools/
│  ├─ build.mjs            ghép parts → dist + lint
│  ├─ copy.mjs             copy dist vào clipboard
│  ├─ smoke.mjs            test không cần framework
│  └─ notify/server.mjs    webhook receiver (Telegram / Discord)
└─ package.json
```

## 1. Cài đặt & chạy

Không có dependency nào — chỉ cần Node.js ≥ 18.

```bash
npm run build          # ghép pine/parts -> pine/dist
npm test               # smoke test (43 assertions)
npm run verify         # build + test
```

| Script | Việc |
|---|---|
| `npm run build` | Build cả indicator + strategy |
| `npm run watch` | Tự build lại mỗi khi `pine/parts/` đổi |
| `npm run signal` | Chỉ build bản indicator |
| `npm run backtest` | Chỉ build bản strategy |
| `npm run copy` | Build rồi copy `tm-signals.pine` vào clipboard |
| `npm run copy:backtest` | Copy `tm-backtest.pine` vào clipboard |
| `npm run notify` | Chạy webhook receiver |
| `npm test` | Chạy smoke test |
| `npm run verify` | `build` + `test` |
| `npm run clean` | Xoá `pine/dist/` và `logs/` |

> `npm run build` trả exit code **2** nếu có cảnh báo lint — dùng được trong CI.

Pine không có `#include`, nên logic được viết tách file ở `pine/parts/` và
`build.mjs` ghép lại thành một script duy nhất. **Đừng sửa trực tiếp trong `pine/dist/`.**

## 2. Cài lên TradingView

Cách nhanh nhất:

```bash
npm run copy        # build + copy san vao clipboard
```

Rồi mở Pine Editor → `Ctrl+V` → **Add to chart**.

Cách thủ công: dán toàn bộ nội dung `pine/dist/tm-signals.pine`.
`pine/dist/tm-backtest.pine` dán tương tự, mở tab **Strategy Tester** để xem winrate/RR.

Tạo alert: chọn đúng indicator → **Create Alert** → Webhook URL
`https://<domain-cua-ban>/tm-alert`, header `User-Agent: TradingView`.

### Lỗi compile hay gặp

| Mã | Nguyên nhân |
|---|---|
| `CE10271 Could not find function` | Gọi hàm Pine không tồn tại. Gặp hai lần: **`input.timezone()` không có trong Pine** — dùng `input.string()` với danh sách múi giờ (`pine/parts/10_config.pine`); và **`table.cell_clear()` không có** — tên đúng là **`table.clear(table_id, start_col, start_row, end_col, end_row)`** (`pine/parts/60_viz.pine`) |
| `CE10156 Syntax error at "]"` | Biểu thức `input.*` bị **tách nhiều dòng**. Pine cần `options` là `const string[]`; tách dòng làm parser hỏng. Giữ mỗi lệnh `input.*` trên một dòng |
| `CE10123` `expected a "simple int"` | Truyền biến **float** vào tham số *độ dài* của hàm `ta.*`. Ví dụ `ta.supertrend(factor, atrPeriod)` — `atrPeriod` phải là số nguyên, không phải `ta.atr(...)`. Tách `tm_atr` (float, cho SL) và `tm_atrST` (int, cho supertrend) |
| `CE10120` `does not have an argument with the name` | Sai **tên** tham số. Thường gặp: `table.new()` **không có** tham số `size` — cỡ bảng nằm ở `text_size` của từng `table.cell()` |
| `CE10123` `"literal string" ... but a "series int" is expected` | Sai **thứ tự** tham số. Đúng là **`str.format_time(time, format, timezone)`** — `time` (UNIX timestamp, `series int`) đứng đầu, `format` đứng sau. Viết `str.format_time("yyyy-MM-dd", time, "UTC")` là lỗi. (Nguồn: [Concepts / Time](https://www.tradingview.com/pine-script-docs/concepts/time/)) |
| `CE10271` ở `plotshape`/`plot` | Truyền tham số theo thứ tự làm giá trị rơi vào `offset` (vị trí 6). Luôn truyền bằng **tên tham số** |

`build.mjs` đã có lint tự bắt cả sáu loại lỗi này — chạy `npm run build` sẽ báo trước khi bạn dán lên TradingView.

> **Quy tắc nới `BUILTINS` (danh sách hàm Pine hợp lệ trong `tools/build.mjs`).**
> Danh sách này chỉ chứa **tên hàm**, không chứa hằng số (`color.red`, `shape.*`,
> `position.*`, `size.*`) — vì lint không bao giờ đối chiếu hằng số, đưa vào chỉ tạo
> cảm giác "đã kiểm chứng" giả tạo. Trước khi thêm một tên mới, tra tại
> <https://www.tradingview.com/pine-script-reference/v6/> rồi mới chèn. Tên chưa
> kiểm chứng hãy để ngoài danh sách để lint báo — đó chính là cơ chế bắt
> `table.cell_clear` trước khi bạn dán lên TradingView. Mọi tên đã chứng minh là sai
> nằm trong `FAKE_NAMES` của `tools/smoke.mjs`, nên không thể quay lại BUILTINS
> mà làm test hỏng.

### Chế độ repaint

| Input | Hành vi |
|---|---|
| `Chỉ tín hiệu trên nến đã đóng` = **BẬT** (mặc định) | Chỉ phát khi nến đóng. Không repait, dùng cho live |
| = **TẮT** | Phát ngay trên nến đang chạy, marker nhạt màu. Chỉ để quan sát/scan |

Khi đang ở chế độ nến đóng, nhớ chọn tần suất alert là **Once Per Bar Close**.

## 3. Tín hiệu

5 module, mỗi module trả điểm `[-1, +1]`, tổng hợp có trọng số rồi so với ngưỡng confidence:

| Module | Nguyên lý |
|---|---|
| M1 Trend flip | Supertrend lật hướng |
| M2 RSI divergence | Phân kỳ RSI tại hai pivot gần nhất |
| M3 Bollinger reversion | Chạm band ngoài rồi đóng ngược lại |
| M4 Price action | Engulfing + pin bar |
| M5 EMA cross | EMA nhanh cắt EMA chậm |

Bộ lọc: xu hướng timeframe cao, phiên giao dịch, biến động tối thiểu, số lệnh/ngày,
khoảng cách nến giữa hai lệnh, RR tối thiểu.

## 4. TP / SL

SL = trộn giữa **swing structure** và **ATR**, sau đó kẹp trong khoảng `[minATR, maxATR]`.
TP chia thang R (`TP1 / TP2 / TP3`), kèm **breakeven** và **trailing stop**.
Chuyển `Cách tinh TP` sang `Simple` nếu chỉ cần 1 mục tiêu.

Ghi chú: khi một nến chạm cả TP lẫn SL, engine giả định **SL xảy ra trước** — thi lanh,
vì OHLC không cho biết thứ tự high/low.

## 5. Webhook

```bash
cp .env.example .env      # điền TM_TOKEN / TELEGRAM_TOKEN / TELEGRAM_CHAT_ID / DISCORD_WEBHOOK
npm run notify
```

**Bắt buộc: token trong URL.** TradingView chỉ gửi được URL + JSON body, không gửi
được header tùy ý, nên `TM_TOKEN` phải nằm trong URL khi tạo alert:

```
http://<địa-chi-của-bạn>:8787/tm-alert/<TM_TOKEN>
```

Server in sẵn URL này khi khởi động. Không cài `TM_TOKEN` thì `/tm-alert` trả
**401 cho mọi request** (fail-closed) — không có chuyện bỏ qua xác thực.

Ngoài ra còn nhận token qua `?token=`, `Authorization: Bearer` hoặc `X-TM-Token`
(dành cho test/script). `User-Agent: TradingView` **không** được dùng làm xác thực
— nó giả mạo được.

Server lưu mọi alert vào `logs/alerts.ndjson`, chống gửi trùng trong 60 giây và
từ chối payload sai logic (SL sai phía so với giá vào lệnh).
Chi tiết payload: [`docs/alert-schema.md`](docs/alert-schema.md).

## 6. Thêm module tín hiệu mới

1. Thêm 3 input trong `pine/parts/10_config.pine`.
2. Thêm khối tính điểm trong `pine/parts/30_signal.pine` và 1 dòng vào tổng `tm_wTotal` / `tm_wSum`.
3. `npm run verify`.

Không cần sửa `40_risk`, `50_state`, `60_viz`, `70_alerts`.

## 7. Cảnh báo

- Mặc định là bộ công cụ **sinh tín hiệu**, không phải lời khuyên đầu tư.
- Dùng **strategy** để kiểm chứng winrate trước khi để tiền thật.
- Backtest không tính spread/slippage/thuế — kết quả thực tế luôn kém hơn.
