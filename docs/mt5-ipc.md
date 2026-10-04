# Hợp đồng IPC — MT5 bridge (Phase 12)

> **Trạng thái:** chốt sớm theo roadmap Phase 3 (mục *"Hợp đồng IPC cho MT5 — chốt sớm để
> Phase 12 không tự nghĩ"*). **Chưa có code chạy**; tài liệu này là khung bắt buộc để Phase 12
> không phải tự sáng tạo ra hợp đồng giữa chừng. Sửa hợp đồng = sửa tài liệu này **trước**,
> rồi mới sửa code.

## 1. Kiến trúc

Chọn phương án **A** (khuyến nghị trong roadmap): micro-service **Python** chạy cạnh MT5
chỉ Windows, dùng lib official `MetaTrader5`; Node giữ phần còn lại.

```
Node (engine/exec)  ──HTTP JSON──►  Python bridge (localhost)  ──MetaTrader5 lib──►  MT5 terminal
        │                                    │
        └────────── NDJSON log ──────────────┘
```

- **Transport: HTTP/1.1 trên loopback** (`127.0.0.1`), body JSON. Không mở cổng ra ngoài.
  Lý do: cùng định dạng với webhook hiện có, debug được bằng `curl`, không cần thêm protocol.
- **Mọi request đều mang `Idempotency-Key`** = `clientOrderId` (`engine/keys.mjs`) —
  tầng lệnh không được phụ thuộc việc tầng alert khử trùng đúng (D3).

## 2. Endpoint

Base: `http://127.0.0.1:8790` (8787 = webhook, 8790 = bridge — mỗi service một cổng).

| Method | Path | Vai trò | Idempotent? |
|---|---|---|---|
| `GET` | `/health` | Sống/chết + trạng thái MT5 + tài khoản | có |
| `GET` | `/account` | balance / equity / margin / currency | có |
| `GET` | `/positions` | vị thế đang mở | có |
| `POST` | `/order` | đặt lệnh (market/pending) | **bắt buộc** theo `Idempotency-Key` |
| `POST` | `/order/close` | đóng lệnh theo `ticket` | có (đóng lệnh đã đóng = ok) |
| `POST` | `/order/modify` | sửa SL/TP theo `ticket` | có |
| `GET` | `/history` | lịch sử lệnh (phục vụ sync `positions`) | có |

Mọi response: `200` + JSON, hoặc `4xx/5xx` + `{"ok":false,"error":"..."}`.
**Không trả HTML.** Không endpoint nào ghi file, không endpoint nào nhận lệnh "thử nghiệm"
khác `/order` — cổng duy nhất đặt lệnh là `/order` (dẫn xuất của D7: một cổng cho mọi lệnh).

### 2.1 `POST /order`

Request:

```json
{
  "Idempotency-Key": "tm-1a2b3c4d5e6f7a8b9c0d1e2f-0",
  "symbol": "XAUUSD",
  "side": "BUY",
  "type": "market",
  "qty": 0.1,
  "sl": 2318.40,
  "tp": 2364.10,
  "comment": "tm:sv:2026-10-02",
  "clientOrderId": "tm-1a2b3c4d5e6f7a8b9c0d1e2f-0"
}
```

| Trường | Bắt buộc | Ghi chú |
|---|---|---|
| `Idempotency-Key` | **có** | = `clientOrderId`, ≤ 31 ký tự `[A-Za-z0-9_-]`. Trùng → **trả về kết quả của lần đầu**, không đặt lại |
| `symbol` | có | theo tên broker (`XAUUSD`, không phải `XAUUSDT`) |
| `side` | có | `BUY` · `SELL` |
| `type` | có | `market` · `pending` |
| `qty` | có | > 0; bridge tự đối chiếu `MODE_VOLUME_MIN/MAX/STEP` |
| `sl` / `tp` | có (`sl` luôn) | unit = giá; bridge tự đối chiếu `MODE_STOPLEVEL` |
| `comment` | không | ≤ 31 ký tự, MT5 cho phép; dùng tag method/regime cho journal |

Response `200` (đặt thành công **hoặc** đã đặt ở lần trước):

```json
{ "ok": true, "ticket": 40311842, "clientOrderId": "tm-...-0", "duplicate": false, "filled": { "price": 2341.25, "qty": 0.1 } }
```

Response `409` — xung đột idempotency (cùng key, payload **khác**):

```json
{ "ok": false, "error": "idempotency-key trung nhung payload khac", "original": { "ticket": 40311842 } }
```

### 2.2 `GET /health`

```json
{ "ok": true, "mt5": { "connected": true, "terminal": "MetaTrader 5", "account": 12345678, "company": "..." }, "uptime": 3612 }
```

`connected: false` → Node **không** retry đặt lệnh, chỉ báo `degraded` (fail-soft như `engine/db.mjs`).

## 3. Timeout

| Hành động | Timeout | Qua hạn thì sao |
|---|---|---|
| `GET /health`, `/account`, `/positions`, `/history` | **2 s** | bỏ qua lần này, giữ giá trị cũ; không retry trong cùng request |
| `POST /order` | **10 s** | **KHÔNG** coi là thất bại — rơi vào trạng thái `unknown` (xem §4) |
| `POST /order/close`, `/order/modify` | **10 s** | như trên |

Không endpoint nào để timeout > 10 s: MT5 terminal treo thì caller phải sớm biết để chuyển
sang paper / degraded thay vì treo pipeline.

## 4. Retry & trạng thái `unknown` (quan trọng nhất)

`/order` là **không idempotent theo bản chất** (kết nối chết giữa chừng thì không biết lệnh
có vào không). Luật:

1. **Trước khi gửi**: ghi bản ghi `pending` + `clientOrderId` vào NDJSON/`positions`.
2. **Gửi kèm `Idempotency-Key`** — nếu bridge đã nhận key này thì nó trả về ticket cũ
   (`duplicate: true`), **không đặt thêm**.
3. **Timeout / connection reset** → trạng thái **`unknown`**, **không** retry tự động ngay.
4. **Thoả mãn `unknown` = tra cứu**, không retry mù:
   - `GET /positions` (hoặc `/history`) tìm theo `comment`/`ticket` → thấy thì ghi `open`, `ok`;
   - không thấy **và** quá `RECONCILE_AFTER` (mặc định **30 s**) → mới gửi lại với
     **cùng** `Idempotency-Key`.
5. **Không bao giờ** đổi `Idempotency-Key` khi retry. Đổi key = có thể đặt 2 lệnh thật.

Lý do khóa bất biến: `clientOrderId` sinh từ `alertKey` + `seq` — cùng alert, cùng thứ tự
luôn ra cùng khóa, nên retry an toàn về mặt toán học (D3).

Retry policy cho endpoint **idempotent** (`GET`): tối đa **2 lần**, backoff `200 ms → 1 s`,
chỉ retry khi lỗi kết nối (không retry `4xx`).

## 5. Đồng bộ vị thế

- Bridge là **nguồn chân lý** về "đang giữ gì" trên MT5.
- Node poll `GET /positions` mỗi **5 s** (khi Phase 12 bật) → ghi collection `positions`
  với `source: 'mt5'`, `externalId = ticket` (unique sparse đã có sẵn trong data-model §3).
- Một chiều: Node **không** tự sửa `positions` của MT5; mọi thay đổi phải qua
  `/order/modify` hoặc `/order/close` rồi poll phản ánh lại.

## 6. An toàn

- Bind **chỉ** `127.0.0.1`; có token `MT5_BRIDGE_TOKEN` (header `Authorization: Bearer`)
  — fail-closed như webhook (`TM_TOKEN`).
- **Demo trước, real sau** (roadmap Phase 12): bridge ghi `account_type` trong `/health`;
  Node từ chối gửi lệnh nếu `account_type !== 'demo'` khi còn ở phase paper/demo.
- Lệnh thật **luôn** qua risk gate trước (D7) — bridge không biết gì về risk, nó chỉ thi hành.

## 7. Checkpoint khi bắt đầu Phase 12

- [ ] Tạo `exec/mt5/server.py` + `exec/mt5/client.mjs` đúng endpoint ở §2
- [ ] Test idempotency: gửi `/order` 2 lần cùng key → đúng 1 ticket
- [ ] Test timeout: kill MT5 giữa chừng → trạng thái `unknown` được tra soát, không đặt 2 lần
- [ ] `/health` xuất hiện trong `/health` tổng của Node (D9)
