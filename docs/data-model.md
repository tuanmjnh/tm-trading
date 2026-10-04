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
npm test             # smoke (173) + engine (360) + risk (56) + drift (25) + db (58) = 672
```

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