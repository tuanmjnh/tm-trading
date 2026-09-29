# Alert schema — payload webhook

TradingView gửi POST body dạng **text/plain** chứa đúng 1 chuỗi JSON.
Endpoint phải trả HTTP `200` với body `{"ok":true}` — trả lỗi 4xx/5xx thì TradingView retry.

## Cấu trúc chung

| Trường | Kiểu | Ý nghĩa |
|---|---|---|
| `v` | number | Phiên bản schema (hiện = `1`) |
| `ts` | string | ISO-8601 UTC, ví dụ `2026-09-29T03:17:21Z` |
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
3. **Chống trùng**: TradingView có thể gửi lại cùng 1 payload. Receiver nên khửa trùng
   theo cặp `(ts, action, side, price)` trong cửa sổ 60 giây.
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
