# Data model — TM Trading

> **Trạng thái:** Phase 6. Đã cài trong code (`engine/models/*.mjs`, `exec/*.mjs`) và **kiểm chứng trên MongoDB thật**:
> `npm run test:db` → **58 pass, 0 fail** (chạy trên DB riêng `tm-trading-test`, tự xoá sau khi xong).
> Tài liệu này là **nguồn chân lý duy nhất** về schema/index; sửa code thì sửa ở đây trước.
>
> Liên quan: `docs/time-rules.md` (luật thời gian D2), `docs/alert-schema.md` (hợp đồng payload
> + luật bump `v`), `docs/mt5-ipc.md` (hợp đồng IPC MT5).

Stack: **Mongoose 9 · MongoDB 8.2 local · engine Node ESM**.

---

## 0. Ba quy tắc xuyên suốt

| # | Quy tắc | Vì sao |
|---|---|---|
| **D1** | Mọi `run` mang **version stamp** (`engineVersion`, `paramsHash`, `params`, `dataHash`, `universeSnapshot`, `gitRev`) | Sửa 1 ngưỡng là mọi kết quả cũ thành vô nghĩa. Không có stamp thì kết quả nhiều thế hệ engine nằm chung bảng và "tối ưu preset" chạy trên dữ liệu rác |
| **D2** | Mọi thời gian lưu **UTC**; ngày nghiệp vụ là **chuỗi `YYYY-MM-DD`** | Khoá ngày phải rõ ràng, không phụ thuộc múi giờ của máy chạy — hợp đồng đầy đủ: `docs/time-rules.md` |
| **D3/D4** | `alertKey` (tầng alert) và `clientOrderId` (tầng lệnh) là **hai tầng riêng** | Alert đến 2 lần là chuyện nhỏ; **lệnh** đặt 2 lần là chuyện lớn. Không được để tầng lệnh phụ thuộc vào việc tầng alert khử trùng đúng |

---

## 1. Danh sách collection

| Collection | Model | Vai trò | Ghi chú |
|---|---|---|---|
| `runs` | `Run` | Một lần chạy backtest | Mang đầy đủ D1 |
| `trades` | `Trade` | Từng lệnh của một run | Tách khỏi `runs` (một run có thể hàng nghìn lệnh → nhúng sẽ chạm trần 16MB) |
| `alerts` | `Alert` | Alert thô từ TradingView + **nơi lưu dedupe bền vững** | `alertKey` **unique**; lifecycle `received → opened → closed` (hoặc `rejected` + `rejectReason`; `forwarded` = luồng không qua paper) |
| `signals` | `Signal` | Sự kiện VSA đã dịch nghĩa (SV/BC/ST/NS/ND/EoM) | Tách khỏi `alerts`; webhook ghi từ `ENTRY` (Phase 6) — `toSignalDoc()` trong `server/webhook.mjs`, song song `logs/alerts.ndjson`, fail-soft |
| `positions` | `Position` | Vị thế thật (paper/MT5/sàn/tay) | Nguồn chân lý "đang giữ gì"; paper mở/đóng qua `exec/paper.mjs` (§9.2), `externalId = clientOrderId(alertKey)` |
| `journal` | `Journal` | **Một dòng cho mỗi lệnh ĐÃ KHỚP** (paper/MT5/exchange/manual), gắn `method` + `regime` (Phase 13 item 1) | **Derived read model**: `key` suy từ danh tính upstream (`account`+`source`+`externalId\|_id`) — không phải scheme id thứ hai (D3/D4); `unknown[]` ghi rõ tag không suy được. Chi tiết §10 |
| `risk_state` | `RiskState` | Bộ đếm rủi ro **theo ngày UTC** + kill-switch | Unique `(account, utcDay)`; hợp đồng halt/inherit: §9.1 |
| `equity` | `Equity` | Ảnh chụp đường vốn | Vẽ equity curve, tính drawdown thực |

---

## 2. Version stamp — `engine/version.mjs`

Mọi document `runs` bắt buộc có:

| Trường | Kiểu | Ý nghĩa |
|---|---|---|
| `engineVersion` | string | Tăng **thủ công** khi thay đổi làm kết quả khác đi |
| `paramsHash` | string | Hash của bộ tham số **đã canonical hoá** |
| `params` | Mixed | Bộ tham số hiệu dụng — **cần cho việc tái lập**, không chỉ hash |
| `dataHash` | string | Hash chuỗi nến (chỉ OHLCV) |
| `universeSnapshot` | Mixed | Danh sách symbol + ngày lấy + nguồn (D11) |
| `gitRev` | string \| null | Đọc trực tiếp `.git/HEAD`, không spawn process |

### 2.1 `paramsHash` — 4 cái bẫy đã kiểm chứng bằng thực nghiệm

`canonicalParams()` xử lý đúng 4 trường hợp mà nếu bỏ qua thì hash **vô dụng** (đã khoá bằng test +
mutation-test xác nhận test bắt được):

1. **Chỉ truyền tham số người dùng đổi** → phải **merge `DEFAULTS`** trước khi hash, nếu không mỗi
   preset đều hash khác nhau dù cấu hình thật giống hệt.
2. **Đảo thứ tự key** → phải sort key (ở cả `canonicalParams` **và** `stableStringify` — phòng thủ 2 lớp).
3. **`volMin: 0` vs `"0"`** → phải ép kiểu **theo SCHEMA**, không theo kiểu giá trị người dùng đưa vào.
4. **Gõ sai tên** (`rp` thay vì `rP`) → phải **ném lỗi**, không được lặng lẽ sinh hash rồi để run đó
   nằm chung bảng.

`PARAM_SCHEMA` suy **trực tiếp** từ `DEFAULTS` của `engine/signals.mjs` → không thể lệch với engine.

> **Chuỗi import (Phase 4):** `engine/version.mjs` → `engine/signals.mjs` → `engine/methods/vsa.mjs`.
> `signals.mjs` chỉ còn là **re-export một implementation**, tồn tại để giữ chuỗi này không đổi và
> để `index.mjs` (registry) tránh vòng import với `vsa.mjs`. **Không** viết lại logic vào
> `signals.mjs` — `DEFAULTS` thật nằm ở `methods/vsa.mjs` và mọi hash đều lấy từ đó.

### 2.2 Truy vấn bắt buộc kèm thế hệ

Khi gom nhóm/tổng hợp kết quả (Phase 5), **luôn** lọc thêm `paramsHash` + `engineVersion`:

```js
Run.find({ paramsHash, engineVersion })   // có index (paramsHash, engineVersion)
```

Dashboard **phải từ chối trộn** run khác thế hệ thay vì im lặng cộng chung.

---

## 3. Index (đã kiểm chứng tồn tại thật)

| Collection | Index | Phục vụ |
|---|---|---|
| `runs` | `(symbol, tf, createdAt↓)` | "run mới nhất theo symbol × TF" — truy vấn nóng của dashboard |
| `runs` | `(paramsHash, engineVersion)` | Gom nhóm theo cấu hình + thế hệ engine |
| `runs` | `(createdAt↓)` | Danh sách run gần đây |
| `trades` | `(runId, entryTime)` | Bảng lệnh của một run |
| `trades` | `(symbol, tf, entryTime↓)` | Lọc lệnh độc lập với run |
| `trades` | `(paramsHash, result)` | Thống kê TP/SL theo bộ tham số |
| `alerts` | **`alertKey` UNIQUE** | **D4 — chặn trùng bền vững** |
| `alerts` | `(symbol, ts↓)`, `(action, ts↓)` | Tra cứu alert |
| `signals` | `(symbol, ts↓)`, `(type, ts↓)`, `(method, symbol, ts↓)` | Nhật ký tín hiệu |
| `positions` | `(account, status)`, `(symbol, entryTime↓)` | Vị thế đang mở |
| `positions` | **`(account, source, externalId)` UNIQUE + sparse** | Một ticket không xuất hiện 2 lần |
| `journal` | **`key` UNIQUE** | Phase 13: re-sync một lệnh đã chiếu vào journal không tạo dòng thứ hai (dedupe bền vững kiểu D4) |
| `journal` | `(entryTime↓)`, `(source, entryTime↓)`, `(method, regime, entryTime↓)`, `(symbol, tf, entryTime↓)` | Truy vấn journal của dashboard (lọc source/method/regime/ngày) |
| `journal` | `(engineVersion, paramsHash, entryTime↓)` | Nhóm theo version stamp cho preset drift (Phase 13 item 3, D1) |
| `risk_state` | **`(account, utcDay)` UNIQUE** | D7b — một bản ghi mỗi ngày |
| `equity` | `(account, ts↓)` | Vẽ đường vốn |

> **Không** đặt `index: true` lẻ trên `paramsHash`: index tổng hợp đã phục vụ truy vấn tiền tố,
> thêm index đơn chỉ tốn chi phí ghi.

---

## 4. D4 — dedupe bền vững (thay cho `Map` trong RAM)

**Đã cài (2026-10-02):** `server/webhook.mjs` **không còn `const seen = new Map()`**. Dedupe
mặc định chạy trên `alerts.alertKey` + unique index → thuộc tính của **dữ liệu**, không phụ thuộc
tiến trình; restart/deploy **không mất trạng thái**, 2 tiến trình song song cũng không chen nhau.
Insert trùng trả lỗi `11000` (đã test). Khi Mongo không dùng được mới lui về RAM và **báo rõ**
`durable:false` (`/health` → `dedupe:"ram"`), kèm cảnh báo log — không được im lặng coi là an toàn.

### 4.1 Sinh khoá — `engine/keys.mjs`

```js
alertKey(payload, source)  // 'a1_' + sha256(stableStringify({source, symbol, tf, ts, action,
                           //   side, price, level, mode}))[:40]
clientOrderId(key, seq)    // 'tm-' + key[-24:] + '-' + seq   (<= 31 ký tự, hợp lệ MT5)
```

- `ts`/`price` không hợp lệ → **ném lỗi** (không sinh khoá rác).
- **`level` và `mode` bắt buộc có trong canon**: bỏ `level` thì TP1/TP2 cùng bar (cùng
  `ts/action/side/price`) ra **cùng khoá** → alert thứ hai bị coi là retry và **mất**;
  bỏ `mode` thì chart `live` vs `closed` cùng bar chặn nhầm nhau. Đã khoá bằng test
  (`engine/test.mjs` §10, `engine/test-db.mjs` §7).
- Đổi canon = đổi khoá → dữ liệu cũ không trộn được với mới. Chưa có alert nào trong DB
  khi đổi (2026-10-02) nên **không cần migration**; lần sau đổi canon thì bắt buộc ghi chú
  migration tại đây.
- Đổi nguồn (`scanner`, `ai`) → khoá khác → không chặn nhầm.
- `clientOrderId` **tất định** để sàn/MT5 tự chối lệnh trùng ở tầng dưới.

---

## 5. Kết nối — `engine/db.mjs`

Kế thừa pattern của tm-hub (`server/utils/mongo.ts`), giữ đúng các đặc tính đã được chứng minh:

- trạng thái trên `globalThis` → sống qua import lại / HMR;
- **dedup**: nhiều lời gọi song song chỉ mở **một** kết nối;
- **fail-soft**: chưa cấu hình hoặc không kết nối được → trả `null`, **không ném**
  (roadmap: *NDJSON luôn ghi, Mongo là tuỳ chọn* — thiếu Mongo không được làm hỏng một lần backtest);
- **cooldown 30s** sau lần lỗi → fail fast thay vì treo;
- đổi `MONGODB_URI` → đóng kết nối cũ rồi nối lại;
- **URI có tên DB thì tôn trọng tên đó** (`dbNameFromUri()`) — chỉ dùng `DEFAULT_DB_NAME`
  khi URI không chỉ định. *Bug đã bắt:* trước đây luôn ép `dbName: 'tm-trading'` nên
  `test-db.mjs` (dùng `dropDatabase()`) **xoá nhầm DB thật mỗi lần `npm test`**.

**Khác tm-hub có ý:** tm-hub dùng `createConnection` + tách pool theo tên vì phục vụ nhiều DB
(log DB riêng). Engine chỉ có một DB nên dùng **kết nối mặc định** `mongoose.connect` — nhờ vậy
`mongoose.models.x || model(...)` trong `engine/models/*.mjs` dùng được ngay.

Đây là **lớp duy nhất** trong engine import `mongoose`. `ta.mjs`, `signals.mjs`, `version.mjs` và
test của chúng **vẫn chạy khi không cài / không có Mongo**.

---

## 6. Sao lưu (D13)

- **`npm run backup`** (`tools/backup.mjs`): `mongodump --gzip` `runs` + `trades` →
  `backups/<UTC stamp>/tm-trading/*.bson.gz`; thư mục `backups/` **gitignore**. Retention
  giữ `--keep N` / `BACKUP_KEEP` bản mới nhất (mặc định 14, prune khi chạy).
- **SKIP rõ ràng, không "thành công giả"**: thiếu `mongodump` hoặc `MONGODB_URI` → in SKIP
  + exit 0 (đồng nhất test-db); chạy `--strict` (cho cron) → exit 1. Mọi lần chạy ghi
  `logs/backup.ndjson` (`ok`/`skip`/`fail`).
- **Không** sao lưu: `data/` (cache OHLCV — tải lại từ Binance), `reports/` (chạy lại
  `engine:run`), `logs/*.ndjson` (bản ghi phụ; nguồn chân lý là `alerts`/`signals` Mongo).
- Định kỳ: Task Scheduler / cron gọi `npm run backup` — chính thức vào `services/` ở
  Phase 8-9 cùng heartbeat.

---

## 7. Kiểm thử

```bash
npm run test:db      # 58 assertion, cần MongoDB; tự SKIP (exit 0) nếu không có
npm test             # smoke + engine + journal + preset-drift + stamp + risk
                     # + paper + drift + mt5 + db + services + ai + ai-review
```

> Phase 13 added three suites to `npm test`: `test:journal` (126 assertions),
> `test:preset-drift` (98) and `test:ai-review` (71). All three are pure — no
> Mongo, no network, no API key — and they assert that no DB connection was
> opened. See §10.
> The TP-ladder hardening added a fourth: `test:paper` (47), which covers
> `findFirstExit` / `sanitizeTps` / `followExitPrice` (pure) plus narrow source
> guards for the two `runCycle` wiring points that cannot be unit-tested without
> Mongo. `test:risk` grew to 79.
> The live version stamp (§10.3) added a fifth: `test:stamp` (52 assertions),
> which drives `recordOpen()` through an INJECTED fake model layer — so the
> write path is executed and its document inspected, without a database.

`engine/test-db.mjs` dùng DB riêng `tm-trading-test` và **xoá sạch sau khi chạy**.
Nếu Mongo không sẵn sàng, in `SKIP` **rất rõ** và thoát 0 — để `npm run verify` vẫn xanh trên máy
chưa dựng Mongo, nhưng không âm thầm coi SKIP là đã kiểm.

**Cô lập DB (quan trọng):** file này ghim `process.env.MONGODB_URI = URI` **trước** khi import
`server/webhook.mjs`, vì webhook tự gọi `loadEnv()` lúc import và sẽ điền URI từ `.env`
(DB thật) → test kết nối bị đổi giữa chừng. Có test khẳng định `mongoose.connection.name`
vẫn là `tm-trading-test` sau khi import.

---

## 8. Việc còn lại của Phase 3

- [x] `engine/store.mjs` — ghi NDJSON **luôn**, ghi Mongo khi có URI (theo D1/D2) ✅ 2026-10-02
- [x] Nối `server/webhook.mjs` ghi `alerts` + dùng `alertKey` (bỏ `Map` trong RAM) ✅ 2026-10-02
- [x] Luật bump `v` của `docs/alert-schema.md` + thêm `source` khi có nguồn thứ hai ✅ 2026-10-02
- [x] Hợp đồng IPC cho MT5 (endpoint/schema/timeout/retry) → `docs/mt5-ipc.md` ✅ 2026-10-02
- [x] Luật thời gian D2 → `docs/time-rules.md` ✅ 2026-10-02

**Acceptance Phase 3** (roadmap §3): `docs/data-model.md` tồn tại ✅ · `engine/store.mjs` ghi
kèm version stamp ✅ · test khẳng định 2 run khác `paramsHash` không bị trộn ✅
(`engine/test.mjs` §9 — `summarizeRuns()` ném lỗi, `groupByGeneration()` gộp có kiểm).

*Đã xong ở Phase 4 (2026-10-02):* `engine/data.mjs`, `engine/backtest.mjs`, `engine/report.mjs`,
`engine/run.mjs` + script `engine:run` — xem roadmap §4.

---

## 9. Phase 6 — Risk gate + executor (D7/D8) contract

### 9.1 `exec/risk.mjs` — cổng duy nhất cho mọi lệnh

Mọi lệnh (webhook → paper; scanner/AI/MT5 khi có) **bắt buộc** qua `checkOrder()` trước
khi mở. Kết quả `allowed` kèm `qty`/`sizePct` hoặc từ chối kèm lý do + số liệu:

| Kết quả | Điều kiện |
|---|---|
| `HALTED` | `today.halted` (kill-switch / `drift` / manual — xem inherit dưới) |
| `DAILY_LOSS_CAP` | `realizedPnlPct ≤ −dailyLossCapPct` (đồng thời auto-halt `reason:'daily_loss_cap'`) |
| `BAD_PRICE` / `BAD_TPS` | entry/SL/TP không finite, SL ≥ entry (BUY) hoặc SL ≤ entry (SELL), hoặc không có TP |
| `SIZE_ZERO` | sizing tính ra 0 (giá/equity/kelly…) |
| `RISK_BUDGET` | `qty × |entry−SL| / equity > riskPerTradePct` |
| `LEVERAGE` | `qty × entry / equity > maxLeveragePct` |
| `EXPOSURE` | (notional các vị thế open + lệnh mới) / equity > `exposurePct` |
| `MAX_OPEN` | số vị thế open ≥ `maxOpenPositions` |
| `MIN_RR` | reward/risk < `minRr` |

- **Config** đọc từ env `RISK_*` (qua `exec/env.mjs`): `RISK_EQUITY`(10000 — fallback khi
  không có snapshot equity), `RISK_RISK_PER_TRADE_PCT`(1), `RISK_DAILY_LOSS_CAP_PCT`(5),
  `RISK_MAX_LEVERAGE_PCT`(5), `RISK_MAX_OPEN`(5), `RISK_EXPOSURE_PCT`(500 — đồng nhất
  leverage 5x, 100 sẽ chặn mọi lệnh), `RISK_MIN_RR`(1.5), Kelly: `RISK_KELLY_MIN_N`(20),
  `RISK_KELLY_MAX_PCT`(3), `RISK_KELLY`(off), `RISK_CLOSE_ON_HALT`(false).
- **Quy ước halt (D7c)**: `daily_loss_cap` **hết hạn theo ngày** (sang ngày mới tự hết);
  kill-switch / `drift` / manual **inherit qua nửa đêm** (`resolveDay`) cho tới khi
  `resume` tay. Halt **không** đóng vị thế đang mở — SL/TP vẫn bảo vệ; riêng
  `halt --close` (hoặc `closeOnHalt=true`) mới đóng.
- **Auto-halt**: `recordClose()` khi `realizedPnlPct ≤ −dailyLossCapPct` →
  `halt('daily_loss_cap')` ngay trong lệnh đó.
- **TP ladder — fail closed (2026-10-04, English per the language policy)**: `order.tps` not an
  array still becomes `[]` (→ `BAD_TPS`). Inside an array, every element must be a finite number,
  or a non-blank string that parses to one; anything else (`null`, `undefined`, `''`, `'  '`,
  `NaN`, `true`, `[]`) is **rejected** with `BAD_TPS` naming the index (`tps[1] is not a finite
  number (null)`). It is deliberately **not** coerced and **not** dropped: `Number(null)` /
  `Number('')` / `Number([])` are `0` and `Number(true)` is `1`, and this gate is the only
  component that still sees the defective array — a dropped gap also silently re-indexes the
  ladder the alert contract uses (`tps[level-1]`, see §9.2), and a surviving `tps[0] = 0` in the
  `positions` document made `findFirstExit()` "close" a long at price 0 (§9.2). Numeric strings
  like `'90'` stay valid. Locked by `exec/test-risk.mjs` §4b.
- **Audit**: mọi lần từ chối `checkOrder` + `recordOpen`/`recordClose`/`halt`/`resume`/
  `drift_report`/`drift_breach` append `logs/risk.ndjson` (fail-soft, không đụng luồng lệnh).
  `auditLog(event, data, file?)` nhận `file` tuỳ chọn — **test bắt buộc truyền file tmp riêng**
  (bẫy đã thật: `test-risk.mjs` từng `rmSync` file audit thật → xoá mất drift record của dashboard).
- **CLI**: `node exec/risk.mjs status | halt [reason] [--close] | resume [reason]`.

### 9.2 `exec/paper.mjs` — vòng đời lệnh paper

```
ENTRY  → stale guard PAPER_STALE_MS (15′) → checkOrder → fill tại alert.price
       → recordOpen(externalId = clientOrderId(alertKey)) → alert.status = 'opened'
FOLLOW → STOP_LOSS  (fill tại alert.price)      ┐ data nến 1m:findFirstExit()
         TAKE_PROFIT (fill tại tps[level-1])     │ (SL trước TP; gap SL fill at open;
         TIME_CLOSE  (fill tại close cuối)       ┘ TIME_CLOSE fill close cuối)
       → recordClose (PnL linear, không phí/slippage) → alert.status = 'closed'
```

- **Idempotent 2 lớp** (D3): `externalId` unique ở `positions` + filter `status:'open'` —
  chạy lại cycle không mở/đóng trùng.
- Nhiều vị thế cùng symbol: follow-up đóng position **cũ nhất** trước.
- Gate thất bại → alert `rejected` + `rejectReason` (không mở position, không tính PnL).
- **TP ladder an toàn (2026-10-04)**: `sanitizeTps()` chạy TRƯỚC `recordOpen` — mọi mức phải là
  số hữu hạn **> 0**, nếu không alert bị `rejected` (`BAD_TPS`, kèm `auditLog('paper_reject_tps')`)
  thay vì âm thầm lưu mảng thô. `findFirstExit()` từ chối `sl ≤ 0`/`tp1 ≤ 0`/`dir` lạ, và vòng
  quét dữ liệu bỏ qua (kèm cảnh báo + `auditLog('paper_bad_tps1')`) position legacy/manual có
  `tps[0]` không dùng được. *Lý do:* `b.high >= tp1` đúng với mọi nến khi `tp1 = 0` → lệnh LONG bị
  "đóng tại TP giá 0" (PnL giả + auto-halt oan); Mongoose **vẫn lưu** `[null,110]` cho path
  `[Number]` nên rủi ro này tồn tại với doc legacy/manual (chưa vá schema — ngoài phạm vi).
  Ở tầng nguồn: `test-paper.mjs` khoá việc `recordOpen` KHÔNG bao giờ nhận `tps: a.tps` thô.

### 9.3 D8 — `exec/drift.mjs`

So sánh **ENTRY alerts** TV (cửa sổ `DRIFT_WINDOW_H`=24h, `DRIFT_SINCE_MS`) với
`analyze()` của engine **cùng symbol + tf** (`engineTf`: `1h→60`, `15m→15`, `1D→D`,
tf không hỗ trợ → hàng `skipped`). Breach khi `|Δ| > DRIFT_MAX_DIFF`(3) **hoặc**
`Δ/tv > DRIFT_MAX_PCT`%(50) với tổng ≥ `DRIFT_MIN_TOTAL`(4):

- breach → `halt('drift')` (**inherit qua nửa đêm**, không đóng vị thế) + audit
  `drift_report`/`drift_breach` + Telegram (fail-soft nếu thiếu token) + exit 2;
- chỉ mở lại **tay**: `node exec/drift.mjs resume <reason>`;
- **dashboard**: `readDriftStatus()` (`server/utils/risk.ts`) đọc `drift_report` **gần nhất**
  trong 64KB cuối `logs/risk.ndjson` → card Drift hiện `Monitoring`/`BREACH — halted` +
  thời điểm check; chưa từng chạy → "Chưa chạy check" (fail-soft, đọc file nên chạy cả khi
  Mongo down);
- test thuần: `exec/test-drift.mjs` (25 assertion, vào `npm test`) +
  `tests/risk-status.test.ts` (readDriftStatus).

---

## 10. Phase 13 — `journal` + preset drift (item 1 & 3)

> New section written in English (language policy: all new code, comments and doc
> sections are English). The rest of this document is still Vietnamese and is
> translated opportunistically.

### 10.1 Why a separate collection, and where it lives

`engine/journal.mjs` is a **derived read model**, not a new source of truth: rows
come from `positions` (the only place a real fill exists) and every row keeps a
pointer back at the upstream identity (`source` + `sourceId`). Backtest rows are
NOT journal rows — they are the frozen baseline the journal is compared against
(§10.3). Code lives in `engine/` because it is a data layer over the engine
models, exactly like `engine/store.mjs`; `services/` is reserved for periodic
jobs (roadmap §2).

Shape (one row per executed trade):

| Field | Meaning |
|---|---|
| `key` | `j1_` + sha256 of `{v, account, source, externalId\|id}` — derived from the upstream identity, **not** a second order-id scheme |
| `source` | `paper` · `mt5` · `exchange` · `manual` (else `unknown`) |
| `account`, `sourceId` | upstream account + `positions.externalId` (or `_id`) |
| `symbol`, `tf`, `dir` | `positions.tf` (written from the opening alert since §10.3); a LEGACY position has none, so the projection still falls back to `alerts.alertKey = positions.signalKey`, else `unknown` |
| `entryPrice`, `exitPrice`, `sl`, `tps`, `qty` | filled from the position |
| `result` | `TP` · `SL` · `TIME` · `OPEN` · `unknown` — derived from the recorded levels (an exact level match); a gap fill (paper fills the stop at the bar OPEN) stays `unknown` instead of being guessed |
| `rMultiple` | derived from `dir`/`entryPrice`/`sl`/`exitPrice`; `null` when the risk distance is 0 or the exit is absent |
| `pnlAbs`, `pnlPct` | as recorded by the executor |
| `fees` | `positions.fees` (null on every paper row: fee-free by design). `null` = UNKNOWN, so `0` would claim costs were measured |
| `method`, `regime`, `engineVersion`, `paramsHash` | tags; `unknown` when not derivable. `regime` is a **point-in-time** lookup (latest `intel` kind `regime` snapshot with `ts <= entryTime`) so the journal cannot leak look-ahead information |
| `entryTime`, `exitTime`, `recordedAt` | UTC (D2) |
| `unknown[]` | names of the tracked fields this row could NOT derive — queryable, so "we do not know" is visible in the data |

Idempotency (D3/D4): re-syncing the same position is a no-op through the UNIQUE
`key` index; the NDJSON mirror at `reports/journal.ndjson` applies the same
key-based skip, so the file store is idempotent too. Nothing can place an order
from a journal key.

### 10.2 Query helpers

Pure, DB-free and therefore usable by the dashboard: `filterJournal(entries,
{source, method, regime, symbol, tf, result, account, engineVersion, paramsHash,
from, to})` (date range is **half-open [from, to)** in UTC ms), `journalStats()`
(win rate + expectancy in R over closed rows whose R is derivable, plus
`rMissing`, `unknownTagCounts` and the D12 `insufficient` flag below
`MIN_TRADES_FOR_EVIDENCE = 20`), `groupJournal(entries, ['source','method'])`, and
the IO pair `syncJournal()` / `loadJournal()` (Mongo when available, NDJSON
otherwise — `loadJournal` always reports which of the two it read).

### 10.3 Version stamp on the LIVE path — `positions.stamp` (D1)

Until 2026-10-05 nothing on the live path wrote a version stamp: `recordOpen()`
stored `paramsHash: null`, `source: 'paper'` was hardcoded and `positions` had no
`tf`, no `exitReason` and no fee field. Every live row therefore read as
`unknown#unknown` in §10.4 and the report could only say "cannot compare".

The live path now stamps its own trades. `positions` gained:

| Field | Meaning |
|---|---|
| `stamp.engineVersion` | `ENGINE_VERSION` of the engine that opened the position (`engine/version.mjs`) |
| `stamp.paramsHash` | hash of the parameter set the live path is RUNNING — always produced by `paramsHash(params)` (§2.1), never by a second hashing scheme. `null` **only** when no live preset was declared (§10.3.1) |
| `stamp.params` | the canonical parameter set itself — the same rule as `runs.params`: a hash proves "same config", only the parameters make a run reproducible |
| `stamp.kind` | `declared` (an operator declared the live preset) or `unknown` (no declaration → `paramsHash: null`) |
| `stamp.since` | when that declaration was observed (UTC) |
| `stampUnknown` | `true` on positions written before this change. Consumers MUST exclude them instead of reading a missing stamp as a bucket |
| `tf` | timeframe from the opening alert (`alerts.tf`); `null` when the alert had none |
| `exitReason` | why the position closed: `alert:TAKE_PROFIT` · `alert:STOP_LOSS` · `alert:TIME_CLOSE` · `data:tp` · `data:sl` · `manual` · `unknown` (see §10.3.2) |
| `fees` | `null` = UNKNOWN, never `0`: paper PnL is fee-free BY DESIGN, so `0` would claim that costs were measured |

`stamp` is a nested sub-document on purpose (instead of three top-level fields):
it is one identity that is written together and read together, `stampUnknown` /
`stamp.kind` describe the stamp itself rather than the position, and a reader can
pass `pos.stamp` straight to the journal/preview-path without picking fields
apart. The per-trade fields that do NOT come from the engine's identity (`tf`,
`exitReason`, `fees`) stay top-level, exactly like `method` and `signalKey`.

The writer is `buildPositionDoc()` (pure) inside `engine/stamp.mjs` → `recordOpen()`;
`exec/paper.mjs` supplies `tf`, `source` and the real exit reason. Backfilling is
deliberately NOT performed: an existing position gets no invented preset. A
position without a stamp is marked `stampUnknown: true` so it is visible in the
data, and §10.4 excludes it from every bucket.

#### 10.3.1 Where the LIVE preset comes from — declaration, never a guess

`engine/stamp.mjs` is the single place that decides. Resolution order:

1. `PAPER_LIVE_PRESET` (env) — an already-computed `paramsHash` (e.g. taken from a
   backtest run in the dashboard). Trusted as-is: the live path cannot recompute
   the hash of parameters it does not have.
2. `PAPER_LIVE_PARAMS` (env) — the full parameter set (JSON, or a
   `path/to/params.json` file) the live path runs with. It is passed through
   `canonicalParams()`/`paramsHash()`, so it cannot drift from the backtest side.
   `engineVersion` inside it names the generation the trade belongs to and is
   removed before hashing (it is not an engine parameter).
3. Neither → `paramsHash: null`, `stampUnknown: true`. **No fallback to the
   engine `DEFAULTS`**: the stamp is the identity of the *live* configuration, and
   the current DEFAULTS say nothing about the values TradingView was actually
   running when the trade was opened. A tool cannot compare a declaration with a
   label.

`engineVersion` is always written: the engine that executed the fill IS known.

#### 10.3.2 `exitReason` must be real

Only the exit path knows why a trade closed, so the executor records it where the
decision is made and nowhere else:

| Value | Written by |
|---|---|
| `alert:TAKE_PROFIT` / `alert:STOP_LOSS` | the follow-up TradingView alert branch (the event TradingView already saw) |
| `alert:TIME_CLOSE` | TIME_CLOSE → market fill at the latest close |
| `data:tp` / `data:sl` | `findFirstExit()` returned `kind: 'tp'` / `kind: 'sl'` |
| `manual` | an operator closed the position |
| `unknown` | the legacy default; nothing guessed it |

`engine/journal.mjs` maps it to the journal `result` (`TP`/`SL`/`TIME`), which is
why a *gap* fill now keeps `data:sl` (kind is exact) while the old level-matching
heuristic had to answer `unknown`. `exitReason` never invents a kind the exit path
did not return: `findFirstExit()` returning `null` writes nothing at all.

### 10.4 Preset drift — `engine/preset-drift.mjs` (Phase 13 item 3)

**Not D8.** `exec/drift.mjs` (D8) compares the NUMBER of TradingView ENTRY alerts
against the number of setups the engine sees on the same symbol/TF in a 24h
window and **halts new orders**. `engine/preset-drift.mjs` measures the PRESET
over time: the realized distribution of the trades executed with
`engineVersion#paramsHash` vs what the FROZEN backtest of that same preset
promised (`reports/trades.ndjson`). It takes no action.

Rules: buckets are per generation **and** per UTC-aligned time window
(`--window`, default 7 days); a live dataset spanning several generations is
**refused** (no pooled number, warning printed — D1); a live stamp with no frozen
counterpart yields "cannot compare" (no substitution, no silent pick); a bucket
below `--min-trades` (default 20 R samples) is labelled **insufficient evidence**
and prints no delta — only observations.

Live rows with NO stamp (`stampUnknown`, i.e. positions written before §10.3) are
**excluded from every bucket** and reported as a warning with their count. They are
never bucketed under `unknown#unknown`: an empty bucket of anonymous trades is not
a measurement, and a bucket labelled `unknown` reads like a preset called
"unknown" on a dashboard.

`--live-preset` / `--live-engine-version` were REMOVED together with this change
(they used to fill missing stamps on the report side). Now that the WRITER
(`recordOpen`) is authoritative, a report-side declaration would be a second
source of truth: it could relabel legacy trades — the exact rows §10.3 says must
stay excluded — and make an unverifiable claim comparable. The declaration lives
in `PAPER_LIVE_PRESET`/`PAPER_LIVE_PARAMS` (§10.3.1), i.e. where the trades are
open, and nowhere else.

```bash
npm run journal -- sync      # positions -> journal (NDJSON always, Mongo optional)
npm run journal -- stats --by source,method,regime
npm run preset:drift -- --window 7 --min-trades 20
npm run ai:review            # SCAFFOLD (Phase 13 item 2): digest + prompt + proposals
```

Tests: `npm run test:journal` · `npm run test:preset-drift` · `npm run test:stamp`
· `npm run test:ai-review`, all wired into `npm test`, no Mongo/network/API key
required.