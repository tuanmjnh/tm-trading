# Hợp đồng IPC — MT5 bridge (Phase 12)

> **Trạng thái:** chốt sớm theo roadmap Phase 3 (mục *"Hợp đồng IPC cho MT5 — chốt sớm để
> Phase 12 không tự nghĩ"*). Tài liệu này là khung bắt buộc để Phase 12 không phải tự sáng tạo
> ra hợp đồng giữa chừng. Sửa hợp đồng = sửa tài liệu này **trước**, rồi mới sửa code.
> **Phía Node đã có code chạy; phía Python chưa từng chạy** — xem *Trạng thái kiểm chứng* ngay
> dưới.

## Trạng thái kiểm chứng

- `exec/mt5/client.mjs` (transport Node): **đã kiểm chứng** — `exec/mt5/test.mjs` chạy client
  thật với một **mock bridge HTTP cục bộ** (không cần MT5, không ra mạng ngoài).
- `exec/mt5/server.py` (bridge Python, 822 dòng): **CHƯA TỪNG ĐƯỢC CHẠY**. Máy viết code
  **không có** package `MetaTrader5`, **không có** terminal MT5, và sandbox build **chặn spawn
  tiến trình**; thứ duy nhất đã qua là `py_compile` (cú pháp). ⇒ **Không** phần nào của tài liệu
  này được bảo chứng bởi phía Python, và tài liệu **không** được đọc như thể phía Python đã chạy
  thật.
- Các quyết định ở §2.1, §2.2, §3, §4, §6 dưới đây là **hợp đồng chốt trước**, không phải mô tả
  hành vi đã đo. Chỗ nào code hiện tại lệch hợp đồng thì **code phải sửa** (việc riêng, không
  thuộc tài liệu này), không phải hạ thấp hợp đồng cho khớp code.

**Lệch đã biết giữa code hiện tại và hợp đồng (chưa sửa — việc riêng cho bước code):**

1. `client.mjs` gửi `Idempotency-Key` **trong body**, **không** set header HTTP (dù comment
   trong file nói "header") → trái §2.1 (header là nguồn chân lý).
2. `server.py` (`/order`) đọc key **chỉ từ body** (`payload.get("Idempotency-Key") or
   payload.get("clientOrderId")`), **không** đọc header `Idempotency-Key` → trái §2.1.
3. `client.mjs` `getAccount()` mặc định `retry = true` → trái §3/§4 (`/account` phải
   **single-attempt**); phải đổi mặc định thành không retry.
4. `server.py` `position_doc()` đặt `clientOrderId` = **chuỗi ticket**, không phải key → nhánh
   tra theo `clientOrderId` ở §4.4 **không bao giờ khớp** khi chạy bridge thật; chỉ còn `comment`
   (dễ trùng) và `magic` (mà `reconcile()` chưa đối chiếu). §5 yêu cầu echo `clientOrderId`/`magic`
   = key.
5. `server.py` `/history` trả `{ok, orders, deals}` nhưng `client.mjs` `getHistory()` chỉ đọc
   mảng trần hoặc `body.history` → khi chạy bridge thật, history luôn ra rỗng.
6. `exec/mt5/test.mjs` mock mặc định **không** đòi token cho `/health` (`healthToken: ''`) → lệch
   với §6 fail-closed; không phải code sản phẩm nhưng là giả định sai trong test (client vẫn gửi
   token cho `/health`, nên chỉ cần mock thắt lại).

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
- **Mọi request đặt lệnh đều mang `Idempotency-Key`** = `clientOrderId` (`engine/keys.mjs`),
  gửi ở **header** (không phải body — xem §2.1) —
  tầng lệnh không được phụ thuộc việc tầng alert khử trùng đúng (D3).

## 2. Endpoint

Base: `http://127.0.0.1:8790` (8787 = webhook, 8790 = bridge — mỗi service một cổng).

| Method | Path | Vai trò | Idempotent? |
|---|---|---|---|
| `GET` | `/health` | Sống/chết + trạng thái MT5 + tài khoản | có |
| `GET` | `/account` | balance / equity / margin / currency | có |
| `GET` | `/positions` | vị thế đang mở | có |
| `POST` | `/order` | đặt lệnh (market/pending) | **bắt buộc** theo `Idempotency-Key` (header) |
| `POST` | `/order/close` | đóng lệnh theo `ticket` | có (đóng lệnh đã đóng = ok) |
| `POST` | `/order/modify` | sửa SL/TP theo `ticket` | có |
| `GET` | `/history` | lịch sử lệnh (phục vụ sync `positions`) | có |

Mọi response: `200` + JSON, hoặc `4xx/5xx` + `{"ok":false,"error":"..."}`.
**Không trả HTML.** Không endpoint nào ghi file, không endpoint nào nhận lệnh "thử nghiệm"
khác `/order` — cổng duy nhất đặt lệnh là `/order` (dẫn xuất của D7: một cổng cho mọi lệnh).

### 2.1 `POST /order`

Request — **`Idempotency-Key` nằm ở HEADER** (đây là nguồn chân lý):

```http
POST /order HTTP/1.1
Host: 127.0.0.1:8790
Authorization: Bearer <MT5_BRIDGE_TOKEN>
Idempotency-Key: tm-1a2b3c4d5e6f7a8b9c0d1e2f-0
Content-Type: application/json
```

```json
{
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
| `Idempotency-Key` (header) | **có** | = `clientOrderId`, ≤ 31 ký tự `[A-Za-z0-9_-]`. Trùng → **trả về kết quả của lần đầu**, không đặt lại (payload so bằng canonical hash — xem dưới) |
| `Idempotency-Key` / `clientOrderId` (trong body) | không | **chỉ để tương thích** với client cũ; bridge bỏ qua khi so payload. Nếu body và header **lệch nhau** thì **header thắng** — body không bao giờ được ghi đè key |
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

**So payload để khử trùng = CANONICAL HASH, không phải so byte-exact.** Bridge băm payload
bằng JSON canonical (key **sắp xếp**, không khoảng trắng) **sau khi đã loại `Idempotency-Key`
và `clientOrderId`**; hai payload cho cùng hash = cùng một lệnh. Lý do: so byte-exact phụ thuộc
**thứ tự key**, nên chỉ cần client đổi thư viện JSON (hoặc đổi thứ tự key) là chuỗi byte đổi
theo → bridge tưởng "cùng key, payload khác" → `409`. Hash canonical thì bất biến với thứ tự
key, nên nó đo **nội dung lệnh**, không đo cách serialize.

**`409` (cùng key + payload khác) là trạng thái TERMINAL.** Caller **không được retry**, **không
được đổi `Idempotency-Key`**, và **không** được tự sửa payload rồi gửi lại — người/operator phải
xử lý bằng tay (đối chiếu ticket gốc trong `original`). Nói thẳng hậu quả của việc chọn sai ở
đây: một lệnh bị **permablock** — không vào được mà cũng không gỡ được bằng retry. Vì hậu quả
nặng như vậy, luật này phải được viết ra chứ **không** được để ngầm.

### 2.2 `GET /health`

```json
{ "ok": true, "mt5": { "connected": true, "terminal": "MetaTrader 5", "account": 12345678, "company": "..." }, "account_type": "demo", "uptime": 3612 }
```

`account_type` là trường **BẮT BUỘC** trong **mọi** response `/health` **đã qua xác thực** — kể
cả khi `ok: false` / `connected: false` / MT5 chưa kết nối được (khi đó ghi `"unknown"`), vì cổng
demo của Node đọc đúng trường này trước khi cho đặt lệnh. (Response `401` vì thiếu token **không**
tính: nó là từ chối truy cập, không phải trạng thái tài khoản.) API Python của MT5 **chỉ** cho
`account_info().trade_mode` dạng **số**, nên bridge phải tự map:

| `trade_mode` | `account_type` |
|---|---|
| `ACCOUNT_TRADE_MODE_DEMO` (= 0) | `'demo'` |
| mọi giá trị khác (contest/real) | `'real'` |
| thiếu / không đọc được (`account_info()` trả `None`) | `'unknown'` |

Node **từ chối gửi lệnh** với **mọi** giá trị khác `'demo'` — tức `'real'`, `'unknown'`, thiếu
hẳn trường, hay bất kỳ chuỗi lạ nào — chứ không chỉ chặn `'real'` (demo-first, §6).

`GET /health` **cũng cần bearer token** (`Authorization: Bearer <MT5_BRIDGE_TOKEN>`), fail-closed
y như mọi endpoint khác: thiếu/sai token → `401`. Hệ quả của luật này được ghi rõ ở §6 —
**từ chối đặt lệnh, không đặt-rồi-cầu-may**.

`connected: false` → Node **không** retry đặt lệnh, chỉ báo `degraded` (fail-soft như `engine/db.mjs`).

## 3. Timeout

| Hành động | Timeout | Qua hạn thì sao |
|---|---|---|
| `GET /health`, `/account` | **2 s** | bỏ qua lần này, giữ giá trị cũ; **single-attempt** — không retry trong cùng request (xem §4) |
| `GET /positions`, `/history` | **2 s** | bỏ qua lần này, giữ giá trị cũ; **lỗi kết nối** (socket reset/refused giữa chừng) thì được retry theo §4 (tối đa 2 lần). Hết 2 s = timeout, **không** retry |
| `POST /order` | **10 s** | **KHÔNG** coi là thất bại — rơi vào trạng thái `unknown` (xem §4) |
| `POST /order/close`, `/order/modify` | **10 s** | như trên |

Không endpoint nào để timeout > 10 s: MT5 terminal treo thì caller phải sớm biết để chuyển
sang paper / degraded thay vì treo pipeline.

Retry **không** áp dụng chung cho "GET": §4 chia endpoint đọc thành hai lớp
(`/health`+`/account` gọi đúng 1 lần; `/positions`+`/history` được retry). §3 và §4 nói **cùng
một luật**; nếu thấy lệch thì §4 là bản chi tiết hơn.

## 4. Retry & trạng thái `unknown` (quan trọng nhất)

`/order` là **không idempotent theo bản chất** (kết nối chết giữa chừng thì không biết lệnh
có vào không). Luật:

1. **Trước khi gửi**: ghi bản ghi `pending` + `clientOrderId` vào NDJSON/`positions`.
2. **Gửi kèm `Idempotency-Key` ở header** (§2.1) — nếu bridge đã nhận key này thì nó trả về
   ticket cũ (`duplicate: true`), **không đặt thêm**.
3. **Timeout / connection reset** → trạng thái **`unknown`**, **không** retry tự động ngay.
4. **Thoả mãn `unknown` = tra cứu**, không retry mù. Lúc `unknown` thì **chưa có `ticket`**:
   §4.1 chỉ ghi được `clientOrderId`, còn ticket do bridge sinh ra ở response — mà response thì
   chưa tới. Nên thứ tự tra là:
   1. `GET /positions` (hoặc `/history`) tìm theo **`clientOrderId`** trước (bridge echo
      `clientOrderId`/`magic` lên position — §5);
   2. không thấy thì tìm theo **`comment`** (tag method/regime, §2.1);
   3. tra theo **`ticket`** chỉ khi bridge **đã** echo ticket đó ở một lần trước (ticket có sẵn
      từ kết quả một lần gọi trước, hoặc từ `positions`/`history` đã đọc) — **không** được giả
      định là luôn có ticket.
   Thấy ở bất kỳ bước nào → ghi `open`, `ok`, **không** gửi lại.
   Không thấy **và** quá `RECONCILE_AFTER` (mặc định **30 s**) → mới gửi lại với **cùng**
   `Idempotency-Key`.
5. **Không bao giờ** đổi `Idempotency-Key` khi retry. Đổi key = có thể đặt 2 lệnh thật.

Lý do khóa bất biến: `clientOrderId` sinh từ `alertKey` + `seq` — cùng alert, cùng thứ tự
luôn ra cùng khóa, nên retry an toàn về mặt toán học (D3).

Retry policy cho endpoint đọc (§3 và §4 chốt **cùng một luật** — hai lớp, không phải "GET nói
chung"):

| Lớp | Endpoint | Số lần gọi | Retry |
|---|---|---|---|
| **Single-attempt** | `GET /health`, `GET /account` | **1** (không retry) | không bao giờ: timeout 2 s **đã là phán quyết**, retry chỉ làm chậm việc phát hiện bridge chết |
| **Reconcile reads** | `GET /positions`, `GET /history` | tối đa **3** (1 lần gọi + **2 retry**) | backoff `200 ms → 1 s`, **chỉ** lỗi kết nối (socket reset/refused), **không bao giờ** retry `4xx`/`5xx`; **timeout 2 s cũng không retry** (nó là phán quyết, cùng lớp với `/health`) |

`POST /order`, `/order/close`, `/order/modify`: **không** retry tự động (xem §4.3). Chỉ
`reconcile()` (§4.4) mới được gửi lại `/order`, và luôn với **cùng** key.

## 5. Đồng bộ vị thế

- Bridge là **nguồn chân lý** về "đang giữ gì" trên MT5.
- Mỗi position bridge trả về **phải** mang đủ danh tính lệnh để §4.4 tra soát được: `ticket`
  (dùng làm `externalId`), **`clientOrderId`** (hoặc `magic` echo lại key) và `comment`.
  Không có `clientOrderId` thì lúc `unknown` — khi chưa có ticket — chỉ còn cách tra theo
  `comment`, vốn có thể trùng giữa các lệnh.
- Node poll `GET /positions` mỗi **5 s** (khi Phase 12 bật) → ghi collection `positions`
  với `source: 'mt5'`, `externalId = ticket` (unique sparse đã có sẵn trong data-model §3).
- Một chiều: Node **không** tự sửa `positions` của MT5; mọi thay đổi phải qua
  `/order/modify` hoặc `/order/close` rồi poll phản ánh lại.

## 6. An toàn

- Bind **chỉ** `127.0.0.1`; có token `MT5_BRIDGE_TOKEN` (header `Authorization: Bearer`)
  — fail-closed như webhook (`TM_TOKEN`).
- **Token bắt buộc cho MỌI endpoint, kể cả `GET /health` và `GET /account`** (§2.2).
  **Hệ quả được chấp nhận có chủ ý:** nếu bridge từ chối `/health` không kèm token thì cổng
  demo của Node **không học được** `account_type` → hành vi đúng là **TỪ CHỐI đặt lệnh** và báo
  `degraded`, **tuyệt đối không** "đặt rồi cầu may" (`placed-and-hoped`). Đây là lựa chọn có ý
  thức: thà không vào lệnh còn hơn vào lệnh trên tài khoản không xác định được là demo hay real.
  Cũng vì vậy **không** có nhánh code nào gửi request thiếu token: thiếu token = không mở socket.
- **Demo trước, real sau** (roadmap Phase 12): bridge ghi `account_type` trong `/health`
  (map từ `trade_mode`, §2.2); Node từ chối gửi lệnh với mọi giá trị khác `'demo'` khi còn ở
  phase paper/demo — kể cả `'real'`, `'unknown'`, thiếu hẳn trường hay chuỗi lạ.
- Lệnh thật **luôn** qua risk gate trước (D7) — bridge không biết gì về risk, nó chỉ thi hành.

## 7. Checkpoint khi bắt đầu Phase 12

> Ghi chú (2026-10-05): `exec/mt5/server.py` + `exec/mt5/client.mjs` **đã có** trong repo và test
> idempotency đã chạy **bằng mock bridge** (xem *Trạng thái kiểm chứng*). Các mục **còn lại** vẫn
> là việc phải làm khi có **MT5 thật**.

- [x] Tạo `exec/mt5/server.py` + `exec/mt5/client.mjs` đúng endpoint ở §2
      (`server.py` **chưa từng chạy** — chỉ đạt `py_compile`)
- [x] Test idempotency: gửi `/order` 2 lần cùng key → đúng 1 ticket (mock bridge)
- [ ] Test timeout: kill MT5 giữa chừng → trạng thái `unknown` được tra soát, không đặt 2 lần
- [x] `/health` xuất hiện trong `/health` tổng của Node (D9) — `mt5HealthComponent()` trong
      `server/webhook.mjs` + 2 check ở `tools/smoke.mjs`
