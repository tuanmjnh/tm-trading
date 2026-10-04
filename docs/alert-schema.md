# Alert schema — payload webhook

TradingView gửi POST body dạng **text/plain** chứa đúng 1 chuỗi JSON.
Endpoint phải trả HTTP `200` với body `{"ok":true}` — trả lỗi 4xx/5xx thì TradingView retry.

## Cấu trúc chung

| Trường | Kiểu | Ý nghĩa |
|---|---|---|
| `v` | number | Phiên bản schema (hiện = `1`) — xem **Luật bump `v`** bên dưới |
| `ts` | string | ISO-8601 UTC, ví dụ `2026-09-29T03:17:21Z` — **bắt buộc**, là trường định danh khi khử trùng |
| `source` | string | Nguồn alert: `tradingview` (mặc định) · `scanner` · `ai` — optional, `[A-Za-z0-9_-]{1,32}` |
| `symbol` | string | Mã giao dịch, dấu `\` đã đổi thành `/` |
| `tf` | string | Timeframe chart, ví dụ `15`, `60`, `1D` |
| `mode` | string | `closed` = chỉ tính nến đã đóng · `live` = realtime (có repaint) |
| `action` | string | `ENTRY` · `TAKE_PROFIT` · `STOP_LOSS` · `TIME_CLOSE` |
| `level` | number | Chỉ có ở `TAKE_PROFIT` (1/2/3) và `STOP_LOSS` (1) |
| `side` | string | `BUY` · `SELL` |
| `price` | number | Giá vào lệnh |
| `sl` | number | Stop loss hiện tại (đã tính cả breakeven/trailing) |
| `tps` | number[] | Mảng TP, luôn ≥ 1 phần tử |
| `atr` | number | ATR(14) tại thời điểm phát — bỏ ở chế độ `Slim` |
| `conf` | number | 0..1, confidence của tín hiệu — bỏ ở chế độ `Slim` |
| `event` | string | **Optional** — sự kiện VSA gốc (`SV`/`BC`/`ST LONG`/`ST SHORT`/`NS`/`ND`/`EoM`) để dịch sang `signals`. Thiếu/sai giá trị → receiver suy từ `side` (`BUY`→`ST LONG`, `SELL`→`ST SHORT`). Thêm field optional, receiver cũ bỏ qua được → **không bump `v`** |

## Luật bump `v`

`v` là **phiên bản hợp đồng**, không phải version của app. Receiver kiểm tra chặt: `validate()`
chỉ nhận đúng `v === 1` (`server/webhook.mjs`) — khác thì trả `422` và **không** ghi gì.

| Thay đổi | Bump `v`? | Lý do |
|---|---|---|
| Thêm field **optional**, receiver cũ bỏ qua được | **Không** | Backward compatible; giữ `v: 1` để alert đang chạy không hỏng |
| Thêm field **bắt buộc**, đổi kiểu, đổi tên, đổi nghĩa giá trị | **Có** → `v: 2` | Receiver cũ sẽ hiểu sai hoặc bỏ sót → phải chặn rõ ràng thay vì đoán |
| Sửa cách tính dedupe (`alertKey`) | **Không** (xem mục 3) | Khóa sinh từ payload, đổi canon = đổi khóa; không liên quan `v` |

Quy tắc kèm theo:

1. **Không bao giờ đổi nghĩa của field đã có** dưới cùng `v`. Muốn đổi → bump `v` rồi giữ field
   cũ viết `deprecated` trong tài liệu này cho tới khi hết alert đang chạy.
2. Receiver **phải** trả lỗi rõ ràng cho `v` lạ (`schema version khong ho tro: 2`), không im lặng
   drop — TradingView sẽ hiện HTTP 422 trong lịch sử alert để người tạo alert biết cần cập nhật.
3. Một lần bump = sửa **cùng lúc** 3 nơi: bảng này, `validate()` trong `server/webhook.mjs`,
   và smoke test case `schema version sai -> tu choi` (`tools/smoke.mjs`).

## `source` — nguồn thứ hai

TradingView **không gửi được header tùy ý** nên `source` nằm trong JSON body.

- Thiếu / rỗng → receiver gán `tradingview` (mặc định, mọi alert hiện tại đều là dạng này).
- Có giá trị → phải khớp `/^[A-Za-z0-9_-]{1,32}/`, sai là **422** (không nhận bừa chuỗi rác làm khóa).
- `source` **tham gia `alertKey`**: cùng `ts/symbol/action/...` nhưng khác nguồn → khóa khác →
  **không chặn nhầm**. Phase 8 (scanner) và Phase 11 (AI) gửi alert của chính nó mà không làm
  mất alert TradingView tương ứng.

## Ví dụ

### ENTRY

```json
{
  "v": 1,
  "ts": "2026-09-29T03:17:21Z",
  "symbol": "BTCUSDT",
  "tf": "15",
  "mode": "closed",
  "action": "ENTRY",
  "side": "BUY",
  "price": 63250.5,
  "sl": 63012.1,
  "tps": [63655.0, 64000.0, 64350.0],
  "atr": 238.4,
  "conf": 0.72
}
```

### TAKE_PROFIT (đóng partial)

```json
{
  "v": 1,
  "ts": "2026-09-29T04:05:11Z",
  "symbol": "BTCUSDT",
  "tf": "15",
  "mode": "closed",
  "action": "TAKE_PROFIT",
  "level": 1,
  "side": "BUY",
  "price": 63250.5,
  "sl": 63262.4,
  "tps": [63655.0, 64000.0, 64350.0],
  "atr": 240.1,
  "conf": 0.72
}
```

### STOP_LOSS

```json
{
  "v": 1,
  "ts": "2026-09-29T03:58:02Z",
  "symbol": "BTCUSDT",
  "tf": "15",
  "mode": "closed",
  "action": "STOP_LOSS",
  "level": 1,
  "side": "SELL",
  "price": 62990.0,
  "sl": 63180.5,
  "tps": [62750.0],
  "atr": 238.4,
  "conf": 0.61
}
```

### TIME_CLOSE (hết `maxHoldBars`)

Giống ENTRY nhưng `action: "TIME_CLOSE"`, `level` không có.

## Ghi chú vận hành

1. **Giới hạn 4096 ký tự** của TradingView. Payload đầy đủ ~250 ký tự nên an toàn;
   nếu thêm module mới làm payload phình, chuyển `Độ dài payload webhook` sang `Slim`.
2. **Tần suất alert**: khi tạo alert chọn `Once Per Bar Close` nếu đang ở chế độ
   `Chỉ tín hiệu trên nến đã đóng`. Ở chế độ realtime chọn `Once Per Bar`.
3. **Chống trùng**: TradingView có thể gửi lại cùng 1 payload. Receiver khử trùng bằng
   `alertKey` (`engine/keys.mjs`) + **unique index** trên collection `alerts` — không còn
   dựa vào cửa sổ 60 giây trong RAM. Khóa gồm
   `(source, symbol, tf, ts, action, side, price, level, mode)`:
   - cùng payload (retry sau restart) → cùng khóa → bị chặn;
   - **TP1 vs TP2 cùng bar** có `ts/action/side/price` y hệt → khác `level` → **khác khóa**
     (nếu bỏ `level`, alert thứ hai bị coi là retry và **mất**);
   - chart `live` vs `closed` cùng bar → khác `mode` → không chặn nhau;
   - nguồn khác → khác `source` → không chặn nhau.
4. **`tps` đã qua**: sau khi chạm TP1, `tps` vẫn gửi cả 3 mức — receiver tự biết mức nào
   chưa chạm qua `level`. Không tự cắt bởi vì khi BE/trailing đẩy `sl` lên thì `sl`
   mới là thông tin quan trọng hơn.
5. **Kiểm tra JSON trước khi dùng**: `sl` phải nằm đúng phía so với `price`
   (`BUY` → `sl < price`, `SELL` → `sl > price`). Vi phạm là do payload bị cắt bởi TradingView.

## Kiểm thử nhanh

```bash
curl -X POST http://localhost:8787/tm-alert \
  -H 'Content-Type: text/plain' \
  -d '{"v":1,"ts":"2026-09-29T03:17:21Z","symbol":"BTCUSDT","tf":"15","mode":"closed","action":"ENTRY","side":"BUY","price":63250.5,"sl":63012.1,"tps":[63655.0],"atr":238.4,"conf":0.72}'
```
