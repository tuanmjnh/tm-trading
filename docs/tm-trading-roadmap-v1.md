# Roadmap — TM Trading (kế hoạch tổng thể)

> **Đây là ứng dụng trade desk tự động**, không phải bộ chỉ báo. Pine/TradingView chỉ là
> **công cụ nhỏ hỗ trợ** (nguồn tín hiệu + đối chiếu tay); sản phẩm thật là
> **engine local + store + dashboard + risk gate + execution**.
> Stack đã chốt: **engine Node.js mjs · DB MongoDB · UI Nuxt + Nuxt UI · data Binance klines.**
> Phần AI/Intel/Execution là module mở rộng — chỉ bắt đầu sau khi core (**Phase 1–6**) chạy ổn định.
>
> Phiên bản: **2026-10-01** (đã gộp toàn bộ kết luận của bản review thiết kế vào §4 —
> bản `roadmap-review.md` đã được xoá, không còn tài liệu song song).

---

## 1. Mục tiêu

1. **Tối ưu theo từng loại** — bảng preset symbol-class × TF **có số liệu backtest** (không đoán tay).
2. **Bot auto test** — chạy backtest tự động, tổng hợp báo cáo lợi suất per symbol × TF.
3. **Theo dõi live** — webhook TV → store → dashboard, đối chiếu live vs backtest → đề xuất tối ưu chỉ báo.
4. **Market intelligence** — news, dòng tiền, scanner biến động/gom hàng, regime (altseason, funding,
   IO unlock), Liquidation HeatMap → lọc cơ hội cho altcoin.
5. **AI copilot** — cổng kết nối AI để phân tích, đề xuất phương án & lệnh (qua **risk gate**,
   human-in-the-loop).
6. **Đa phương pháp** — price action / SMC / ... chạy chung khung backtest, so sánh WR/PF
   (method league table).
7. **Execution đa kênh** — paper → real; **MT5 cho XAU/XAG**, crypto qua webhook/exchange.
8. **Cấu trúc project** gọn; phần mới không phá tooling cũ (`npm run verify` phải luôn xanh).

Ràng buộc đã xác định:
- TradingView **không có API backtest tự động** → engine local là bắt buộc; strategy TV chỉ đối chiếu tay.
- Docs VSA là **spec** của engine; golden fixtures chống lệch Pine ↔ engine.
- **Không có lệnh nào được đặt khi chưa qua Risk Manager** (Phase 6) — AI/MT5 đều đi qua cổng này.

**Non-goals (chốt để không trôi việc):**
- Không multi-user / đăng ký công khai / SaaS ở bản này — dashboard là **single-user**.
- Không tự động *nghĩ ra* chiến lược bằng AI; AI chỉ phân tích và đề xuất trên dữ liệu đã có.
- Không on-chain data trả phí, không Coinglass trả phí ở giai đoạn đầu (§6).
- **Không tối ưu tham số trước khi biết method có lợi thế** (xem D-nhóm C ở §4).

---

## 2. Cấu trúc project mục tiêu

```
tm-trading/
├── README.md
├── docs/                  # tài liệu + roadmap.md này + data-model.md (Phase 3)
│                          #   + time-rules.md (D2) + alert-schema.md + mt5-ipc.md
├── pine/                  # CÔNG CỤ HỖ TRỢ (nguồn tín hiệu, không phải sản phẩm)
│   ├── parts/  parts-vsa/  shared/  dist/
├── tools/                 # tooling build/verify (GIỮ)
│   ├── build.mjs  smoke.mjs  errors.mjs  copy.mjs  pine-ref.*
├── engine/                # BACKBONE — tín hiệu + backtest (Phase 2–5)
│   ├── ta.mjs  signals.mjs  version.mjs  data.mjs  backtest.mjs
│   ├── methods/           # plugin phương pháp; vsa.mjs = method 0 (tách ở Phase 4)
│   ├── report.mjs  store.mjs  run.mjs  test.mjs
│   └── fixtures/          # OHLCV + expected (golden)
├── server/                # webhook (nhận alert) + API cho dashboard
│   └── webhook.mjs
├── services/              # job định kỳ (Phase 8–9) + heartbeat (D-nhóm D)
│   ├── scanner.mjs        # biến động, volume spike, breakout, gom hàng
│   └── news.mjs  funding.mjs  regime.mjs  liquidation.mjs
├── ai/                    # AI copilot (Phase 11)
│   ├── gateway.mjs        # abstraction nhiều provider (OpenAI/Anthropic/Ollama)
│   ├── agent.mjs          # tool-calling: đọc DB, klines, scanner, methods
│   └── prompts/
├── exec/                  # EXECUTION — cổng an toàn (Phase 6 + 12)
│   ├── risk.mjs           # RISK MANAGER — cổng duy nhất cho mọi lệnh
│   ├── paper.mjs          # paper trading
│   └── mt5/               # bridge MT5 (Phase 12, tách Python micro-service)
├── app/                   # Nuxt + Nuxt UI dashboard (Phase 7)
├── data/                  # cache OHLCV + intel cache (gitignore)
├── reports/               # output CSV (gitignore)
├── logs/                  # alerts.ndjson, ai.ndjson (giữ)
├── private/               # 11 ảnh golden (giữ)
└── package.json  .env.example
```

---

## 3. Các phase

Trạng thái: `[x]` xong · `[ ]` chưa · 🔒 = **có điều kiện chặn, không được bỏ qua**.

### Phase 1 — Chuẩn hóa cấu trúc (không đổi chức năng) — ✅ XONG

- [x] Khung `engine/ server/ services/ ai/ exec/ app/ data/ reports/` + `.gitignore`
- [x] Dời `tools/notify/server.mjs` → `server/webhook.mjs`; sửa import `smoke.mjs`, scripts, docs
- [x] `.env.example`: `MONGODB_URI` (tuỳ chọn), `TM_TOKEN`, Telegram/Discord; ô trống `AI_*`
- [x] npm scripts `test:engine` (chạy trong `npm test`); `engine:run` **còn thiếu** → thêm ở Phase 4
      ✅ thêm rồi: `npm run engine:run` (xem Phase 4, 2026-10-02)
- [x] Cập nhật README (cây thư mục + scripts)

**Acceptance:** `npm run verify` PASS; `npm run notify` chạy và webhook test như cũ. → **đạt (150/0)**

### Phase 2 — P0: Engine signal parity (golden fixtures) — ✅ XONG

- [x] `engine/ta.mjs` — RMA (Wilder), ATR, `pivotlow/high(len,len)` đúng Pine, session check, 6 bucket VSA
- [x] `engine/signals.mjs` — port trung thực `20_volume + 30_levels + 40_events + shared`:
      6 bucket, gate TIM (purple), quietST/quietLow, momentum run, nearSup/nearRes,
      SV/BC/ST/NS/ND, EoM, **levels Entry/SL/TP + auto-close** (chạm TP/SL, ưu tiên SL)
- [x] `engine/test.mjs` — fixtures + kiểm công thức theo giá trị mẫu; đã vào `npm test`
- [ ] `engine/fixtures/*.json` — *lệch kế hoạch có chủ ý*: fixtures đang viết trong `test.mjs`
      (`mkBars` + `basePath`) vì cần "đường giá có hướng nến" để pivot nghiêm ngặt hình thành —
      dạng này khó biểu diễn gọn bằng JSON. Tách ra file khi Phase 4 cần nạp fixture thật.

**Acceptance:** fixtures xanh; case khớp cách tính tay theo spec docs §4/§5/§6. → **đạt (83/0)**

> **Ghi chú kỹ thuật đã kiểm chứng khi port** (giữ lại vì sẽ còn dùng ở Phase 4/10):
> - `ta.rma` seed bằng `ta.sma(length)` rồi `alpha*src + (1-alpha)*nz(sum[1])`;
> - `ta.pivotlow/high` **xác nhận tại `i = pivot + rightbars`** (không nhìn trước), so sánh
>   **nghiêm ngặt** — đường giá phẳng có đáy bằng nhau sẽ **không** tạo pivot;
> - biên bucket là hành vi double **cố ý**: `100 * 2.2 = 220.00000000000003` nên `volume = 220`
>   là `VeryHigh` chứ không phải `TIM` (Pine y hệt);
> - `NS/ND` chỉ phụ thuộc `quietOn`, **không** phụ thuộc `evtOn` (đúng như Pine);
> - cùng một bar chạm cả TP lẫn SL → tính **SL** (bảo thủ). Xem thêm **D6** để nâng độ trung thực.

### Phase 3 — P0: Nền tảng dữ liệu & hợp đồng 🔒 *(MỚI — chèn trước khi viết backtester)*

> Vì sao có phase này: mọi phase sau đều ghi/đọc dữ liệu (`runs`, `trades`, `signals`, `intel`,
> `positions`) nhưng chưa có chỗ nào định nghĩa schema, index, hay version. Nếu để Phase 4/6
> tự phát minh, tới Phase 7/13 sẽ phải migration từ gốc. **Đây là phase rẻ nhất và chặn nhiều
> phase nhất.**

- [x] **D1 — version stamp cho mọi run** ✅ `engine/version.mjs` (2026-10-01): `engineVersion`,
      `paramsHash`, `dataHash`/`barsHash`, `universeSnapshot`, `gitRev` (đọc `.git/HEAD` trực tiếp,
      không spawn process), `canonicalParams` + `stableStringify`.
      *Thiếu nó thì mọi kết quả đã lưu trở nên vô nghĩa khi sửa 1 ngưỡng, nhưng vẫn nằm chung bảng
      với kết quả mới → "tối ưu" trên dữ liệu rác.*
      **4 cái bẫy đã kiểm chứng bằng thực nghiệm** (khoá bằng test, mutation-test xác nhận bắt được):
      1. người dùng chỉ truyền tham số họ đổi → **phải merge `DEFAULTS` trước khi hash**, nếu không
         mọi preset đều hash khác nhau dù cấu hình thật giống hệt;
      2. đảo **thứ tự key** → phải sort key (ở cả `canonicalParams` **và** `stableStringify` —
         phòng thủ 2 lớp, đã mutation-test);
      3. `volMin: 0` (số) vs `"0"` (chuỗi) → **phải ép kiểu theo SCHEMA**, không theo kiểu giá trị
         người dùng đưa vào;
      4. gõ sai tên tham số (`rp` thay vì `rP`) → **phải ném lỗi**, không được lặng lẽ sinh hash rồi
         để run đó nằm chung bảng.
      `PARAM_SCHEMA` suy trực tiếp từ `DEFAULTS` nên không thể lệch với engine thực tế.
- [x] **`docs/data-model.md`** ✅ (2026-10-01) — schema từng collection + index + ví dụ document
      (`runs`, `trades`, `alerts`, `signals`, `positions`, `risk_state`, `equity`).
      Cài trong `engine/models/*.mjs` và **kiểm chứng trên MongoDB thật**: `npm run test:db` → **49/0**.
      Index quan trọng nhất: **`alerts.alertKey` UNIQUE** — chính là D4.
- [x] **D3/D4 — idempotency + dedupe bền vững** ✅ `engine/keys.mjs`: `alertKey` (tầng alert) và
      `clientOrderId` (tầng lệnh, ≤ 31 ký tự cho MT5) là **hai tầng riêng**. Unique index đã test
      chặn được bản ghi trùng (`code 11000`).
      ✅ (2026-10-02) **đã nối `server/webhook.mjs` ghi `alerts` + bỏ `Map` trong RAM**:
      `dedupe: 'mongo'` là mặc định (unique index, bền vững qua restart), `'ram'` chỉ là
      chế độ thử nghiệm được `/health` báo rõ `dedupe:"ram"`; ghi NDJSON `logs/alerts.ndjson`
      **luôn** chạy kể cả khi Mongo chết (fail-soft).
      *Bug thật đã bắt lúc nối:* khóa `alertKey` cũ **thiếu `level`** → TP1/TP2 cùng bar có
      `ts/action/side/price` y hệt → alert thứ hai bị coi là retry và **mất**. Đã thêm `level`
      + `mode` vào canon, khoá bằng test (section 10) — chưa cần migration vì chưa có alert nào
      trong DB.
- [x] **D2 — quy tắc thời gian** ✅ (2026-10-02) — hợp đồng trong `docs/time-rules.md`:
      lưu **UTC ms**, ngày nghiệp vụ = chuỗi `YYYY-MM-DD` **UTC**, session quy đổi tz tường minh.
      Test trong `engine/test-db.mjs` §8 (alert.ts là Date UTC đúng, `utcDay` 23:59 vs 00:01
      rơi 2 ngày, NDJSON `createdAt` ISO `Z`).
- [x] **Hợp đồng alert** ✅ (2026-10-02) — `docs/alert-schema.md`: **luật bump `v`**
      (thêm optional → không bump; thêm bắt buộc/đổi kiểu/đổi nghĩa → bump + sửa 3 nơi),
      trường **`source`** optional (mặc định `tradingview`, validate `[A-Za-z0-9_-]{1,32}`,
      **có tham gia `alertKey`** để scanner/AI không chặn nhầm TV), và mô tả chính xác khóa
      khử trùng gồm `level`/`mode`.
- [x] **Hợp đồng IPC cho MT5** ✅ (2026-10-02) — `docs/mt5-ipc.md`: endpoint, schema
      `POST /order` + `Idempotency-Key`, timeout (2 s đọc / 10 s lệnh), luật retry +
      trạng thái `unknown` (**tra soát trước, không retry mù**), sync `positions`, bind
      loopback + token fail-closed. Chốt sớm để Phase 12 không tự nghĩ giữa chừng.

**Acceptance:** `docs/data-model.md` tồn tại; `engine/store.mjs` ghi kèm version stamp; có test
khẳng định **2 run khác `paramsHash` không bị trộn** trong báo cáo/tổng hợp.
→ **đạt**: `engine/store.mjs` (`withStamp`/`saveRun`) ghi stamp, `summarizeRuns()` **ném lỗi**
khi trộn 2 thế hệ, `groupByGeneration()` là cách duy nhất được phép gộp — test `engine/test.mjs`
section 9.

### Phase 4 — P1: Data + Backtester + Báo cáo lợi suất — ✅ XONG

- [x] 🔒 **`engine/methods/vsa.mjs` — tách VSA thành plugin method 0 NGAY TẠI ĐÂY**, theo đúng
      interface Phase 10 (`in → events/scores`, `out → setup {dir, entry, sl, tp}`), rồi viết
      backtester **chống lên interface đó** với đúng một implementation.
      *Vì sao bắt buộc:* nếu để Phase 10 mới tách, toàn bộ `backtest.mjs` sẽ gắn cứng vào VSA và
      phải bóc lại — đó là lỗi trình tự, không phải việc tăng thêm.
      ✅ (2026-10-02): `engine/methods/vsa.mjs` (plugin `analyze()` + `registerMethod`),
      `engine/methods/index.mjs` (hợp đồng `METHOD_CONTRACT` + registry — `validateMethod`
      **không** gọi `analyze`), `engine/methods/all.mjs` (loader side-effect; `index.mjs` không
      được import `vsa.mjs` vì vòng import → TDZ trên `REGISTRY`), `engine/signals.mjs` còn là
      re-export **một** implementation. Backtester viết **chỉ** chống vào interface: test §12
      chạy qua `stubMethod` giả lập, chứng minh nó không đọc thẳng VSA.
- [x] `engine/data.mjs` — Binance **fapi** (mặc định, khớp chart `.P`) / spot, phân trang,
      cache `data/`, **resample 1m → 4m/10m** (Binance không có 4m/10m)
      ✅ (2026-10-02): `fetchKlines` phân trang `endTime` giảm dần + khử trùng lặp, cache
      `data/<market>/<symbol>-<tf>.json` (không vào git — D13), `klineToBar` kiểm tra quan hệ
      O/H/L/C, `resample()` gộp O/H/L/C/volume đúng nghĩa và **ném** khi `targetMs` không chia
      hết cho `srcMs` (chống lệch nhân). `4m`/`10m` cố ý **không** nằm trong interval map của
      Binance — `MUST_RESAMPLE` là đường bắt buộc (test §14).
- [x] **D11 — universe snapshot**: lưu danh sách symbol + ngày lấy + nguồn vào document `run`;
      lọc **min-history** (token mới có 20 lệnh không so được với BTC 5000 lệnh); ghi rõ số lệnh
      mỗi dòng báo cáo. *Không lọc delisted = survivorship bias cho toàn bộ kết quả.*
      ✅ (2026-10-02): `universeSnapshot()` ghi `fetchedAt` + `source` + `minHistoryBars`/
      `minTrades` + số lệnh từng dòng; dòng bị loại **vẫn được lưu** kèm `excluded: true` +
      `reason` cụ thể (vào `reports/universe.json`), symbol loại hiện `(LOAI)` trong bảng;
      `survivorshipBias: true` + `survivorshipNote` **luôn** in ra kể cả khi chưa lọc gì.
- [x] `engine/backtest.mjs` — replay: ST → **limit tại level**; fee 0.05% + slippage;
      **1 position/setup** (pyramid → Phase 10); **D5** (mô phỏng y hệt Pine — xem §4)
      ✅ (2026-10-02): `costsOf` (slippage 2 chiều + phí round-trip trên `fillNotional`),
      `slipPct: 0.02` thêm vào `DEFAULTS` để **hash vào `paramsHash`**; D5 mặc định `drop`
      (đúng `40_events.pine`) đếm vào `counters.replaced`/`dropped` nên không im lặng;
      biến thể `ttl` gắn `variant: 'onReplace=ttl'` và bị loại khỏi mọi so sánh parity;
      parity `fee=0, slip=0, không 1m` → **khớp tuyệt đối** `result`/`exitTime` với method.
- [x] **D6 — thứ tự TP/SL trong bar bằng sub-bar 1m**: khi bar mẹ chạm cả TP và SL, dùng nến 1m
      để xác định cái nào chạm trước; chỉ khi 1m cũng không phân giải được mới rơi về giả định
      bảo thủ (SL). Gần như miễn phí vì **đã có** dữ liệu 1m để resample
      ✅ (2026-10-02): `resolvedBy1m` là `true`/`false`/`null` — `null` nghĩa là **không cần**
      1m, `false` là đã tra 1m/không có 1m mà rơi về SL bảo thủ. Không bao giờ đoán: không có
      1m thì `resolvedBy1m !== true` (test §12); sub-bar cắt bằng nhị phân + con trỏ tiến
      đơn điệu.
- [x] `engine/report.mjs` — trades, WR, PF, net%, maxDD, avg RR, expectancy → console + CSV
      ✅ (2026-10-02): **không tính lại** số nào — chỉ trình bày `summarizeRuns` (§13 trừng
      điều này); in `noFill`/`replaced`/`dropped` **rõ ràng** (chôn đi thì WR/PF của các lệnh
      còn lại bị đọc thành kết quả cả hệ thống); CSV RFC4180 có cột khai báo tường minh.
      Thêm `medianRr` + `degenerateRisk`: phát hiện thật là **1 lệnh risk 0.003% entry cho
      87.7R** kéo `avgRr` từ −0.58R lên **+0.15R** trong lúc PF = 0.32, net = −16% — báo cáo
      lúc đó đọc như *có lời*. Giờ in cả hai, đánh dấu `*` khi hai số ngược dấu, và nêu rõ
      "đừng dùng `avgRr` đơn lẻ".
- [x] `engine/store.mjs` — ghi NDJSON **luôn**; ghi MongoDB nếu có `MONGODB_URI` (theo D1/D2)
      ✅ (2026-10-02, dời lên làm sớm vì là acceptance Phase 3): `saveRun`/`appendNdjson` ghi
      `reports/runs.ndjson` + `reports/trades.ndjson` **luôn**, Mongo fail-soft (`mongo:true`
      thì lỗi mới ném); `withStamp` **từ chối** ghi run thiếu/chênh `paramsHash`; `summarizeRuns`
      ném lỗi khi trộn thế hệ, `groupByGeneration` gộp có kiểm (`engine/test.mjs` §9).
- [x] `engine/run.mjs` — CLI: `--symbols --tfs --market --preset`; thêm script `engine:run`
      ✅ (2026-10-02): `npm run engine:run` (script đã thêm). Còn có `--params`, `--method`,
      `--sub1m`, `--on-replace`, `--refresh`, `--limit`, `--min-bars`, `--min-trades`,
      `--no-mongo`, `--out`, `--quiet`. Flag boolean có danh sách riêng (`BOOLEAN_FLAGS`) —
      nếu không, `--refresh BTCUSDT.P` sẽ nuốt mất symbol mà không báo lỗi (test §15).
      **Cảnh báo dữ liệu in cả trong `--quiet`**: `--quiet` chỉ được bỏ phần in chi tiết,
      không bao giờ được bỏ cảnh báo về tính trung thực của chính bảng kết quả.

**Acceptance:** báo cáo BTCUSDT.P/ETHUSDT.P/ZECUSDT.P × 5m/15m/1h (kèm 4m/10m resample) ra CSV +
(tuỳ chọn) Mongo; có bảng tổng hợp symbol × TF; mỗi run có version stamp đầy đủ.
✅ (2026-10-02) — chạy thật:
```
node engine/run.mjs --symbols BTCUSDT.P,ETHUSDT.P,ZECUSDT.P --tfs 5m,15m,1h --limit 3000 --no-mongo
node engine/run.mjs --symbols BTCUSDT.P --tfs 4m,10m --limit 200000 --no-mongo
```
9/9 chạy ra `reports/<symbol>-<tf>-trades.csv` + `summary.csv` + `universe.json`, có bảng
symbol × TF, mỗi run mang `engineVersion=0.5.0` + `paramsHash` + `universeSnapshot`.

> ⚠️ **Số liệu Phase 4 chưa phải kết luận về lợi thế của method** (D12 ở Phase 5 mới trả lời).
> Ba cảnh báo luôn in kèm: **(1)** 65.8% setup khớp nhưng bị ST sau thay (D5 mặc định = đúng
> Pine) → WR/PF chỉ của 298 lệnh còn lại trong 874 setup; **(2)** chưa bật min-history;
> **(3)** survivorship bias — universe lấy từ Binance hiện tại nên *tệ hơn thực tế*.
> Ngoài ra `avgRr` và `medianRr` **ngược dấu** ở chế độ `ttl` (`0.15*` vs `−0.60*`) — đọc
> `medianRr`/PF/net, không đọc `avgRr` đơn lẻ.

### Phase 5 — P2: Preset optimizer (trả lời "tối ưu theo từng loại")

- [ ] 🔒 **D12 — baseline đối chứng + hold-out theo symbol**: vào lệnh ngẫu nhiên với **cùng phân
      phối SL/TP/RR**, cùng phí, cùng số lệnh; và hold-out **theo cả symbol** (không chỉ 70/30
      theo thời gian). *Nếu VSA không vượt baseline rõ ràng trên hold-out → **dừng tối ưu tham số
      và sửa luật**, không quay grid tiếp.* Đây là thứ chặn overfit mạnh nhất mà tốn ít công.
      Lý do phải làm: fixtures chứng minh engine **đúng**, không chứng minh method **có lợi thế**.
- [ ] Grid sweep: `rP, testR, retestT, slBuf, rrFb, run, lvFresh, purWin, sess on/off`
- [ ] Walk-forward 70/30 + lọc overfit (min trades, độ ổn định giữa 2 nửa)
- [ ] **D14 — compute budget**: song song hoá theo symbol, **cache kết quả theo `paramsHash`**
      (chạy lại không tính lại), và **time-box cho phase** — hết hạn thì chốt preset tốt nhất
      hiện có rồi chuyển, không để sweep thành hố đen
- [ ] Output → **bảng preset symbol-class × TF** kèm WR/PF/DD + số lệnh → ghi docs §8.2 (mục Preset)
- [ ] (Sau) preset theo **regime** (trend/range/altseason) thay vì chỉ symbol × TF — dùng output Phase 9
- [ ] (Sau) dropdown `Preset` trong input indicator — chỉ nếu cần one-click thay template TV

**Acceptance:** docs có bảng preset dẫn xuất từ run thật, mỗi dòng có số liệu + số lệnh; và có
báo cáo so sánh **preset tốt nhất vs baseline ngẫu nhiên** trên hold-out.

### Phase 6 — P3: Live loop + RISK MANAGER + Paper executor 🔒

- [x] Webhook ghi thêm vào Mongo (`signals`) song song `logs/alerts.ndjson` ✅ (2026-10-04, xem §9)
- [x] **D4 — dedupe bền vững** ✅ (2026-10-02, làm sớm trong Phase 3) — `server/webhook.mjs`
      **không còn `seen = new Map()`**: mặc định `dedupe:'mongo'` (unique index theo `alertKey`
      → giữ nguyên sau restart/deploy, chống cả 2 tiến trình song song), fallback RAM chỉ khi
      Mongo chết và **báo rõ** `durable:false` + cảnh báo log + `/health` ghi `dedupe:"ram"`.
      Test: `engine/test-db.mjs` §7 (retry bị chặn bền vững, `dedupe` mới sau "restart" vẫn nhận
      trùng, TP1/TP2 cùng bar không bị chặn) + smoke 173 assertion.
- [x] **`exec/risk.mjs` — cổng duy nhất cho mọi lệnh** (bắt buộc trước Phase 11/12) ✅ (2026-10-04) gồm:
      * **D7a — Position sizing** (fixed-fractional / Kelly nhẹ) **ngay trong gate này**:
        đây là mục bắt buộc, **không** còn là "đề xuất" — PnL live vô nghĩa nếu chưa chốt size;
      * **D7b — state bền vững**: `daily loss cap` là bộ đếm **theo ngày** → lưu collection
        `risk_state` theo `(ngày UTC, account)`; restart lúc 23:50 mà mất bộ đếm là cap vô hiệu
        đúng lúc cần nhất;
      * **D7c — kill-switch**: dừng khẩn cấp toàn hệ + quy định rõ xử lý vị thế đang mở;
      * max leverage, tối đa vị thế đồng thời, per-symbol exposure, sanity-check SL/TP/RR tối thiểu
- [x] 🔒 **D7d — test cho `risk.mjs` cùng mức nghiêm ngặt như golden fixtures** ✅ (2026-10-04): bảng case
      (vượt cap, đúng biên, SL/TP vô lý, size = 0, exposure chồng lấn, kill-switch đang bật).
      *Đây là module an toàn nhất của toàn hệ — không được là module duy nhất không có test.*
- [x] **`exec/paper.mjs`** — mọi lệnh (webhook, scanner, AI) chạy paper trước; khớp theo data gần
      nhất → PnL live ✅ (2026-10-04)
- [x] **D8 — parity drift phải có HÀNH ĐỘNG, không chỉ báo cáo** ✅ (2026-10-04): tín hiệu TV (live) vs engine cùng
      symbol → khi drift vượt ngưỡng (ví dụ > N tín hiệu hoặc > X% trong cửa sổ 24h)
      **tự tạm dừng mở lệnh mới** (không đóng vị thế đang mở), ghi audit + báo Telegram;
      chỉ mở lại **bằng tay** sau khi điều tra. *Nếu drift chỉ để xem, hệ vẫn đặt lệnh dựa trên
      tín hiệu đã biết là lệch — đúng "rủi ro #1" mà roadmap tự đặt tên.*
- [x] **D13 — sao lưu** ✅ (2026-10-04): `tools/backup.mjs` (`npm run backup`) `mongodump` định kỳ
      `runs`/`trades`; ghi rõ `data/` + `reports/` tái tạo được nên không cần giữ

**Acceptance:** mọi lệnh vào/ra đều log qua risk gate **và có test**; so sánh được live signal vs
backtest; drift vượt ngưỡng thì hệ **tự dừng mở lệnh mới**; kill-switch hoạt động.

### Phase 7 — P4: Dashboard (Nuxt + Nuxt UI)

- [x] **Tổng quan + chi tiết run** ✅ (2026-10-03): trang `/` (KPI: series · lượt chạy · lệnh
      unique · cảnh báo dữ liệu + "Lần chạy gần đây"), trang `/runs` (list) và `/runs/[id]`
      (bảng trades đã khử trùng lặp, thống kê qua `summarizeRuns()`, version stamp **D1**)
- [x] **Live signals (trang `/signals`)** ✅ (2026-10-03): mirror pattern trang `/runs`
      (BasePage + `useCursorPagination` + `LazyGridList` 10 cột: Time · Symbol · TF · Side ·
      Price · SL · TP · Conf · Status · Action), empty state, badge `mongo:'down'`,
      i18n `nav.signals` + `signals.*` (en+vi), nav seed hub (xem
      `docs/app-inheritance.md` §3c): Overview · Backtest · **Signals** · Logs · System
- [x] **Equity curve + Bảng Symbol × TF** ✅ (2026-10-03): SVG equity trên `/runs/[id]`
      (điểm cuối === `netPct`, dam === `maxDrawdownPct` — test `tests/equity.test.ts`),
      matrix Symbol × TF trên `/runs` (tính từ list đã load, không gọi API mới)
- [x] **So sánh preset (trang `/runs/compare`)** ✅ (2026-10-04): chọn 2–6 series, bảng 7 chỉ
      số đặt cạnh nhau (best được in đậm), **bảng khác biệt tham số** (`paramsDiff` — câu hỏi
      lõi của "so sánh preset"), equity overlay nhiều đường trên trục thời gian UTC + giá trị
      % chung, cảnh báo D1 khi chọn >1 `paramsHash`; logic thuần ở `shared/utils/compare.ts`
      + `tests/compare.test.ts`, nút entry từ `/runs` và `/runs/[id]`, URL `?ids=` share được
- [x] **Trạng thái risk gate + drift** ✅ (2026-10-04): `GET /api/v1/risk/status` đọc
      `risk_state` (ngày UTC hiện tại; kill-switch **bền qua nửa đêm** — ban ghi halted gần
      nhất được giữ lại) + số `positions` open, fail-soft `mongo:'down'` (không 500); card
      **Risk Gate & Drift** trên `/` (badge HALTED/Active/No data · PnL ngày · opened/
      closed/streak · open positions; drift D8 hiển thị "chưa hoạt động" trung thực tới khi
      Phase 6 có nguồn dữ liệu). Gộp memo model engine thành `server/utils/engineModel.ts`
      (dùng chung signals/risk, 1 nguồn — D1) + `tests/risk-status.test.ts`
- [x] **API đọc kết quả backtest** ✅ (2026-10-03): `GET /api/v1/runs` + `/api/v1/runs/:id`
      (Nitro) đọc `reports/runs.ndjson` + `reports/trades.ndjson`, gộp theo **series**
      (`engineVersion~symbol~tf~paramsHash`), khui trùng theo nội dung lệnh, cảnh báo
      `multipleDataHashes`/`duplicatesRemoved` — số liệu **qua engine, không tính lại** (D1)
- [x] **API đọc Mongo** ✅ (2026-10-03): `server/utils/signals.ts` (runtime import
      `engine/models/alert.mjs` theo pattern `reports.ts` — xem bẫy #4 §5 app-inheritance)
      + `GET /api/v1/signals` (`?limit&cursor&symbol&action&side&since`, keyset cursor,
      `since` sai → 400, Mongo down → fail-soft `meta.mongo:'down'`) — e2e đã test:
      webhook → Mongo → API → UI
- [x] 🔒 **D10 — bảo mật dashboard**: auth đi **tm-hub** (satellite) — `server/middleware/auth.ts`
      chốt mọi `/api/**` (trừ health/icons/public), bắt `Bearer` hoặc cookie `accessToken`, ép
      `payload.appId` khớp `NUXT_PUBLIC_HUB_APP_ID`; secret JWT thẳng hàng hub ✅ (2026-10-03);
      dev server chỉ bind localhost. **Trước khi** cho truy cập từ xa: thêm reverse-proxy TLS
      (dashboard chứa vị thế/equity/lịch sử lệnh — dữ liệu nhạy cảm nhất của hệ).
      **Không** dùng chung cơ chế token-trong-URL của webhook (dễ lộ vào log/proxy)

**Acceptance:** xem báo cáo lợi suất + tín hiệu live trên web; chỉ truy cập từ localhost hoặc sau auth.

### Phase 8 — Market Intelligence: news + dòng tiền + scanner

- [x] `services/news.mjs` ✅ (2026-10-04): pull RSS (CoinDesk · Cointelegraph · Decrypt) +
      CryptoPanic (tuỳ chọn `CRYPTOPANIC_TOKEN`), parse thuần không thêm dependency;
      **chấm điểm tác động rule-based** (`NEWS_RULES` — hack/depeg/securities neg, ETF/
      institutional/whale pos, …) → mức `med`/`high` mới ghi; AI tóm tắt để Phase 11
- [x] `services/funding.mjs` ✅ (2026-10-04): `premiumIndex` + `openInterest` (fapi free,
      abstraction `services/binance.mjs`), snapshot top-15 |rate|, **cảnh báo funding cực
      đoan** (mặc định `|rate| ≥ 0.0005`, env `FUNDING_ALERT_RATE`) — alert key
      `alert:funding:<sym>:<nextFundingTime>` chống bắn trùng
- [x] `services/scanner.mjs` ✅ (2026-10-04): job định kỳ (`npm run services`, lệch pha
      3 service):
      * **biến động lớn**: top movers 24h/4h + breakout (range 48h vs ATR/đỉnh 20 bar)
      * **dòng tiền**: volume spike (bar vs baseline 20), taker buy/sell delta, CMF/OBV
        trên klines 1h×120 → `detectFlow` (score reasons)
      * **gom hàng**: sideways (range ≤ 6% · |Δ48| ≤ 1.5%) + OBV divergence + vol-dry-up
        → `detectAccum` (Wyckoff phase A–D nâng cấp sau)
- [x] Scanner → collection `intel` → dashboard + alert Telegram ✅ (2026-10-04):
      `engine/models/intel.mjs` (kind mover/flow/accum/funding/news/alert · TTL 7d),
      `GET /api/v1/intel` fail-soft (Mongo down → empty), card **Market Intel** trên `/`
      (heartbeat chip + 4 cột + top news), TG digest cho extremes/mover ≥15%/news `high`
- [x] 🔒 **D9 — heartbeat/observability** ✅ (2026-10-04): `services/heartbeat.mjs` ghi
      `logs/services.json` (`lastRunAt`/`lastOkAt`/`lastErrorAt`/`lastSummary` từng job);
      `/health` trả `services[]` (status `healthy` cần db ok **và** không service overdue);
      quá hạn `2 × chu kỳ` → **bắn Telegram** (dedupe 6h `HEARTBEAT_REMIND_H`),
      `npm run services:status` exit 1 khi overdue — test được bằng cách dừng `services:watch`

**Chạy:** `npm run services` (watch 3 job · 1 lần: `services:once`) · tests `services/test.mjs`
(52 checks, tự chạy cùng `npm test`) + `tests/health-services.test.ts` (server layer) ·
env mẫu trong `.env.example` block `Services (Phase 8)`.

**Acceptance:** ✅ mỗi phiên chạy ra top-list "coin có biến động / có dòng tiền / đang gom"
(+ funding extremes + news) lên card dashboard; service chết quá hạn → cảnh báo TG
(`evaluateHeartbeat` test boundary 2× chu kỳ + dedupe remind trong `services/test.mjs`).

### Phase 9 — Regime & Phái sinh: Altseason, IO, Funding, Liquidation HeatMap

- [x] `services/regime.mjs` ✅ (2026-10-04):
      * **Altcoin Season Index** (blockchaincenter — đọc `latestScores`, fallback
        og:description; **parse fail → throw** để heartbeat D9 bắt nguồn chết) + **BTC.D/
        ETH.D/MCap 24h** (CoinGecko `/global` + `/coins/markets`)
      * **IO / unlock**: TokenUnlocks trả phí → **file local `data/unlocks.json` optional**
        (thiếu → `[]`, TokenUnlocks thật = Phase 11) + biến động circulating supply so
        snapshot kind `supply` → cờ "trần bán treo" ≥ 0.2%/ngày (`SUPPLY_DRIFT_FLAG_PCT`)
      * **Fear & Greed** (alternative.me `value_classification`); lật mùa → TG dedupe
        `alert:regime:flip:<from>-><to>`
- [x] `services/liquidation.mjs` ✅ (2026-10-04) — Liquidation HeatMap:
      * free: Binance ws `forceOrder` (thanh lý thật) → `data/liq-events.ndjson`
        (collector chỉ trong `services:watch`, fail-soft reconnect) → gom cụm 1% bin,
        cửa sổ `LIQ_WINDOW_H`; cụm ≥ `LIQ_ALERT_USD`/1h → TG dedupe theo giờ
      * ước tính vùng đòn bẩy dùng OI + phân bảng GIA MÔ (`LIQ_CFG.bands` 3–100x,
        mmr 0.4%) — **`leverageBracket` 401 (cần key) + `openInterestHist` 404** →
        ghi rõ "est", không tự nhận số thật; Coinglass API = nâng cấp sau
      * output: snapshot kind `zone` → overlay dashboard (card ✅) + feed engine (Phase 10+)
- [x] Filter "trade lướt alt" ✅ (2026-10-04): altseason ON + funding không cực đoan
      (`|rate| < FUNDING_ALERT_RATE`) + OI tăng so chu kỳ trước (kind `oi`) + không unlock
      48h → bảng 12 ứng viên; thiếu dữ liệu → **blocker trung thực** (`season:*`,
      `funding:unknown|≥th`, `oi-trend:unknown|≤0`, `unlock:48h`)

**Ghi chú môi trường:** mạng dev mở được TCP tới fstream nhưng **không nhận frame**
(spot WS OK) → collector im lặng fail-soft, cột "actual" trống cho tới khi chạy ở nơi
WS thông (VPS); OI trend chu kỳ đầu = `oi-trend:unknown` (chưa có lịch sử) — trung thực.

**Chạy:** `npm run services` (watch 5 job · 1 lần: `services:once`) · tests
`services/test.mjs` (106 checks) + `tests/regime-zone.test.ts` · env mẫu `.env.example`
block `Services (Phase 9)`.

**Acceptance:** ✅ dashboard hiện regime (season + ASI/F&G/BTC.D + cờ + unlock 48h) +
funding/OI/liquidation zone (est ±% + L/S ratio); bảng filter alt-lướt chạy được
(BLOCKED/OK thật — hiện mọi blocker vì mùa trung tính).

### Phase 10 — Methods library + Confluence (price action, SMC, ...)

- [x] `engine/methods/` — mỗi phương pháp = plugin cùng interface (đã có sẵn shape từ Phase 4):
      * **price-action**: pin bar, engulfing, inside bar, FVG, order block, liquidity sweep,
        BOS/CHoCH, supply/demand zone
      * **trend/pullback**: MA structure + pullback, breakout ATR, range mean-reversion
      * **orderflow**: taker delta, delta divergence
      * (đã có) **VSA/Wyckoff** — method 0, tách từ Phase 4
* ✅ (2026-10-04): `engine/methods/priceAction.mjs` (PIN/ENG/INSIDE/BOS — event ±0.5…0.7),
  `trend.mjs` (PULL/BRK/RANGE — rolling Donchian + flat + rngBand), `orderflow.mjs`
  (DELTA ±0.6, DIV ±0.4 event/score — lọc `volume ≥ volMa`); 3 method truyền
  `replaceActive:false` vào `simulateSetups` (chống adverse selection: BRK/PULL re-fire
  mỗi bar → setup sống sót cuối chuỗi = vào đúng đỉnh, WR 0% → 98.3% trên fixture).
  VSA giữ nguyên `replaceActive:true` (D5). `deltaTh 0.55 → 0.3` (max |dR| majors 1h ≈ 0.34).
- [x] **Method league table** — cùng data, so WR/PF/DD từng method × symbol × TF
* ✅ (2026-10-04): `engine/league.mjs` + `npm run engine:league` → `docs/method-league.md`
  (per-combo `summaryRow` + pooled `summarizeRuns` per method; group bằng
  `hashOf({method,params})` — **không** dùng `paramsHash` vì schema VSA-centric sẽ throw
  method lạ; `--no-write`/`--refresh`/`--symbols`/`--tfs`). Baseline chưa optimize:
  price-action 337 lệnh WR 33.8% · trend 393 · orderflow 43 · vsa 66.
- [x] **Confluence score** — VSA + PA + regime (Phase 9) + funding + liquidation zone → bảng xếp
      hạng "coin đáng trade hôm nay"
* ✅ (2026-10-04): `services/confluence.mjs` — tổng 4 phan **method 0.4** (TB recency 12 bar
  cuối × mọi method trong registry, `analyze` 1h) + **regime 0.2** (season + F&G contrarian)
  + **funding 0.2** (rate ±3bp/8h → crowded) + **zone 0.2** (cascade fuel ≤2.5% + L/S crowding
  + actual), clamp [−1,1]; snapshot kind `confluence` (rank desc), SERVICES hằng ngày
  (`CONFLUENCE_INTERVAL=86400`), API `toConfluence` + card `/`. Symbols: env list →
  top |pct24h| từ kind `mover` → fallback majors.
- [ ] (tuỳ chọn) Pyramid + multi-TP trong backtest khi method hỗ trợ

**Acceptance:** bảng so sánh method có số liệu; confluence ranking chạy hằng ngày.

### Phase 11 — AI Copilot (phân tích → phương án → lệnh)

- [x] `ai/gateway.mjs` — abstraction OpenAI / Anthropic / Ollama; key + model qua `.env`;
      rate-limit + log prompt/response (`logs/ai.ndjson`)
* ✅ (2026-10-04): `ai/gateway.mjs` (13.7 KB) — 3 provider (`openai`/`ollama` cùng dạng
  chat/completions, `anthropic` dùng `/v1/messages` + `x-api-key` + `anthropic-version`),
  rate-limit cửa sổ trượt `AI_RPM` (mặc định 30/60s), audit `logs/ai.ndjson`,
  8 mã lỗi (`ai.no-key|rate-limited|timeout|network|http-error|api-error|bad-shape`).
  Env: `AI_PROVIDER|AI_API_KEY|AI_BASE_URL|AI_MODEL|AI_MAX_TOKENS|AI_TIMEOUT_MS|AI_RPM|AI_TEMPERATURE|AI_LANG|AI_LOG|AI_LOG_FILE`.
- [x] `ai/agent.mjs` — tool-calling: `queryDB` (runs/trades/signals/intel) · `getKlines` ·
      `scanMovers` · `methodSignals` · `regimeSnapshot` · `backtestQuick`
* ✅ (2026-10-04): `ai/agent.mjs` (14.3 KB) — `TOOLS`/`TOOL_NAMES` đủ **6 tool**, `toolSpecs()`,
  `executeTool(name, params, deps)` (tiêm dep được), `defaultSystem()`, `runAgent()`.
- [x] **Use-case ra output**:
      1. **Phân tích báo cáo backtest** → đề xuất chỉnh preset (gợi ý cho Phase 5)
      2. **Daily brief** (mỗi sáng): regime + scanner + funding + vị thế + rủi ro → Telegram
      3. **Trade plan**: Entry/SL/TP + lý do + confluence score → **qua risk gate**
      4. **Journal review**: nhận xét lệnh thua/lãi (Phase 13)
* ✅ (2026-10-04): (1) tool `backtestQuick`; (2) `ai/daily-brief.mjs` (5.6 KB) + **đã lên lịch**
  trong `services/run.mjs` (`{ name: 'brief', run: runBrief }`, window-gated `AI_BRIEF_HOURS`,
  `AI_BRIEF_INTERVAL`) và `heartbeat.mjs` theo dõi (7 service); (3) `agent.mjs` ghi rõ
  *"Trade ideas are PROPOSALS only (entry/SL/TP + reason + confluence)"*; (4) **chờ Phase 13** —
  chưa có lệnh thật để review.
- [x] 🔒 **Guardrails (bắt buộc)**: AI **không** tự đặt lệnh thật — output là *đề xuất*; lệnh chỉ
      chạy khi qua `exec/risk.mjs` + (tuỳ cấu hình) xác nhận của người; audit log toàn bộ quyết định
* ✅ (2026-10-04): guardrail viết thành văn trong code — `agent.mjs`: *"PROPOSALS only; anything
  executable must still pass exec/risk.mjs"*; `daily-brief.mjs`: *"no order path exists here"*;
  brief đọc trạng thái rủi ro qua `loadRiskConfig`/`loadSnapshot` từ `exec/risk.mjs`;
  **audit toàn bộ** prompt/response ở `logs/ai.ndjson` (`appendAiLog`, fail-soft).
* ❗ **Bug thật bắt được khi rà roadmap (2026-10-04):** `package.json` có `"test:ai": "node ai/test.mjs"`
  và **`npm test` gọi nó ở bước cuối**, nhưng **`ai/test.mjs` không tồn tại** → `npm test` hỏng.
  Đã viết `ai/test.mjs` (xem §9). *Bài học: 3 file `ai/*.mjs` có script riêng nhưng thiếu test —
  đúng loại lỗi mà "chạy `npm test`" bắt được, còn đọc code thì không.*

**Acceptance:** daily brief chạy tự động; trade plan trên dashboard có lý do + điểm confluence;
mọi lệnh AI đều qua risk gate và có audit trail.

### Phase 12 — Execution MT5 cho XAU/XAG (và crypto qua exchange)

- [x] `exec/mt5/` — bridge MetaTrader 5: **phía NODE xong + đã kiểm chứng; `server.py` CHƯA chạy được**
      * **A (khuyến nghị)**: micro-service Python (`MetaTrader5` lib official, chỉ chạy Windows
        cạnh MT5) ↔ server qua HTTP/NDJSON — Node giữ phần còn lại
      * **B**: MetaAPI cloud (SDK Node, trả phí) — không cần máy chạy Python
- [~] Tính năng: kết nối tài khoản (**demo trước, real sau**), đọc positions/balance/equity
      realtime, đặt lệnh market/pending (entry + SL + TP theo plan), sửa/đóng lệnh
- [ ] Nguồn tín hiệu XAU: TV alert → risk → MT5; sau Phase 10: engine signals XAU
      (cần data XAU — song song tìm nguồn: exchange XAU pair hoặc data API)
- [ ] Position sync: lệnh MT5 ↔ collection `positions` → dashboard

* ✅ (2026-10-04) checkpoint §7 của `docs/mt5-ipc.md`: `exec/mt5/client.mjs` (586 dòng, transport
  Node — **đã kiểm chứng**), `exec/mt5/server.py` (822 dòng — **CHƯA KIỂM CHỨNG**), `exec/mt5/test.mjs`
  (538 dòng, **92 assertion**). `server/webhook.mjs` +44 dòng (`mt5HealthComponent()` vào `/health`
  tổng, D9) + 2 check trong `tools/smoke.mjs`. `test:mt5` đã nối vào `npm test`.
* ✅ **Idempotency (bất biến sinh tử) — đã kiểm chứng bằng MUTATION, không chỉ đọc test:**
  mutation làm `idempotencyKeyFor` không tất định → suite đổ **8 FAIL**, trong đó:
  `both calls return the SAME ticket — 40311842 vs 40311843`, `mock minted exactly ONE ticket
  — created=2`, **`duplicate answer placed nothing new — positions=2`** (tức **2 lệnh thật thay vì
  1**), và `Idempotency-Key` lệch khỏi `clientOrderId` thật của `engine/keys.mjs`.
  Đã khôi phục và xác minh hash `ec0775639478a2a0b02fd5b5d3674303`. ⇒ Suite này **bảo vệ đúng
  chỗ mất tiền**, không phải test hình thức.
* ❗ **Chưa kiểm chứng / còn thiếu:** (a) `server.py` chưa từng chạy — máy này **không có**
  `MetaTrader5` (`ModuleNotFoundError`, Python 3.11.9 có sẵn), không có terminal MT5, sandbox chặn
  spawn tiến trình; chỉ `py_compile` (cú pháp) đạt. (b) **Nguồn dữ liệu XAU chưa có.** (c) Chưa
  round-trip MT5 thật → chưa biết quirk `filling-mode`/`retcode`. ⇒ **Acceptance của phase CHƯA đạt**,
  cần máy bạn có MT5.
* 📌 **Mâu thuẫn trong hợp đồng đã phát hiện, cần chốt lại `docs/mt5-ipc.md` (→ ✅ đã chốt bên
  dưới, 2026-10-05):** §3 (`GET` không
  retry trong 1 request) **mâu thuẫn** §4 (GET idempotent retry tối đa 2 lần) → tạm giải:
  `/health`+`/account` gọi 1 lần, `/positions`+`/history` có retry. §4.4 nói tra theo "ticket"
  nhưng lúc `unknown` **chưa có ticket** (§4.1 chỉ ghi `clientOrderId`). §2.1/§4.2 **không định nghĩa**
  cách so payload (byte-exact hay canonical) — hậu quả nặng vì lệch → 409 → **khoá lệnh vĩnh viễn**.
  §6 yêu cầu `account_type` trong `/health` nhưng ví dụ §2.2 không có, và MT5 chỉ cho `trade_mode` số.
  §2.1 đặt `Idempotency-Key` ở **body** trong khi yêu cầu là **header**. Không rõ `/health` có cần
  token không.
  ✅ **ĐÃ CHỐT (2026-10-05) trong `docs/mt5-ipc.md`** — cả 6 điểm, kèm mục *Trạng thái kiểm chứng*:
  (1) so payload = **canonical hash** (bỏ `Idempotency-Key`/`clientOrderId`), `409` là **terminal**
  → permablock, operator xử lý tay; (2) `Idempotency-Key` là **header** (body chỉ để tương thích,
  header thắng); (3) `account_type` **bắt buộc** trong `/health`, bridge map `trade_mode`
  `DEMO→'demo'`, khác→`'real'`, thiếu→`'unknown'`, Node chỉ cho lệnh khi đúng `'demo'`;
  (4) `/health` + `/account` **cần bearer token**, mất `account_type` thì **từ chối đặt lệnh**
  (chủ ý); (5) retry hai lớp: `/health`+`/account` **single-attempt**, `/positions`+`/history`
  **≤2 retry** (200 ms→1 s, chỉ lỗi kết nối, không `4xx`/`5xx`); (6) §4.4 tra theo
  **`clientOrderId` + `comment`** trước, `ticket` chỉ khi bridge đã echo. **Code nào lệch hợp đồng
  thì sửa code — danh sách lệch đã biết nằm ở mục *Trạng thái kiểm chứng* của `docs/mt5-ipc.md`.**

**Acceptance:** pipeline demo: signal XAU → risk gate → lệnh demo MT5 → đồng bộ dashboard;
chỉ mở real khi paper/demo đạt mục tiêu phase.

### Phase 13 (backlog) — Journal + Feedback loop

- [x] Trade journal tập trung (mọi nguồn: paper, MT5, manual) → tag method/regime
- [~] AI review định kỳ: lỗi lặp (vào trễ, SL quá rộng, trade ngược regime...) → đề xuất rule
- [x] Dataset lệnh → đo preset live vs preset backtest (**drift theo thời gian**, khác D8)

> **Status (2026-10-04, English per the new language policy).**
> **Item 1 — BUILT.** `engine/journal.mjs` (+ `engine/models/journal.mjs`, collection
> `journal`) unifies executed trades from every source (`paper`/`mt5`/`exchange`/`manual`)
> into one journal tagged with `source · symbol · tf · dir · entry/SL/TP · result · R ·
> fees · engineVersion · paramsHash · method · regime · entry/exit timestamps`. It is a
> derived read model over `positions` (the only place a real fill exists), so it respects
> D3/D4: `key` is *derived from* the upstream identity (`account`+`source`+`externalId|_id`)
> with a UNIQUE index, and re-syncing is a no-op — no second order-id scheme. Tags that
> cannot be derived are recorded as `unknown` and listed in `unknown[]`; `fees` stays
> `null` because paper PnL is fee-free by design (0 would claim costs were measured).
> `tf` was originally not stored on `positions` at all → resolved through the opening
> alert, else unknown. Since the live stamp (below) `positions.tf` is written from that
> same alert, and the projection still falls back to the alert lookup for legacy rows. `regime` is a point-in-time `intel` lookup (no look-ahead). Query helpers
> (`filterJournal` / `journalStats` / `groupJournal`) are pure, so the dashboard can use
> them without a DB; `syncJournal`/`loadJournal` write NDJSON always and Mongo when
> present. Home chosen: `engine/` (data layer over engine models, like `engine/store.mjs`);
> `services/` is defined as periodic jobs.
> **Item 3 — BUILT.** `engine/preset-drift.mjs` measures preset drift **over time**:
> executed rows are bucketed by `engineVersion#paramsHash` (D1 — a live dataset spanning
> several generations is REFUSED, no pooled number is printed) and by UTC-aligned time
> window, then compared against the FROZEN backtest preset from `reports/trades.ndjson`
> (win rate + expectancy in R + deltas + trend). Sample size is printed per bucket and a
> bucket below `--min-trades` (default 20 R samples) is marked **insufficient evidence**
> with no delta — D12. This is explicitly NOT D8: `exec/drift.mjs` compares TV ENTRY
> alert counts against engine setups and halts; preset drift measures the preset and
> takes no action.
> **Blocker FIXED (2026-10-05).** The live path now stamps its own trades:
> `exec/risk.mjs recordOpen()` persists a `positions.stamp` (`engineVersion`,
> `paramsHash`, `params`, `kind`) through the pure `buildPositionDoc()` (`engine/stamp.mjs`), using the SAME
> `paramsHash()` of `engine/version.mjs` as the backtest side (no second hashing
> scheme), and `positions` gained `tf` / `exitReason` / `fees` / `stampUnknown`.
> `tf` comes from the opening alert; `exitReason` is derived where the exit is
> decided (`alert:TAKE_PROFIT`, `alert:STOP_LOSS`, `alert:TIME_CLOSE`, `data:tp`,
> `data:sl`, `manual`) — never fabricated. The live preset is DECLARED
> (`PAPER_LIVE_PRESET`, or `PAPER_LIVE_PARAMS` canonicalised by
> `engine/stamp.mjs`); with no declaration the position is marked
> `stampUnknown: true` instead of passing engine DEFAULTS off as the live config,
> and `preset-drift` EXCLUDES those rows from every bucket with a warning instead
> of bucketing them as `unknown#unknown`. Legacy positions are NOT backfilled: an
> invented preset is the old bug with a nicer label.
> `--live-preset`/`--live-engine-version` were REMOVED — once the writer is
> authoritative a report-side declaration is a second source of truth, and it could
> relabel exactly the legacy rows that must stay excluded. New suite `test:stamp`
> drives `recordOpen()` through an INJECTED fake model layer (no Mongo/network/API
> key) and checks the stored document, the exit-reason wiring and the exclusion.
> **Item 2 — SCAFFOLD ONLY.** `ai/review.mjs`: deterministic `reviewDigest()`, prompt
> builder with the recurring-error taxonomy (`entry-too-late`, `sl-too-wide`,
> `against-regime`, `rr-too-low`, ...), tolerant `parseReviewProposals()`, and `runReview()`
> as the single entry point **through `ai/gateway.mjs`** (never a provider directly).
> Deliberately NOT built: scheduling (nothing in `services/run.mjs` calls it), persistence
> of proposals, Telegram delivery, and any feedback into engine parameters — item 2 needs
> real accumulated trades first, and `runReview()` refuses to spend a model call while the
> journal is below the D12 threshold (`--force` reviews anyway and says so in the prompt).
> **Tests:** `test:journal` 122 · `test:preset-drift` 88 · `test:ai-review` 71, all wired
> into `npm test`; pure (no Mongo/network/API key) and they assert no DB connection was
> opened.

---

## 4. Quyết định nền tảng (áp dụng cho MỌI phase)

> Đây là phần đã gộp từ bản review thiết kế. Các quyết định này **không thuộc riêng phase nào** —
> chúng là mặt cắt ngang. Phase nào vi phạm thì phải sửa phase đó, không thương lượng.

### Nhóm A — Dữ liệu & version

| # | Quyết định | Chốt |
|---|---|---|
| **D1** | Version stamp cho mọi run | `engineVersion` + `paramsHash` + `dataHash` + `universeSnapshot` + `gitRev`; dashboard/preset **từ chối trộn** run khác hash, hiện cảnh báo chứ không im lặng cộng chung |
| **D2** | Thời gian | Mọi thứ **lưu UTC ms**; so sánh phiên quy đổi tz tường minh; **không** lưu giờ địa phương |
| **D11** | Universe | Snapshot danh sách + ngày + nguồn vào `run`; min-history filter; ghi số lệnh mỗi dòng |

### Nhóm B — An toàn (lệnh và tiền)

| # | Quyết định | Chốt |
|---|---|---|
| **D3** | Idempotency tầng lệnh | `clientOrderId` sinh từ `alertKey`; tầng lệnh **tự** chặn trùng — không phụ thuộc dedupe tầng alert |
| **D4** | Dedupe bền vững | Không dùng `Map` trong RAM (restart là mất → lệnh trùng). Lưu collection / unique index |
| **D7** | Risk gate đủ dùng | **a)** sizing bắt buộc · **b)** `risk_state` theo `(ngày UTC, account)` · **c)** kill-switch + xử lý vị thế đang mở · **d)** test cùng mức golden fixtures |
| **D8** | Drift | Vượt ngưỡng → **tự tạm dừng mở lệnh mới** (không đóng vị thế), audit + Telegram; mở lại **bằng tay** |
| **D13** | Sao lưu | `mongodump` định kỳ cho `runs`/`trades`; `data/` tái tạo được |

### Nhóm C — Trung thực khi đo lường

| # | Quyết định | Chốt |
|---|---|---|
| **D5** | Hành vi "ST thay setup" | **Mặc định mô phỏng y hệt Pine**: theo `40_events.pine`, `ST` mới **gán lại** `tm_lvlE/S/T` và `tm_lvlDone := false` → setup cũ bị thay **mà không lưu** kết quả. Backtest phải đo **đúng cái indicator hiển thị**. Biến thể TTL ("order sống đến ST kế tiếp") chỉ chạy như **variant có nhãn riêng** và **bị loại khỏi** mọi so sánh parity |
| **D6** | Thứ tự TP/SL trong bar | Ưu tiên sub-bar 1m để phân giải; không phân giải được → **SL** (bảo thủ) |
| **D12** | Chống overfit | baseline ngẫu nhiên cùng phân phối SL/TP/RR + phí + số lệnh; hold-out **theo symbol**; không vượt baseline rõ ràng → **sửa luật, không grid tiếp** |

> **D5 là quyết định quan trọng nhất trong bảng này.** Nếu bỏ qua, engine và Pine sẽ lệch nhau
> **có hệ thống** đúng tại "rủi ro #1", và Phase 6 sẽ báo "drift" mà không ai hiểu vì sao.

### Nhóm D — Vận hành

| # | Quyết định | Chốt |
|---|---|---|
| **D9** | Observability | `/health` có `lastRunAt` + `lastErrorAt` mỗi service; quá `2 × chu kỳ` → Telegram |
| **D10** | Dashboard | Bind `127.0.0.1`; auth single-user trước khi mở từ xa; không dùng token-trong-URL |
| **D14** | Compute budget | Song song theo symbol, cache theo `paramsHash`, **time-box** cho Phase 5 |

---

## 5. Phương án đề xuất thêm (ngoài danh sách ban đầu)

| # | Đề xuất | Vì sao | Đặt ở |
|---|---|---|---|
| 1 | **Risk Manager tập trung** — 1 cổng cho mọi lệnh (AI, scanner, MT5, manual) | Điều kiện sống còn trước khi có auto-trade | **Phase 6 (bắt buộc, D7)** |
| 2 | **Position sizing** (fixed-fractional / Kelly nhẹ) trong risk gate | RR đẹp nhưng size sai vẫn cháy tài khoản | **Phase 6 (bắt buộc, D7a)** |
| 3 | **Confluence score + bảng "coin đáng trade hôm nay"** | Gộp VSA + PA + regime + funding + liquidation thành 1 điểm — giảm nhiễu | Phase 10 |
| 4 | **Daily brief AI qua Telegram** | Cách rẻ nhất để hưởng lợi AI ngay: mỗi sáng 1 bản tổng hợp — không cần app | Phase 11 |
| 5 | **Regime-aware preset** (theo altseason/trend/range, không chỉ symbol×TF) | Funding/altseason đổi hành vi alt — preset tĩnh sẽ lỗi thời | Phase 5 mở rộng (dùng data P9) |
| 6 | **Paper-first policy** — tín hiệu mới chạy paper ≥ 2 tuần trước real | Chống backtest đẹp, live nát | Phase 6 |
| 7 | **Social/pump sentiment** (LunarCrush free tier, Binance announcement) | Bắt sớm pump alt + tránh tin sốc | Phase 8 (tuỳ chọn) |
| 8 | **Alert hub** — nhiều nguồn (TV, exchange ws, scanner, AI) → dedupe → route Telegram/Dashboard | Hiện webhook mới nhận 1 nguồn | Phase 6–8 (D3/D4) |
| 9 | **Anomaly replay** — tua lại 1 phiên trên dashboard với toàn bộ indicator | Đào tạo mắt + review lỗi giao dịch | Backlog (Phase 13+) |

---

## 6. Nguồn dữ liệu (dự kiến, ưu tiên free)

| Nhu cầu | Nguồn | Chi phí |
|---|---|---|
| OHLCV crypto | Binance fapi/spot klines | Free |
| Funding / OI / liquidation raw | Binance fapi `premiumIndex`, `openInterest`, ws `forceOrder` | Free |
| Altseason / BTC.D | blockchaincenter.net API, CoinGecko | Free |
| Fear & Greed | alternative.me API | Free |
| News | CryptoPanic (free tier), RSS, Binance announcements | Free |
| Token unlock / IO | TokenUnlocks API | Free/Cao cấp |
| On-chain flow sâu (netflow, whale) | Glassnode / CryptoQuant / Arkham | Trả phí — **để sau** |
| Liquidation HeatMap đẹp | Coinglass API | Trả phí — dùng free trước |
| XAU/XAG data + execution | MT5 (giá từ broker) + bridge | Free (broker) |
| AI | OpenAI / Anthropic / Ollama local | Tuỳ chọn |

---

## 7. Rủi ro & biện pháp

| Rủi ro | Biện pháp |
|---|---|
| **Lệch Pine ↔ engine** (rủi ro #1) | Golden fixtures bắt buộc trong `npm test` (**D5** chốt trước); mọi sửa indicator → chạy lại fixtures |
| **Kết quả backtest trộn giữa các thế hệ engine** | **D1** — version stamp + từ chối trộn run khác hash |
| **Dedupe mất state khi restart → lệnh trùng** | **D4** (dedupe bền vững) + **D3** (idempotency tầng lệnh) |
| **Hệ "chết im lặng"** (scanner/loop chết vì rate-limit) | **D9** — heartbeat + `lastRunAt` mỗi service → Telegram |
| **Overfit preset / overfit method** | **D12** — baseline ngẫu nhiên + hold-out theo symbol + min trades; walk-forward |
| **AI sai/sự tưởng (hallucination) đặt lệnh sai** | AI chỉ *đề xuất*; mọi lệnh qua risk gate + human-in-the-loop + audit log |
| **Real money sai** (MT5/exchange) | Paper/demo Phase 6–12 trước; real chỉ mở khi đạt ngưỡng; daily loss cap (**D7b**) |
| Binance block IP / thiếu lịch sử | Cache `data/`; retry; chọn spot/futures |
| **Survivorship bias** (chỉ test coin còn sống) | **D11** — universe snapshot + lọc delisted + min-history |
| Đụng tooling cũ khi dời webhook | Phase 1 chỉ dời + sửa tham chiếu, verify phải xanh (nay 173/0) |
| API free đổi chính sách / rate-limit | Cache + abstraction nguồn trong `services/`; dễ thay |
| Ảnh XAU không có data Binance | Tín hiệu XAU từ TV alert trước; data engine XAU chờ nguồn riêng |
| Chi phí API (AI, Coinglass, MetaAPI) | Ưu tiên free; paid chỉ khi phase đó chứng minh giá trị |
| Mất dữ liệu kết quả | **D13** — `mongodump` định kỳ cho `runs`/`trades` |

---

## 8. Thứ tự thực hiện

1. ~~Duyệt kế hoạch~~ → **đã duyệt 2026-10-01** (bản này đã gộp review)
2. ~~Phase 1~~ — cấu trúc, verify xanh ✅
3. ~~Phase 2~~ — engine parity ✅
4. **Phase 3** — nền tảng dữ liệu & hợp đồng 🔒 *(làm ngay, chặn các phase sau)*
5. **Phase 4 → 5** — data + backtester + báo cáo → preset optimizer (core, có số liệu sớm nhất)
6. **Phase 6 → 7** — live + risk/paper → dashboard nền tảng cho mọi thứ sau
7. **Phase 8 → 9** — intel + regime (data feed cho filter & AI)
8. **Phase 10** — methods + confluence
9. **Phase 11 → 12** — AI copilot → MT5 (execution thật đặt CUỐI CÙNG, sau khi risk gate + paper vững)
10. **Phase 13** — journal feedback (backlog, làm liên tục khi có lệnh thật)

> **Vì sao KHÔNG đảo thứ tự phase:** thứ tự hiện tại đã đúng ở chỗ khó nhất — execution thật đặt
> sau risk gate + paper, AI đặt trước execution nhưng bị risk gate chặn, intel/regime đặt trước AI
> vì AI cần dữ liệu để nói điều có nghĩa. Việc cần làm là **chèn Phase 3** và **siết nội dung**
> các phase (D1–D14), không phải xếp lại.
>
> **Cân nhắc đã bị bỏ:** đảo Phase 5 (optimizer) ra sau Phase 6 (live) để bắt đầu đếm 2 tuần paper
> sớm hơn. **Không chọn**, vì mục tiêu #1 của bạn là "bảng preset có số liệu" và paper hoàn toàn
> có thể chạy bằng preset mặc định trong lúc chờ. Nếu sau này ưu tiên đổi, chỉ cần hoán vị 5↔6 —
> không ảnh hưởng gì tới các phase khác.

> Nguyên tắc xuyên suốt: **mỗi phase chạy độc lập, có deliverable + acceptance**;
> mọi thay đổi chỉ báo phải giữ parity fixtures; mọi lệnh thật phải qua risk gate;
> **mọi thứ lưu trữ đều có version, mọi thứ qua mạng đều có version.**

---

## 9. Trạng thái hiện tại (2026-10-04)

**Đã xanh:** `npm test` → smoke **173/0** · engine **360/0** · risk **56/0** · drift **25/0** ·
db **58/0** = **672 assertions**; `npm run typecheck` 4/4; `npm run test:app` **78/78**.

- **Phase 1 — xong** (`engine:run` đã bù trong Phase 4).
- **Phase 2 — xong**: `engine/ta.mjs`, `engine/signals.mjs`, `engine/test.mjs`,
  đã vào `npm test`. Fixtures còn nằm trong `test.mjs` (xem ghi chú ở Phase 2).
- **Phase 3 — xong**: `engine/version.mjs` (**D1**), `docs/data-model.md`, `engine/keys.mjs`
  (**D3/D4**), `engine/store.mjs`, `docs/time-rules.md` (**D2**), `docs/alert-schema.md`
  (**hợp đồng alert**), `docs/mt5-ipc.md` (**hợp đồng MT5**) — Chi tiết bên dưới.
- **Phase 4 — xong** (2026-10-02): `engine/methods/` (plugin 🔒 + registry + `all.mjs`),
  `engine/backtest.mjs` (**D5** mặc định đúng Pine, **D6** sub-bar 1m, phí + slippage),
  `engine/data.mjs` (fapi/spot + phân trang + cache + resample 4m/10m, **D11**),
  `engine/report.mjs` (trình bày **không tính lại** + `medianRr`/`degenerateRisk`),
  `engine/run.mjs` + script `engine:run`. `ENGINE_VERSION` → **0.5.0**.
  Test §11–§15. **3 bug thật đã bắt và sửa trong lúc làm Phase 4** (đều có test khoá):
  1. **`avgRr` bị 1 lệnh chiêm quyền** — 1 lệnh có risk 0.003% của entry cho **87.7R** kéo
     `avgRr` từ −0.58R lên **+0.15R** trong lúc PF = 0.32, net = −16%: báo cáo đọc như
     *có lời*. Nay in cả `medianRr`, đánh dấu `*` khi hai số ngược dấu, và đếm
     `degenerateRisk`.
  2. **`onReplace=ttl` đếm thiếu** — `counters.closed` không tính các lệnh đóng do thay thế →
     báo cáo in "đóng: 42" trong khi bảng tổng hợp in **110** lệnh; kèm đó text cảnh báo
     còn khuyên "chạy lại với `--on-replace ttl`" ngay **khi đang chạy ttl**. Nay
     `filled = closed + open + dropped` đúng cho **cả hai** chế độ (test khoá).
  3. **`--refresh BTCUSDT.P` nuốt mất symbol** — parser không phân biệt flag boolean với
     option nhận giá trị → mất symbol mà không báo lỗi. Nay có `BOOLEAN_FLAGS` (test §15).
  Và 1 lỗi phương pháp trong `data.mjs`: `4m`/`10m` bị **thêm nhầm** vào interval map của
  Binance (chúng không tồn tại → API sẽ trả lỗi khó hiểu thay vì ép resample) — nay
  `MUST_RESAMPLE` là đường bắt buộc.
- **Phase 6 (P3 Live loop + RISK + Paper) — xong** (2026-10-04):
  * **Webhook → `signals`**: `server/webhook.mjs` ghi song song sau NDJSON append —
    `toSignalDoc()`/`writeSignal()` (memo model + createIndexes, fail-soft trả
    `skip/no-mongo/written/error`, log thêm `signal=<status>`); type suy từ `side`
    (BUY→`ST LONG`, SELL→`ST SHORT` — alert v1 không có VSA event); field optional
    `event` thêm vào alert-schema (không bump `v`). Test `engine/test-db.mjs` §7b (+9 → 58).
  * **`exec/risk.mjs` + `exec/env.mjs`** — cổng duy nhất `checkOrder()`: HALTED ·
    DAILY_LOSS_CAP · BAD_PRICE · BAD_TPS · SIZE_ZERO · RISK_BUDGET · LEVERAGE · EXPOSURE ·
    MAX_OPEN · MIN_RR (mọi code từ chối đều trả nguyên nhân + số liệu). **D7a** sizing ngay
    trong gate (`sizingPct`: fixed-fractional 1% mặc định, Kelly off → bật khi n≥20, cap
    `kellyMaxPct`=3, `exposurePct`=500 khớp leverage 5x); **D7b** `risk_state` theo
    (ngày UTC, account) — `ensureTodayRow/recordOpen/recordClose`, auto-halt khi
    `realizedPnlPct ≤ −dailyLossCapPct`; **D7c** `halt/resume` — kill-switch/drift/manual
    **inherit qua nửa đêm** (`resolveDay`), riêng `daily_loss_cap` hết hạn theo ngày, SL/TP
    vẫn bảo vệ vị thế (chỉ `halt --close` mới đóng); audit append `logs/risk.ndjson`;
    CLI `status|halt [reason] [--close]|resume [reason]`. *Sửa thật:* `loadWinStats().b`
    tính sai (sum/lossCount thay vì avgWin/avgLoss → Kelly phóng to ~75x với payoff 2.2).
  * **D7d** 🔒 — `exec/test-risk.mjs` **56 golden assertion** (cap biên −5.0/−4.999, kill-
    switch + inheritance, SL/TP vô lý, size 0, exposure chồng lấn, leverage/minRR biên,
    Kelly, config parse, audit NDJSON) — vào `npm test` + script `test:risk`.
  * **`exec/paper.mjs`** — ENTRY: stale guard 15′ (`PAPER_STALE_MS`) → `checkOrder` → fill
    tại signal price → `recordOpen` (externalId = `clientOrderId(alertKey)`) → alert `opened`;
    follow-up STOP_LOSS (fill tại `alert.price`) / TAKE_PROFIT (fill tại `tps[level-1]`) /
    TIME_CLOSE (fill tại close 1m) → data scan `findFirstExit()` (SL-first, gap SL fill at
    open) → `recordClose` + alert `closed`; idempotent (theo externalId + status filter);
    CLI 1 cycle hoặc `--watch --interval`; e2e 2 lệnh thật (+169.67 TP · −76.27 SL, day
    +0.95%, streak 1). Alert enum mở rộng `opened`/`closed`.
  * **D8 `exec/drift.mjs`** — ENTRY alerts TV (24h) vs `analyze()` engine cùng symbol/TF
    (map TF qua `engineTf`): breach khi |Δ| > `DRIFT_MAX_DIFF`(3) **hoặc** > `DRIFT_MAX_PCT`%(50)
    với tổng ≥ `DRIFT_MIN_TOTAL`(4) → **tự `halt('drift')`** (inherit qua nửa đêm, không đóng
    vị thế) + audit `drift_report`/`drift_breach` + Telegram fail-soft (bỏ qua nếu thiếu
    token); chỉ mở lại tay `drift.mjs resume <reason>`. `exec/test-drift.mjs` **25 assertion**
    (biên abs/pct, noise floor, skip NaN, config) — vào `npm test`.
  * **D13 `tools/backup.mjs`** (`npm run backup`) — `mongodump` `runs`+`trades` gzip →
    `backups/<UTC stamp>/` (gitignore), retention `--keep`/`BACKUP_KEEP` (mặc định 14),
    SKIP in RÕ khi thiếu mongodump/Mongo (exit 0, `--strict` → exit 1 cho cron), log
    `logs/backup.ndjson`; `data/` + `reports/` tái tạo được → không sao lưu.
  E2E chuỗi: webhook → signals → checkOrder (allowed → halted → resumed) → paper open/close
  → drift breach → halt → resume; card Risk Gate trên `/` sáng data thật.
- **Phase 7 (P4 Dashboard) — xong** (2026-10-03 → 2026-10-04): tm-trading là **satellite** của tm-hub
  (xem `docs/app-inheritance.md` §3): app id `tm-trading_pco4rn`, secret JWT thẳng hàng hub,
  `useHub`/`useAuth` tái dùng từ tm-tools; **D10** — `server/middleware/auth.ts` chốt mọi
  `/api/**` (Bearer/cookie + ép `X-App-Id` khớp app). Nav menu seed qua
  `POST /api/v1/apps/{id}/routes`: Overview · Backtest · Logs · group `#system`
  (Profile/Settings), i18n `nav.runs`/`runs.*` (en+vi), branding home đổi từ
  "Hub Control Center" → **Tổng quan Giao dịch**. Dashboard hiện có `/` (KPI), `/runs`
  (list theo **series** = `engineVersion~symbol~tf~paramsHash`) và `/runs/[id]`
  (bảng trades + version stamp **D1**); API `GET /api/v1/runs[/:id]` đọc
  `reports/*.ndjson` và tổng hợp **qua `summarizeRuns()` của engine** — không tính lại.
  **Số liệu thật trong `reports/`**: 39 runs / 2423 dòng lệnh / 11 series; trùng lặp theo
  lần chạy (BTC 15m: 626 dòng → **121 lệnh unique**) và BTC 4m/10m có **2 `dataHash`**
  → dashboard khui trùng + hiện cảnh báo, không im lặng cộng chung.
  **Live signals ✅ cùng ngày**: `server/utils/signals.ts` + `GET /api/v1/signals` đọc collection
  `alerts` qua **engine model** (1 nguồn suy ra D1, không map tay), keyset cursor, fail-soft khi
  Mongo down; trang `/signals` (10 cột + empty state + badge Mongo down), i18n `nav.signals`
  (en+vi), nav seed hub: Overview · Backtest · **Signals** · Logs · System. E2e đầy đủ:
  401 không token ·400 `since` sai · webhook 2 alert → API list/filter/cursor → UI render hàng
  thật (alert test đã dọn sạch). `npm run typecheck` (tool chống treo `tools/typecheck.mjs`)
  PASS 4/4 · `npm test` 173+360+49 /0 · `test:app` 75/75 · `verify` xanh.
  **Hoàn thành 2026-10-04** — 2 mục còn lại của Phase 7:
  - **So sánh preset** — trang `/runs/compare` (nút entry từ `/runs` + `/runs/[id]`, URL
    `?ids=` share được): chọn 2–6 series → bảng 7 chỉ số cạnh nhau (best in đậm), bảng
    **khác biệt tham số** (`paramsDiff` — 33 params giống/hình dung khác biệt ngay khi mọi
    series hiện đều chung `87ad386c`), equity overlay 2+ đường trên trục UTC + % chung
    (legend + màu theo vị trí chọn, class Tailwind literal), cảnh báo D1 khi >1 thế hệ.
    Logic thuần `shared/utils/compare.ts` (metricRows/paramsDiff/buildOverlay) có test
    riêng; **không** cộng gộp thế hệ — mỗi cột là một series đứng riêng (D1).
  - **Trạng thái risk gate + drift** — `GET /api/v1/risk/status` (`server/utils/risk.ts`)
    đọc `risk_state` ngày UTC (ban ghi halted gần nhất được giữ nếu sang ngày mới — kill-
    switch bền) + `positions` open, fail-soft `mongo:'down'`; card **Risk Gate & Drift**
    trên `/` cạnh KPI: badge HALTED/Active/No data, PnL ngày, opened/closed/streak, open
    positions; khối Drift (D8) hiển thị "chưa hoạt động" + mô tả trung thực tới khi Phase 6
    có nguồn. `server/utils/engineModel.ts` gộp memo + fail-soft của model engine (signals
    refactor sang dùng chung — 1 nguồn, D1).
  E2e trình duyệt: Home card (day 2026-10-04, mongo up, open 0) · `/runs/compare` chọn
  2 series → bảng + paramsDiff + overlay khớp số `/` · preselect từ detail · signals
  regression · **0 console error**. `test:app` **75/75** (+21: compare + risk).
  **Rà module hub giữ/catchet buộc trước khi làm tiếp** (xem `docs/app-inheritance.md` §3d):
  chứng minh `adminFetch` ≡ `hubFetch` → ~170/176 route local là dead code, chốt 4 batch cắt
  (mail → apps → auth provider → trang/i18n);6 route local cần giữ: `runs`(2) · `signals` ·
  `health` · `icons` · `configs/public`.
  ✅ **ĐÃ LÀM XONG (2026-10-04)**: cả 4 batch đã cắt + verify đủ 5 lệnh/batch (typecheck 4/4 ·
  `npm test` 672/0 · `test:app` 72/72 · `verify` 0 · browser login duyệt trang, console 0/0):
  ~330 file server-side chết, 75 file trang/component, **−31 deps** (77→46), **−1608 i18n keys**
  (2416→808 en+vi), nav filter theo router local (không còn link 404). Chi tiết + số liệu
  từng batch: `docs/app-inheritance.md` §3d bảng "CẮT theo batch".
- **Pine (công cụ hỗ trợ) — có thêm bản twin backtest**: `TM VSA Backtest` (264 dòng) dùng **chung
  nguồn `parts-vsa`** với `TM VSA Wyckoff`, chỉ khác khai báo `strategy(...)`; `60_viz` bị cắt bằng
  marker `@part skip:vsa-strategy`, cầu nối lệnh ở `pine/parts-vsa/50_strategy.pine`
  (`@part skip:vsa`). Bridge **đọc thẳng** `tm_lvlE/S/T` do `40_events` tính → không thể lệch SL/TP.
  Smoke test **so sánh trực tiếp** các dòng `tm_sig* =` / `tm_lvl* :=` của hai file dist để bắt lệch.
  Scripts: `npm run pine:vsa:backtest`, `npm run pine:copy:vsa:backtest`.
- **Bug đã sửa** (liên quan Phase 6): `server/webhook.mjs` khi body vượt `MAX_BODY` đã `destroy()`
  socket **ngay** → client chỉ nhận connection reset, **không** nhận 413. Nay trả 413 + JSON rồi
  `req.resume()` rút cạn. Có test trong smoke (payload 64KB → 413).
- **Đã sửa lệch tài liệu**: `tools/errors.mjs` hardcode `pine/parts/` → bản VSA báo sai đường dẫn
  file nguồn; nay map theo `dir` của target (có `parts-vsa`).
- **Đã bỏ ghi chú "nhắc lại có chủ ý" về `Map` trong RAM**: dedupe đã chuyển sang unique index
  (`alerts.alertKey`) từ 2026-10-02 — xem Phase 6 mục D4.
- **3 bug thật đã bắt và sửa trong lúc làm Phase 3** (đều có test khoá lại):
  1. `engine/db.mjs` — `connectMongo` luôn ép `dbName: 'tm-trading'` → `test-db.mjs` (dùng
     `dropDatabase()`) **đã xoá nhầm DB thật mỗi lần `npm test`**. Nay URI có tên DB thì tôn
     trọng tên đó (`dbNameFromUri()`); verified `connection.name = tm-trading-test`.
  2. `server/webhook.mjs` — `loadEnv()` chạy lúc import điền `MONGODB_URI` từ `.env` → test
     kết nối bị **đổi sang DB thật giữa chừng** → 4 alert test lọt vào DB thật (đã xoá) và
     `dropDatabase()` cuối file lỗi "Client must be connected". `test-db.mjs` giờ ghim
     `process.env.MONGODB_URI` **trước** khi import webhook + có test khẳng định vẫn ở DB test.
  3. `engine/keys.mjs` — `alertKey` thiếu `level` → mất alert TP2 (xem Phase 3 mục D3/D4).