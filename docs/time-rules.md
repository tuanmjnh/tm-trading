# Quy tắc thời gian — D2

> **Trạng thái:** Phase 3 — đã cài và có test (`engine/test-db.mjs` §8, `engine/test.mjs` §9).
> Đây là **hợp đồng**, không phải gợi ý: mọi tầng lưu/đọc thời gian phải tuân đúng luật này.

## 1. Ba luật

| # | Luật | Vì sao |
|---|---|---|
| **T1** | Mọi thời gian **lưu UTC milliseconds** (Mongo: `Date`; NDJSON: chuỗi ISO-8601 kết thúc bằng `Z`) | Máy chạy ở tz nào cũng ra cùng dữ liệu. Lưu offset cục bộ (`2026-10-01T10:17:21+07:00`) là nguồn lỗi im lặng khi đổi máy / đổi `TZ` |
| **T2** | **Ngày nghiệp vụ = chuỗi `YYYY-MM-DD` theo UTC**, không phải `Date`, không phải local midnight | Khóa ngày phải tường minh. `risk_state` unique theo `(account, utcDay)` — nếu mỗi máy tự tính "hôm nay" thì mỗi máy một bản ghi |
| **T3** | **So sánh phiên/session quy đổi tz tường minh** (truyền tz vào, không đọc `Date` ngầm) | `09:00 VN` là phiên Á nhưng `09:00 UTC` là phiên Mỹ. Hàm session phải nhận mốc + tz, không tự suy từ máy chạy |

## 2. Định dạng chấp nhận ở biên (input)

- **Nhận**: ISO-8601 có timezone rõ ràng — `2026-10-01T03:17:21Z` hoặc `...+07:00`.
- **Chấp nhận cả chuỗi thiếu offset** (TradingView luôn gửi `Z`) nhưng **lập tức** quy đổi
  sang UTC ngay khi parse — không giữ nguyên offset vào storage.
- **Từ chối** (`422` / ném lỗi) với chuỗi không parse được. Webhook đã bắt đúng trường này
  trong `validate()`; `alertKey()` cũng **ném lỗi** thay vì sinh khóa rác khi `ts` hỏng.

```js
// server/webhook.mjs — validate()
if (typeof o.ts !== 'string' || Number.isNaN(Date.parse(o.ts))) return err('ts khong hop le ...')
```

## 3. Định dạng xuất ra (output)

- NDJSON: `new Date(...).toISOString()` → luôn `...Z` (`engine/store.mjs` ghi `createdAt` kiểu này).
- Mongo: kiểu `Date` (driver tự lưu UTC ms) — **không** lưu chuỗi đã format, **không** lưu offset.
- Console/dashboard: hiển thị có thể đổi tz (ghi rõ `UTC` hoặc `VN`), nhưng **không** ghi
  ngược giá trị hiển thị vào storage.

## 4. Ngày UTC — ranh giới

```
2026-10-01T23:59:00Z  →  utcDay = "2026-10-01"
2026-10-02T00:01:00Z  →  utcDay = "2026-10-02"   ← ngày khác, dù chỉ lệch 2 phút
```

Ranh giới là **00:00 UTC**, bất kể máy chạy ở tz nào. Cách tính chuẩn:

```js
new Date(ts).toISOString().slice(0, 10)   // 'YYYY-MM-DD' theo UTC
```

Không dùng `toLocaleDateString()`, không dùng `Date#getDate()` — hai hàm đó theo **local**.

> Chú ý trung thực: "ngày giao dịch" của crypto là UTC (24/7). Nếu sau này cần ranh giới
> phiên nhất định (ví dụ ngày theo giờ broker cho XAU), đó là **hợp đồng mới** phải ghi vào
> tài liệu này — không được âm thầm đổi `utcDay` sang local, vì `risk_state` đang unique
> theo nó.

## 5. Tính năng thời gian trong engine

| Nơi | Quy tắc | Code |
|---|---|---|
| `alert.ts` | `Date` UTC, đọc ra `toISOString()` y hệt giá trị gửi lên | `server/webhook.mjs` → `toAlertDoc()` |
| `risk_state.utcDay` | chuỗi `YYYY-MM-DD` UTC, unique `(account, utcDay)` | `engine/models/riskState.mjs` |
| `runs.createdAt`, `trades.entryTime/exitTime` | `Date` UTC | `engine/models/*.mjs` |
| NDJSON `createdAt` | ISO-8601 `Z` | `engine/store.mjs` → `withStamp()` |
| session/bucket (Pine parity) | hàm **nhận tz tường minh**, không đọc `TZ` ngầm | `engine/ta.mjs` |

## 6. Kiểm thử

`engine/test-db.mjs` §8 (cần Mongo) và `engine/test.mjs` §9 khoá các điều sau:

- `alert.ts` lưu là `Date`, đọc ra vẫn là UTC đúng, **không lệch** do tz của máy chạy;
- `toISOString()` luôn kết thúc bằng `Z`;
- `utcDay` 23:59 UTC vs 00:01 UTC rơi vào **hai ngày khác nhau**;
- `store.createdAt` là ISO `Z`.

Test cố ý chạy không phụ thuộc `TZ` của máy — nếu có ai đó vô tình đổi sang local
time thì §8 đỏ ngay.
